import { Router } from 'express'
import { pool }   from '../db/pool.js'
import { aiEmbed } from '../services/ai.js'

const router = Router()

const MAX_LIMIT = 50

router.get('/', async (req, res) => {
  const q     = ((req.query.q as string) || '').trim()
  const pid   = (req.query.projectId as string) || null
  const limit = Math.min(Math.max(1, Number(req.query.limit ?? 10)), MAX_LIMIT)
  const PAGE  = limit

  // Per-table project filter fragment ($2 when pid set, nothing otherwise)
  const pf = (alias: string) => pid ? `AND ${alias}.project_id = $2` : ''

  if (q && req.user?.id) {
    (async () => {
      try {
        const userId = req.user!.id
        await pool.query(
          `INSERT INTO search_history (user_id, query) VALUES ($1, $2)`,
          [userId, q]
        )
        await pool.query(
          `DELETE FROM search_history
           WHERE user_id = $1 AND id NOT IN (
             SELECT id FROM search_history
             WHERE user_id = $1
             ORDER BY created_at DESC
             LIMIT 50
           )`,
          [userId]
        )
      } catch (err) {
        console.error('failed to update search history:', err)
      }
    })()
  }

  try {
    if (!q) {
      // ── Empty query: return recent items from each type ──────────────────
      const pidClause = (alias: string, col = 'project_id') =>
        pid ? `WHERE ${alias}.${col} = $1` : ''
      const params     = pid ? [pid] : []
      const limitIdx   = params.length + 1
      const ap         = [...params, PAGE]

      const [docsRes, issuesRes, commandsRes, releasesRes, runbooksRes] = await Promise.all([
        pool.query(
          `SELECT 'doc' AS type, d.id, d.title, d.file_type AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM documents d LEFT JOIN projects p ON p.id = d.project_id
           ${pidClause('d')} ORDER BY d.created_at DESC LIMIT $${limitIdx}`,
          ap
        ),
        pool.query(
          `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM issues i LEFT JOIN projects p ON p.id = i.project_id
           ${pidClause('i')} ORDER BY i.created_at DESC LIMIT $${limitIdx}`,
          ap
        ),
        pool.query(
          `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
                  p.name AS project_name, p.color AS project_color, c.command AS body
           FROM commands c LEFT JOIN projects p ON p.id = c.project_id
           ${pidClause('c')} ORDER BY c.is_favorite DESC, c.last_used DESC NULLS LAST LIMIT $${limitIdx}`,
          ap
        ),
        pool.query(
          `SELECT 'release' AS type, r.id, r.version AS title, r.type AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM releases r LEFT JOIN projects p ON p.id = r.project_id
           ${pidClause('r')} ORDER BY r.date DESC LIMIT $${limitIdx}`,
          ap
        ),
        pool.query(
          `SELECT 'runbook' AS type, rb.id, rb.title, NULL::text AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM runbooks rb LEFT JOIN projects p ON p.id = rb.project_id
           ${pidClause('rb')} ORDER BY rb.last_used_at DESC NULLS LAST, rb.created_at DESC LIMIT $${limitIdx}`,
          ap
        ),
      ])

      return res.json({
        data: {
          docs:     docsRes.rows,
          issues:   issuesRes.rows,
          commands: commandsRes.rows,
          releases: releasesRes.rows,
          runbooks: runbooksRes.rows,
        }
      })
    }

    // ── Non-empty query: hybrid search ────────────────────────────────────

    // 1. Docs — pgvector cosine similarity (with ILIKE fallback if embedding fails)
    let docsRes
    try {
      const embedding = await aiEmbed(q)
      const vec       = `[${embedding.join(',')}]`
      const docParams = pid ? [vec, pid] : [vec]
      const dq        = [...docParams, PAGE]

      docsRes = await pool.query(
        `SELECT type, id, title, subtype, project_name, project_color
         FROM (
           SELECT DISTINCT ON (d.id)
             'doc' AS type, d.id, d.title, d.file_type AS subtype,
             p.name AS project_name, p.color AS project_color,
             dc.embedding <=> $1::vector AS dist
           FROM document_chunks dc
           JOIN documents d ON d.id = dc.document_id
           LEFT JOIN projects p ON p.id = d.project_id
           WHERE 1=1 ${pf('d')}
           ORDER BY d.id, dc.embedding <=> $1::vector
         ) sub
         ORDER BY sub.dist
         LIMIT $${docParams.length + 1}`,
        dq
      )
    } catch {
      // Ollama not running — fall back to tsvector on documents
      const docParams = pid ? [q, pid] : [q]
      const fbq       = [...docParams, PAGE]
      docsRes = await pool.query(
        `SELECT 'doc' AS type, d.id, d.title, d.file_type AS subtype,
                p.name AS project_name, p.color AS project_color
         FROM documents d LEFT JOIN projects p ON p.id = d.project_id
         WHERE (d.tsv @@ plainto_tsquery('english', $1) OR d.title ILIKE '%'||$1||'%') ${pf('d')}
         ORDER BY ts_rank(d.tsv, plainto_tsquery('english', $1)) DESC
         LIMIT $${docParams.length + 1}`,
        fbq
      )
    }

    const textParams  = pid ? [q, pid] : [q]
    const tLimitIdx   = textParams.length + 1
    const tq          = [...textParams, PAGE]

    // 2. Issues — tsvector with ts_rank, ILIKE fallback
    let issuesRes = await pool.query(
      `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM issues i LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.tsv @@ plainto_tsquery('english', $1) ${pf('i')}
       ORDER BY ts_rank(i.tsv, plainto_tsquery('english', $1)) DESC
       LIMIT $${tLimitIdx}`,
      tq
    )
    if (issuesRes.rows.length === 0) {
      issuesRes = await pool.query(
        `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
                p.name AS project_name, p.color AS project_color
         FROM issues i LEFT JOIN projects p ON p.id = i.project_id
         WHERE (i.title ILIKE '%'||$1||'%' OR i.description ILIKE '%'||$1||'%') ${pf('i')}
         ORDER BY i.created_at DESC LIMIT $${tLimitIdx}`,
        tq
      )
    }

    // 3. Commands — tsvector with ts_rank, ILIKE fallback
    let commandsRes = await pool.query(
      `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
              p.name AS project_name, p.color AS project_color, c.command AS body
       FROM commands c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.tsv @@ plainto_tsquery('english', $1) ${pf('c')}
       ORDER BY ts_rank(c.tsv, plainto_tsquery('english', $1)) DESC
       LIMIT $${tLimitIdx}`,
      tq
    )
    if (commandsRes.rows.length === 0) {
      commandsRes = await pool.query(
        `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
                p.name AS project_name, p.color AS project_color, c.command AS body
         FROM commands c LEFT JOIN projects p ON p.id = c.project_id
         WHERE (c.title ILIKE '%'||$1||'%' OR c.command ILIKE '%'||$1||'%') ${pf('c')}
         ORDER BY c.is_favorite DESC, c.last_used DESC NULLS LAST LIMIT $${tLimitIdx}`,
        tq
      )
    }

    // 4. Releases — ILIKE (no tsvector column)
    const releasesRes = await pool.query(
      `SELECT 'release' AS type, r.id, r.version AS title, r.type AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM releases r LEFT JOIN projects p ON p.id = r.project_id
       WHERE (r.version ILIKE '%'||$1||'%' OR r.notes ILIKE '%'||$1||'%') ${pf('r')}
       ORDER BY r.date DESC LIMIT $${tLimitIdx}`,
      tq
    )

    // 5. Runbooks — ILIKE (no tsvector column)
    const runbooksRes = await pool.query(
      `SELECT 'runbook' AS type, rb.id, rb.title, NULL::text AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM runbooks rb LEFT JOIN projects p ON p.id = rb.project_id
       WHERE (rb.title ILIKE '%'||$1||'%' OR $1 = ANY(rb.tags)) ${pf('rb')}
       ORDER BY rb.last_used_at DESC NULLS LAST, rb.created_at DESC LIMIT $${tLimitIdx}`,
      tq
    )

    res.json({
      data: {
        docs:     docsRes.rows,
        issues:   issuesRes.rows,
        commands: commandsRes.rows,
        releases: releasesRes.rows,
        runbooks: runbooksRes.rows,
      }
    })
  } catch (err) {
    console.error('search error:', err)
    res.status(500).json({ error: 'Search failed' })
  }
})

// ── GET /api/search/suggestions ──────────────────────────────────────────────
// Returns up to 5 recent items ranked by updated_at for empty-state suggestions.

router.get('/suggestions', async (req, res) => {
  const pid = (req.query.projectId as string) || null
  const params = pid ? [pid] : []

  try {
    const pidClause = (alias: string) => pid ? `AND ${alias}.project_id = $1` : ''

    const [issuesRes, docsRes] = await Promise.all([
      pool.query(
        `SELECT 'issue' AS type, i.id, i.title,
                p.name AS project_name, p.color AS project_color
         FROM issues i LEFT JOIN projects p ON p.id = i.project_id
         WHERE i.status IN ('open', 'investigating') ${pidClause('i')}
         ORDER BY i.updated_at DESC LIMIT 3`,
        params
      ),
      pool.query(
        `SELECT 'doc' AS type, d.id, d.title,
                p.name AS project_name, p.color AS project_color
         FROM documents d LEFT JOIN projects p ON p.id = d.project_id
         WHERE 1=1 ${pidClause('d')}
         ORDER BY d.updated_at DESC LIMIT 2`,
        params
      ),
    ])

    res.json({ data: [...issuesRes.rows, ...docsRes.rows] })
  } catch (err) {
    console.error('suggestions error:', err)
    res.status(500).json({ error: 'Suggestions failed' })
  }
})

// ── GET /api/search/history ──────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  try {
    const userId = req.user!.id
    const { rows } = await pool.query(
      `SELECT id, query, created_at
       FROM search_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    )
    res.json({ data: rows })
  } catch (err) {
    console.error('GET /history error:', err)
    res.status(500).json({ error: 'Failed to retrieve search history' })
  }
})

// ── GET /api/search/filters ──────────────────────────────────────────────────
router.get('/filters', async (req, res) => {
  try {
    const userId = req.user!.id
    const { rows } = await pool.query(
      `SELECT id, name, entity_type, filter_json, created_at
       FROM saved_filters
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    )
    res.json({ data: rows })
  } catch (err) {
    console.error('GET /filters error:', err)
    res.status(500).json({ error: 'Failed to retrieve saved filters' })
  }
})

// ── POST /api/search/filters ─────────────────────────────────────────────────
router.post('/filters', async (req, res) => {
  try {
    const userId = req.user!.id
    const { name, entity_type, filter_json } = req.body
    if (!name || typeof name !== 'string' || !entity_type || typeof entity_type !== 'string' || !filter_json) {
      return res.status(400).json({ error: 'Missing name, entity_type, or filter_json' })
    }
    const { rows } = await pool.query(
      `INSERT INTO saved_filters (user_id, name, entity_type, filter_json)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, entity_type, filter_json, created_at`,
      [userId, name, entity_type, JSON.stringify(filter_json)]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    console.error('POST /filters error:', err)
    res.status(500).json({ error: 'Failed to save filter' })
  }
})

// ── DELETE /api/search/filters/:id ───────────────────────────────────────────
router.delete('/filters/:id', async (req, res) => {
  try {
    const userId = req.user!.id
    const { id } = req.params
    const { rowCount } = await pool.query(
      `DELETE FROM saved_filters WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    if (rowCount === 0) {
      return res.status(404).json({ error: 'Filter not found or unauthorized' })
    }
    res.json({ data: { success: true } })
  } catch (err) {
    console.error('DELETE /filters/:id error:', err)
    res.status(500).json({ error: 'Failed to delete filter' })
  }
})

export default router

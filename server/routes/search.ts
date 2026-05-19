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

  try {
    if (!q) {
      // ── Empty query: return recent items from each type ──────────────────
      const pidClause = (alias: string, col = 'project_id') =>
        pid ? `WHERE ${alias}.${col} = $1` : ''
      const params = pid ? [pid] : []

      const [docsRes, issuesRes, commandsRes, releasesRes, runbooksRes] = await Promise.all([
        pool.query(
          `SELECT 'doc' AS type, d.id, d.title, d.file_type AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM documents d LEFT JOIN projects p ON p.id = d.project_id
           ${pidClause('d')} ORDER BY d.created_at DESC LIMIT ${PAGE}`,
          params
        ),
        pool.query(
          `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM issues i LEFT JOIN projects p ON p.id = i.project_id
           ${pidClause('i')} ORDER BY i.created_at DESC LIMIT ${PAGE}`,
          params
        ),
        pool.query(
          `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
                  p.name AS project_name, p.color AS project_color, c.command AS body
           FROM commands c LEFT JOIN projects p ON p.id = c.project_id
           ${pidClause('c')} ORDER BY c.is_favorite DESC, c.last_used DESC NULLS LAST LIMIT ${PAGE}`,
          params
        ),
        pool.query(
          `SELECT 'release' AS type, r.id, r.version AS title, r.type AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM releases r LEFT JOIN projects p ON p.id = r.project_id
           ${pidClause('r')} ORDER BY r.date DESC LIMIT ${PAGE}`,
          params
        ),
        pool.query(
          `SELECT 'runbook' AS type, rb.id, rb.title, NULL::text AS subtype,
                  p.name AS project_name, p.color AS project_color
           FROM runbooks rb LEFT JOIN projects p ON p.id = rb.project_id
           ${pidClause('rb')} ORDER BY rb.last_used_at DESC NULLS LAST, rb.created_at DESC LIMIT ${PAGE}`,
          params
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
      const vec = `[${embedding.join(',')}]`
      const docParams = pid ? [vec, pid] : [vec]

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
         LIMIT ${PAGE}`,
        docParams
      )
    } catch {
      // Ollama not running — fall back to tsvector on documents
      const docParams = pid ? [q, pid] : [q]
      docsRes = await pool.query(
        `SELECT 'doc' AS type, d.id, d.title, d.file_type AS subtype,
                p.name AS project_name, p.color AS project_color
         FROM documents d LEFT JOIN projects p ON p.id = d.project_id
         WHERE (d.tsv @@ plainto_tsquery('english', $1) OR d.title ILIKE '%'||$1||'%') ${pf('d')}
         ORDER BY ts_rank(d.tsv, plainto_tsquery('english', $1)) DESC
         LIMIT ${PAGE}`,
        docParams
      )
    }

    const textParams = pid ? [q, pid] : [q]

    // 2. Issues — tsvector with ts_rank, ILIKE fallback
    let issuesRes = await pool.query(
      `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM issues i LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.tsv @@ plainto_tsquery('english', $1) ${pf('i')}
       ORDER BY ts_rank(i.tsv, plainto_tsquery('english', $1)) DESC
       LIMIT ${PAGE}`,
      textParams
    )
    if (issuesRes.rows.length === 0) {
      issuesRes = await pool.query(
        `SELECT 'issue' AS type, i.id, i.title, i.status AS subtype,
                p.name AS project_name, p.color AS project_color
         FROM issues i LEFT JOIN projects p ON p.id = i.project_id
         WHERE (i.title ILIKE '%'||$1||'%' OR i.description ILIKE '%'||$1||'%') ${pf('i')}
         ORDER BY i.created_at DESC LIMIT ${PAGE}`,
        textParams
      )
    }

    // 3. Commands — tsvector with ts_rank, ILIKE fallback
    let commandsRes = await pool.query(
      `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
              p.name AS project_name, p.color AS project_color, c.command AS body
       FROM commands c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.tsv @@ plainto_tsquery('english', $1) ${pf('c')}
       ORDER BY ts_rank(c.tsv, plainto_tsquery('english', $1)) DESC
       LIMIT ${PAGE}`,
      textParams
    )
    if (commandsRes.rows.length === 0) {
      commandsRes = await pool.query(
        `SELECT 'command' AS type, c.id, c.title, c.language AS subtype,
                p.name AS project_name, p.color AS project_color, c.command AS body
         FROM commands c LEFT JOIN projects p ON p.id = c.project_id
         WHERE (c.title ILIKE '%'||$1||'%' OR c.command ILIKE '%'||$1||'%') ${pf('c')}
         ORDER BY c.is_favorite DESC, c.last_used DESC NULLS LAST LIMIT ${PAGE}`,
        textParams
      )
    }

    // 4. Releases — ILIKE (no tsvector column)
    const releasesRes = await pool.query(
      `SELECT 'release' AS type, r.id, r.version AS title, r.type AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM releases r LEFT JOIN projects p ON p.id = r.project_id
       WHERE (r.version ILIKE '%'||$1||'%' OR r.notes ILIKE '%'||$1||'%') ${pf('r')}
       ORDER BY r.date DESC LIMIT ${PAGE}`,
      textParams
    )

    // 5. Runbooks — ILIKE (no tsvector column)
    const runbooksRes = await pool.query(
      `SELECT 'runbook' AS type, rb.id, rb.title, NULL::text AS subtype,
              p.name AS project_name, p.color AS project_color
       FROM runbooks rb LEFT JOIN projects p ON p.id = rb.project_id
       WHERE (rb.title ILIKE '%'||$1||'%' OR $1 = ANY(rb.tags)) ${pf('rb')}
       ORDER BY rb.last_used_at DESC NULLS LAST, rb.created_at DESC LIMIT ${PAGE}`,
      textParams
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

export default router

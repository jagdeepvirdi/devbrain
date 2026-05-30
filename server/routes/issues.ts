import { Router } from 'express'
import { z }      from 'zod'
import crypto      from 'crypto'
import { pool }   from '../db/pool.js'
import { aiChat, aiEmbed } from '../services/ai.js'
import { buildSetClause }  from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'

function embedIssueAsync(id: string, title: string, description: string): void {
  const text = [title, description].filter(Boolean).join('. ')
  pool.query(`UPDATE issues SET embedding_status = 'processing' WHERE id = $1`, [id]).catch(() => {})
  aiEmbed(text)
    .then(vec => pool.query(
      `UPDATE issues SET embedding = $2, embedding_status = 'done' WHERE id = $1`,
      [id, `[${vec.join(',')}]`]
    ))
    .catch(() => pool.query(`UPDATE issues SET embedding_status = 'failed' WHERE id = $1`, [id]).catch(() => {}))
}

const router = Router()

// ── Zod schemas ───────────────────────────────────────────────────────────

const StepSchema = z.object({
  id:          z.string(),
  order:       z.number().int(),
  instruction: z.string().min(1),
  done:        z.boolean(),
})

const CreateBody = z.object({
  title:               z.string().min(1).max(300).trim(),
  description:         z.string().max(10000).trim().default(''),
  status:              z.enum(['open', 'investigating', 'resolved', 'wont-fix']).default('open'),
  priority:            z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  project_id:          z.string().nullable().optional(),
  tags:                z.array(z.string()).default([]),
  investigation_steps: z.array(StepSchema).default([]),
})

const UpdateBody = z.object({
  title:               z.string().min(1).max(300).trim().optional(),
  description:         z.string().max(10000).optional(),
  status:              z.enum(['open', 'investigating', 'resolved', 'wont-fix']).optional(),
  priority:            z.enum(['low', 'medium', 'high', 'critical']).optional(),
  project_id:          z.string().nullable().optional(),
  tags:                z.array(z.string()).optional(),
  investigation_steps: z.array(StepSchema).optional(),
  resolution:          z.string().max(5000).optional(),
  pr_url:              z.string().url().max(500).nullable().optional(),
})

const NoteBody = z.object({
  content: z.string().min(1).max(5000).trim(),
})

// ── Shared SELECT helper ──────────────────────────────────────────────────
// Returns all issue columns with investigation_steps and notes aggregated
// from relational tables (replacing the legacy JSONB columns).

const ISSUE_COLS = `
  i.id, i.project_id, i.title, i.description, i.status, i.priority,
  i.linked_docs, i.linked_commands, i.pr_url,
  i.resolution, i.tags, i.embedding_status, i.summary,
  i.source, i.external_id,
  i.created_at, i.updated_at, i.resolved_at,
  p.name  AS project_name,
  p.color AS project_color,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object('id', s.id, 'order', s."order", 'instruction', s.instruction, 'done', s.done)
    ) FILTER (WHERE s.id IS NOT NULL),
    '[]'::json
  ) AS investigation_steps,
  COALESCE(
    json_agg(
      DISTINCT jsonb_build_object('id', n.id, 'content', n.content, 'created_at', n.created_at)
    ) FILTER (WHERE n.id IS NOT NULL),
    '[]'::json
  ) AS notes,
  COALESCE(
    (SELECT json_agg(sha) FROM issue_commits ic WHERE ic.issue_id = i.id),
    '[]'::json
  ) AS linked_commits
`

const ISSUE_JOINS = `
  LEFT JOIN projects    p ON p.id = i.project_id
  LEFT JOIN issue_steps s ON s.issue_id = i.id
  LEFT JOIN issue_notes n ON n.issue_id = i.id
`

// ── GET /api/issues ───────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const projectId = req.query.projectId as string | undefined
  const status    = req.query.status    as string | undefined
  const priority  = req.query.priority  as string | undefined
  const search    = req.query.search    as string | undefined
  const limit     = Math.min(Number(req.query.limit  ?? 25), 100)
  const offset    = Number(req.query.offset ?? 0)

  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (projectId === 'global') {
    conditions.push('i.project_id IS NULL')
  } else if (projectId) {
    conditions.push(`i.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (status) {
    conditions.push(`i.status = $${idx++}`)
    values.push(status)
  }

  if (priority) {
    conditions.push(`i.priority = $${idx++}`)
    values.push(priority)
  }

  if (search) {
    conditions.push(`i.tsv @@ plainto_tsquery('english', $${idx++})`)
    values.push(search)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT i.id)::int AS n FROM issues i ${where}`, values),
      pool.query(
        `SELECT ${ISSUE_COLS}
         FROM issues i
         ${ISSUE_JOINS}
         ${where}
         GROUP BY i.id, p.name, p.color
         ORDER BY
           CASE i.priority
             WHEN 'critical' THEN 1
             WHEN 'high'     THEN 2
             WHEN 'medium'   THEN 3
             WHEN 'low'      THEN 4
           END,
           i.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/related ───────────────────────────────────────────────

router.get('/related', async (req, res) => {
  const q     = ((req.query.q as string) || '').trim()
  const limit = Math.min(Number(req.query.limit ?? 3), 10)

  if (!q || q.length < 3) {
    res.json({ data: [] })
    return
  }

  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.title, i.status, i.priority,
              p.name AS project_name, p.color AS project_color,
              ts_rank(i.tsv, plainto_tsquery('english', $1)) AS rank
       FROM issues i
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.tsv @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [q, limit]
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/:id ───────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS}
       FROM issues i
       ${ISSUE_JOINS}
       WHERE i.id = $1
       GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues ──────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, description, status, priority, project_id, tags, investigation_steps } = parsed.data

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO issues (project_id, title, description, status, priority, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [project_id ?? null, title, description, status, priority, tags]
    )
    const issueId = rows[0].id

    for (const step of investigation_steps) {
      await client.query(
        `INSERT INTO issue_steps (id, issue_id, "order", instruction, done) VALUES ($1, $2, $3, $4, $5)`,
        [step.id, issueId, step.order, step.instruction, step.done]
      )
    }

    await client.query('COMMIT')

    // Fetch full issue row with aggregated steps/notes for the response
    const { rows: full } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [issueId]
    )
    res.status(201).json({ data: full[0] })
    embedIssueAsync(issueId, title, description)
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── PUT /api/issues/:id ───────────────────────────────────────────────────

const ISSUE_UPDATABLE_COLS = new Set(['title', 'description', 'status', 'priority', 'project_id', 'tags', 'resolution', 'pr_url'])

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = UpdateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data as Record<string, unknown>
  const newSteps = updates.investigation_steps as typeof parsed.data.investigation_steps | undefined

  // Scalar fields (exclude investigation_steps — handled separately via issue_steps table)
  const fields = Object.keys(updates).filter(k => ISSUE_UPDATABLE_COLS.has(k))
  if (!fields.length && newSteps === undefined) return res.status(400).json({ error: 'Nothing to update' })

  // Set resolved_at when marking resolved/unresolved
  let resolvedClause = ''
  if (updates.status === 'resolved') resolvedClause = ', resolved_at = now()'
  else if (updates.status)           resolvedClause = ', resolved_at = NULL'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // When only steps are changing, verify the issue exists first
    if (!fields.length && !resolvedClause && newSteps !== undefined) {
      const { rows: exist } = await client.query('SELECT id FROM issues WHERE id = $1', [req.params.id])
      if (!exist.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
    }

    // Update scalar columns when present
    if (fields.length || resolvedClause) {
      if (fields.length) {
        const { setClauses, params } = buildSetClause(fields, fields.map(k => updates[k]))
        const { rows } = await client.query(
          `UPDATE issues SET ${setClauses}${resolvedClause} WHERE id = $1 RETURNING id`,
          [req.params.id, ...params]
        )
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
      } else if (resolvedClause) {
        const { rows } = await client.query(
          `UPDATE issues SET updated_at = now()${resolvedClause} WHERE id = $1 RETURNING id`,
          [req.params.id]
        )
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
      }
    }

    // Replace steps atomically when provided
    if (newSteps !== undefined) {
      await client.query('DELETE FROM issue_steps WHERE issue_id = $1', [req.params.id])
      for (const step of newSteps) {
        await client.query(
          `INSERT INTO issue_steps (id, issue_id, "order", instruction, done) VALUES ($1, $2, $3, $4, $5)`,
          [step.id, req.params.id, step.order, step.instruction, step.done]
        )
      }
    }

    await client.query('COMMIT')

    const { rows: full } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!full.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: full[0] })
    if (updates.title || updates.description) {
      embedIssueAsync(full[0].id, full[0].title, full[0].description)
    }
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── DELETE /api/issues/:id ────────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM issues WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/notes ────────────────────────────────────────────

router.post('/:id/notes', requireRole('member'), async (req, res) => {
  const parsed = NoteBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  try {
    // Verify issue exists first
    const { rows: check } = await pool.query('SELECT id FROM issues WHERE id = $1', [req.params.id])
    if (!check.length) return res.status(404).json({ error: 'Issue not found' })

    await pool.query(
      `INSERT INTO issue_notes (id, issue_id, content) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), req.params.id, parsed.data.content]
    )

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/issues/:id/notes/:noteId ─────────────────────────────────

router.delete('/:id/notes/:noteId', requireRole('member'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM issue_notes WHERE id = $1 AND issue_id = $2',
      [req.params.noteId, req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'Note not found' })

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/:id/related-commands ─────────────────────────────────

router.get('/:id/related-commands', async (req, res) => {
  try {
    const { rows: issueRows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!issueRows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = issueRows[0]
    const queryText = [title, description].filter(Boolean).join('. ')
    const embedding = await aiEmbed(queryText)
    const vec = `[${embedding.join(',')}]`

    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.command, c.language, c.description,
              p.name  AS project_name,
              p.color AS project_color,
              1 - (c.embedding <=> $1::vector) AS score
       FROM   commands c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE  c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT 5`,
      [vec]
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/commits — link a commit SHA ─────────────────────

router.post('/:id/commits', requireRole('member'), async (req, res) => {
  const { sha } = req.body as { sha?: string }
  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) {
    res.status(400).json({ error: 'sha must be a valid git SHA' }); return
  }
  try {
    // Get project_id for the issue
    const { rows: issue } = await pool.query('SELECT project_id FROM issues WHERE id = $1', [req.params.id])
    if (!issue.length) { res.status(404).json({ error: 'Issue not found' }); return }

    await pool.query(
      `INSERT INTO issue_commits (issue_id, sha, project_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (issue_id, sha) DO NOTHING`,
      [req.params.id, sha, issue[0].project_id]
    )

    const { rows } = await pool.query('SELECT sha FROM issue_commits WHERE issue_id = $1', [req.params.id])
    res.json({ data: rows.map(r => r.sha) })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ── DELETE /api/issues/:id/commits/:sha — unlink a commit ────────────────

router.delete('/:id/commits/:sha', requireRole('member'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM issue_commits WHERE issue_id = $1 AND sha = $2',
      [req.params.id, req.params.sha]
    )
    const { rows } = await pool.query('SELECT sha FROM issue_commits WHERE issue_id = $1', [req.params.id])
    res.json({ data: rows.map(r => r.sha) })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ── POST /api/issues/:id/suggest-steps ───────────────────────────────────

router.post('/:id/suggest-steps', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = rows[0]

    const prompt = `Issue title: ${title}
${description ? `Description: ${description}\n` : ''}
List 5 to 7 specific, actionable investigation steps a developer should follow to diagnose this issue.
Use backticks for code, commands, file paths, and identifiers.
Output only the numbered list, nothing else.`

    const raw = await aiChat(
      prompt,
      'You are a senior software engineer. Generate concise, actionable debugging steps. Respond with a numbered list only.'
    )

    const steps = raw
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 4)

    res.json({ data: { steps } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/:id/related-docs ──────────────────────────────────────

router.get('/:id/related-docs', async (req, res) => {
  try {
    const { rows: issueRows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!issueRows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = issueRows[0]
    const queryText = [title, description].filter(Boolean).join('. ')

    const embedding = await aiEmbed(queryText)
    const vec = `[${embedding.join(',')}]`

    const { rows } = await pool.query(
      `SELECT doc_id, doc_title, file_type, project_name, project_color, excerpt, score
       FROM (
         SELECT DISTINCT ON (d.id)
           d.id                       AS doc_id,
           d.title                    AS doc_title,
           d.file_type,
           p.name                     AS project_name,
           p.color                    AS project_color,
           left(dc.content, 220)      AS excerpt,
           1 - (dc.embedding <=> $1::vector) AS score
         FROM document_chunks dc
         JOIN documents d  ON d.id = dc.document_id
         LEFT JOIN projects p ON p.id = d.project_id
         ORDER BY d.id, dc.embedding <=> $1::vector ASC
       ) best
       ORDER BY score DESC
       LIMIT 5`,
      [vec]
    )

    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/summarize ────────────────────────────────────────

router.post('/:id/summarize', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    const issue = rows[0]
    const steps  = (issue.investigation_steps as Array<{ instruction: string; done: boolean }>)
    const notes  = (issue.notes as Array<{ content: string; created_at: string }>)

    const prompt = `Issue: ${issue.title}

Description: ${issue.description || '(none)'}

Priority: ${issue.priority} | Status: ${issue.status}

Investigation steps (${steps.filter(s => s.done).length}/${steps.length} done):
${steps.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.instruction}`).join('\n') || '(none)'}

Notes (${notes.length}):
${notes.map(n => `- ${n.content}`).join('\n') || '(none)'}

Resolution: ${issue.resolution || '(none)'}

Please provide a concise summary of:
1. What the issue is about
2. Investigation progress
3. Current status and next steps (if unresolved) or what fixed it (if resolved)`

    const summary = await aiChat(prompt, 'You are a technical assistant helping summarize development issues. Be concise and clear. Format in Markdown.')

    await pool.query('UPDATE issues SET summary = $2 WHERE id = $1', [req.params.id, summary])
    res.json({ data: { summary } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/reembed ──────────────────────────────────────────

router.post('/:id/reembed', requireRole('member'), async (req, res) => {
  const { id } = req.params
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description FROM issues WHERE id = $1', [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    embedIssueAsync(id, rows[0].title, rows[0].description)

    res.json({ data: { id, embedding_status: 'processing' } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/suggest-tags ────────────────────────────────────────────
// Suggests up to 5 tags from issue title + description using AI.
// Must come before /:id param routes — but all /:id routes are defined above,
// so appending here is safe (Express matches routes in registration order).

router.post('/suggest-tags', requireRole('member'), async (req, res) => {
  const { title, description } = req.body as { title?: string; description?: string }
  const text = [title, description].filter(Boolean).join(' ').trim()
  if (!text) return res.status(400).json({ error: 'title or description is required' })

  try {
    const raw = await aiChat(
      `Suggest up to 5 short, lowercase tags for a bug/issue with this title and description:\n"${text.slice(0, 500)}"\n\nReturn ONLY a JSON array of strings, e.g. ["auth","crash","ios"]. No explanation.`,
      'You are a tagging assistant. Return only a valid JSON array of short lowercase tags.'
    )
    const match = raw.match(/\[[\s\S]*\]/)
    const tags: string[] = match ? (JSON.parse(match[0]) as string[]).slice(0, 5) : []
    res.json({ data: { tags } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

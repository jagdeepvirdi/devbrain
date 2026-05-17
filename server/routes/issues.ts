import { Router } from 'express'
import { z }      from 'zod'
import crypto      from 'crypto'
import { pool }   from '../db/pool.js'
import { aiChat, aiEmbed } from '../services/ai.js'

function embedIssueAsync(id: string, title: string, description: string): void {
  const text = [title, description].filter(Boolean).join('. ')
  aiEmbed(text)
    .then(vec => pool.query('UPDATE issues SET embedding = $2 WHERE id = $1', [id, `[${vec.join(',')}]`]))
    .catch(() => {})
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
})

const NoteBody = z.object({
  content: z.string().min(1).max(5000).trim(),
})

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
      pool.query(`SELECT COUNT(*)::int AS n FROM issues i ${where}`, values),
      pool.query(
        `SELECT
           i.*,
           p.name  AS project_name,
           p.color AS project_color
         FROM issues i
         LEFT JOIN projects p ON p.id = i.project_id
         ${where}
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
      `SELECT i.*, p.name AS project_name, p.color AS project_color
       FROM issues i
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues ──────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, description, status, priority, project_id, tags, investigation_steps } = parsed.data

  try {
    const { rows } = await pool.query(
      `INSERT INTO issues
         (project_id, title, description, status, priority, tags, investigation_steps)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [project_id ?? null, title, description, status, priority, tags, JSON.stringify(investigation_steps)]
    )
    res.status(201).json({ data: rows[0] })
    embedIssueAsync(rows[0].id, title, description)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/issues/:id ───────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  const parsed = UpdateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

  // Build SET clause
  const colMap: Record<string, string> = { project_id: 'project_id' }
  const jsonbCols = new Set(['investigation_steps'])
  const fields = Object.keys(updates)
  const setCols = fields.map((k, i) => `${colMap[k] ?? k} = $${i + 2}`).join(', ')
  const values = fields.map(k => {
    const v = (updates as Record<string, unknown>)[k]
    return jsonbCols.has(k) ? JSON.stringify(v) : v
  })

  // Set resolved_at when marking resolved/unresolved
  let resolvedClause = ''
  if (updates.status === 'resolved') resolvedClause = ', resolved_at = now()'
  else if (updates.status)           resolvedClause = ', resolved_at = NULL'

  try {
    const { rows } = await pool.query(
      `UPDATE issues SET ${setCols}${resolvedClause} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: rows[0] })
    if (updates.title || updates.description) {
      embedIssueAsync(rows[0].id, rows[0].title, rows[0].description)
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/issues/:id ────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
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

router.post('/:id/notes', async (req, res) => {
  const parsed = NoteBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const note = {
    id:         crypto.randomUUID(),
    content:    parsed.data.content,
    created_at: new Date().toISOString(),
  }

  try {
    const { rows } = await pool.query(
      `UPDATE issues
       SET notes = notes || $2::jsonb
       WHERE id = $1
       RETURNING *`,
      [req.params.id, JSON.stringify([note])]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/issues/:id/notes/:noteId ─────────────────────────────────

router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE issues
       SET notes = (
         SELECT COALESCE(jsonb_agg(n ORDER BY (n->>'created_at')), '[]'::jsonb)
         FROM jsonb_array_elements(notes) AS n
         WHERE n->>'id' != $2
       )
       WHERE id = $1
       RETURNING *`,
      [req.params.id, req.params.noteId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
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

// ── POST /api/issues/:id/suggest-steps ───────────────────────────────────

router.post('/:id/suggest-steps', async (req, res) => {
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

router.post('/:id/summarize', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM issues WHERE id = $1', [req.params.id])
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

    res.json({ data: { summary } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

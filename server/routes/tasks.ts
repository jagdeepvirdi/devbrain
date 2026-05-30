import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

const TaskBody = z.object({
  title:       z.string().min(1).max(300).trim(),
  description: z.string().max(5000).trim().default(''),
  status:      z.enum(['todo', 'in_progress', 'done', 'cancelled']).default('todo'),
  priority:    z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  project_id:  z.string().nullable().optional(),
  due_date:    z.string().nullable().optional(), // ISO date string YYYY-MM-DD
  tags:        z.array(z.string()).default([]),
})

// ── GET /api/tasks ────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const projectId = req.query.projectId as string | undefined
  const status    = req.query.status    as string | undefined
  const priority  = req.query.priority  as string | undefined

  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx = 1

  if (projectId === 'global') {
    conditions.push('t.project_id IS NULL')
  } else if (projectId) {
    conditions.push(`t.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (status) {
    conditions.push(`t.status = $${idx++}`)
    values.push(status)
  }

  if (priority) {
    conditions.push(`t.priority = $${idx++}`)
    values.push(priority)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const { rows } = await pool.query(
      `SELECT
         t.*,
         p.name  AS project_name,
         p.color AS project_color
       FROM tasks t
       LEFT JOIN projects p ON p.id = t.project_id
       ${where}
       ORDER BY
         CASE t.status
           WHEN 'in_progress' THEN 1
           WHEN 'todo'        THEN 2
           WHEN 'done'        THEN 3
           WHEN 'cancelled'   THEN 4
         END,
         CASE t.priority
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           WHEN 'low'      THEN 4
         END,
         t.created_at DESC`,
      values
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/tasks/import-md ─────────────────────────────────────────────
// Must come before /:id routes.

router.post('/import-md', requireRole('member'), async (req, res) => {
  const { content, projectId } = req.body as { content?: string; projectId?: string }
  if (!content?.trim()) return res.status(400).json({ error: 'content is required' })

  const lines = content.split('\n')
  const items: { title: string; status: string; tag: string }[] = []
  let section = 'Imported'

  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/)
    if (h2) { section = h2[1].trim(); continue }

    const todo = line.match(/^[\s]*-\s+\[ \]\s+(.+)$/)
    const done = line.match(/^[\s]*-\s+\[x\]\s+(.+)$/i)
    if (todo) items.push({ title: todo[1].trim(), status: 'todo', tag: section })
    else if (done) items.push({ title: done[1].trim(), status: 'done', tag: section })
  }

  if (!items.length) return res.status(400).json({ error: 'No checkboxes found in the file' })

  let created = 0
  let skipped = 0

  for (const item of items) {
    try {
      const { rowCount } = await pool.query(
        `INSERT INTO tasks (project_id, title, status, tags, done_at)
         SELECT $1, $2, $3, $4, $5
         WHERE NOT EXISTS (
           SELECT 1 FROM tasks
           WHERE title = $2
             AND (project_id = $1 OR (project_id IS NULL AND $1::text IS NULL))
         )`,
        [projectId ?? null, item.title, item.status, [item.tag],
         item.status === 'done' ? new Date() : null]
      )
      if ((rowCount ?? 0) > 0) created++; else skipped++
    } catch { skipped++ }
  }

  res.json({ data: { created, skipped, total: items.length } })
})

// ── POST /api/tasks ───────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = TaskBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, description, status, priority, project_id, due_date, tags } = parsed.data

  try {
    const { rows } = await pool.query(
      `INSERT INTO tasks (project_id, title, description, status, priority, due_date, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [project_id ?? null, title, description, status, priority, due_date ?? null, tags]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/tasks/:id ────────────────────────────────────────────────────

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = TaskBody.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

  const colMap: Record<string, string> = { project_id: 'project_id', due_date: 'due_date' }
  const fields   = Object.keys(updates)
  const setCols  = fields.map((k, i) => `${colMap[k] ?? k} = $${i + 2}`).join(', ')
  const values   = fields.map(k => (updates as Record<string, unknown>)[k])

  // Auto-set done_at
  let extraClause = ''
  if (updates.status === 'done') {
    extraClause = ', done_at = now()'
  } else if (updates.status) {
    extraClause = ', done_at = NULL'
  }

  try {
    const { rows } = await pool.query(
      `UPDATE tasks SET ${setCols}${extraClause} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (!rows.length) return res.status(404).json({ error: 'Task not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/tasks/:id ─────────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM tasks WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Task not found' })
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

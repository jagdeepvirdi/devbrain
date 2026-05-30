import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

const StepSchema = z.object({
  id:          z.string(),
  order:       z.number(),
  instruction: z.string().min(1).max(1000).trim(),
  command:     z.string().max(5000).optional(),
  note:        z.string().max(1000).optional(),
})

const RunbookBody = z.object({
  title:      z.string().min(1).max(300).trim(),
  project_id: z.string().nullable().optional(),
  tags:       z.array(z.string()).default([]),
  steps:      z.array(StepSchema).default([]),
})

// ── GET /api/runbooks ─────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { projectId, search } = req.query as Record<string, string>

  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx = 1

  if (projectId === 'global') {
    conditions.push('r.project_id IS NULL')
  } else if (projectId) {
    conditions.push(`r.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (search) {
    conditions.push(`r.title ILIKE $${idx++}`)
    values.push(`%${search}%`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const { rows } = await pool.query(
      `SELECT
         r.*,
         p.name  AS project_name,
         p.color AS project_color
       FROM runbooks r
       LEFT JOIN projects p ON p.id = r.project_id
       ${where}
       ORDER BY r.last_used_at DESC NULLS LAST, r.created_at DESC`,
      values
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/runbooks/:id ─────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS project_name, p.color AS project_color
       FROM runbooks r LEFT JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Runbook not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/runbooks ────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = RunbookBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, project_id, tags, steps } = parsed.data

  try {
    const { rows } = await pool.query(
      `INSERT INTO runbooks (project_id, title, tags, steps)
       VALUES ($1, $2, $3, $4::jsonb)
       RETURNING *`,
      [project_id ?? null, title, tags, JSON.stringify(steps)]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/runbooks/:id ─────────────────────────────────────────────────

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = RunbookBody.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })

  // steps needs special cast to jsonb
  const fields  = Object.keys(updates)
  const setCols = fields.map((k, i) =>
    k === 'steps' ? `steps = $${i + 2}::jsonb` : `${k} = $${i + 2}`
  ).join(', ')
  const values  = fields.map(k =>
    k === 'steps' ? JSON.stringify((updates as Record<string, unknown>)[k]) : (updates as Record<string, unknown>)[k]
  )

  try {
    const { rows } = await pool.query(
      `UPDATE runbooks SET ${setCols} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (!rows.length) return res.status(404).json({ error: 'Runbook not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/runbooks/:id ──────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM runbooks WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Runbook not found' })
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/runbooks/:id/use ────────────────────────────────────────────

router.post('/:id/use', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE runbooks SET last_used_at = now() WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Runbook not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

const TemplateCreateSchema = z.object({
  project_id: z.string().nullable().optional(),
  type: z.enum(['issue', 'runbook', 'document']),
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional().default(''),
  body: z.record(z.any()),
})

const TemplateUpdateSchema = z.object({
  project_id: z.string().nullable().optional(),
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  body: z.record(z.any()).optional(),
})

// ── GET /api/templates ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const type = req.query.type as string | undefined
  const projectId = req.query.projectId as string | undefined

  try {
    const conditions: string[] = []
    const values: any[] = []

    if (projectId === 'global' || !projectId) {
      conditions.push('(t.project_id IS NULL OR t.is_builtin = true)')
    } else {
      values.push(projectId)
      conditions.push(`(t.project_id = $${values.length} OR t.project_id IS NULL OR t.is_builtin = true)`)
    }

    if (type) {
      values.push(type)
      conditions.push(`t.type = $${values.length}`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await pool.query(
      `SELECT t.*, p.name AS project_name, p.color AS project_color
       FROM templates t
       LEFT JOIN projects p ON t.project_id = p.id
       ${whereClause}
       ORDER BY t.is_builtin DESC, t.name ASC`,
      values
    )

    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/templates ───────────────────────────────────────────────────
router.post('/', requireRole('member'), async (req, res) => {
  try {
    const parsed = TemplateCreateSchema.parse(req.body)
    const { project_id, type, name, description, body } = parsed

    const { rows } = await pool.query(
      `INSERT INTO templates (project_id, type, name, description, body, is_builtin)
       VALUES ($1, $2, $3, $4, $5, false)
       RETURNING *`,
      [project_id ?? null, type, name, description, JSON.stringify(body)]
    )

    res.status(201).json({ data: rows[0] })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message })
    }
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/templates/:id ────────────────────────────────────────────────
router.put('/:id', requireRole('member'), async (req, res) => {
  const { id } = req.params

  try {
    const parsed = TemplateUpdateSchema.parse(req.body)
    
    // Check if template is built-in
    const { rows: existing } = await pool.query('SELECT is_builtin FROM templates WHERE id = $1', [id])
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    if (existing[0].is_builtin) {
      return res.status(403).json({ error: 'Cannot modify built-in templates' })
    }

    // Build update dynamic clause
    const setFields: string[] = []
    const values: any[] = [id]

    if (parsed.project_id !== undefined) {
      values.push(parsed.project_id ?? null)
      setFields.push(`project_id = $${values.length}`)
    }
    if (parsed.name !== undefined) {
      values.push(parsed.name)
      setFields.push(`name = $${values.length}`)
    }
    if (parsed.description !== undefined) {
      values.push(parsed.description)
      setFields.push(`description = $${values.length}`)
    }
    if (parsed.body !== undefined) {
      values.push(JSON.stringify(parsed.body))
      setFields.push(`body = $${values.length}`)
    }

    if (setFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { rows } = await pool.query(
      `UPDATE templates
       SET ${setFields.join(', ')}
       WHERE id = $1
       RETURNING *`,
      values
    )

    res.json({ data: rows[0] })
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.errors[0].message })
    }
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/templates/:id ─────────────────────────────────────────────
router.delete('/:id', requireRole('member'), async (req, res) => {
  const { id } = req.params

  try {
    // Check if template is built-in
    const { rows: existing } = await pool.query('SELECT is_builtin FROM templates WHERE id = $1', [id])
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Template not found' })
    }
    if (existing[0].is_builtin) {
      return res.status(403).json({ error: 'Cannot delete built-in templates' })
    }

    await pool.query('DELETE FROM templates WHERE id = $1', [id])
    res.json({ data: { success: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

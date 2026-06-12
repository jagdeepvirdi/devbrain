import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { aiChat, aiEmbed } from '../services/ai.js'
import { buildSetClause }  from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'

function embedCommandAsync(id: string, title: string, description: string, command: string): void {

  const text = [title, description, command.slice(0, 400)].filter(Boolean).join('. ')
  aiEmbed(text)
    .then(vec => pool.query('UPDATE commands SET embedding = $2 WHERE id = $1', [id, `[${vec.join(',')}]`]))
    .catch(() => {})
}

const router = Router()

const CommandBody = z.object({
  title:       z.string().min(1).max(300).trim(),
  command:     z.string().min(1).max(10000).trim(),
  language:    z.string().max(50).trim().default('bash'),
  description: z.string().max(2000).trim().default(''),
  project_id:  z.string().nullable().optional(),
  tags:        z.array(z.string()).default([]),
  is_favorite: z.boolean().default(false),
  namespace:   z.enum(['personal', 'team']).default('team'),
})

// ── GET /api/commands ─────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { projectId, language, search, favorite, namespace } = req.query as Record<string, string>
  const limit  = Math.min(Number(req.query.limit  ?? 25), 100)
  const offset = Number(req.query.offset ?? 0)
  const userId = req.user?.id  // may be undefined in dev/legacy mode

  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx = 1

  if (projectId === 'global') {
    conditions.push('c.project_id IS NULL')
  } else if (projectId) {
    conditions.push(`c.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (language) {
    conditions.push(`c.language = $${idx++}`)
    values.push(language)
  }

  if (favorite === 'true') {
    conditions.push('c.is_favorite = true')
  }

  if (namespace === 'personal') {
    // Only the user's own personal commands
    conditions.push(`c.namespace = 'personal'`)
    if (userId && userId !== 'legacy' && userId !== 'dev') {
      conditions.push(`c.created_by = $${idx++}`)
      values.push(userId)
    }
  } else if (namespace === 'team') {
    conditions.push(`c.namespace = 'team'`)
  } else {
    // Default: team commands + own personal commands
    if (userId && userId !== 'legacy' && userId !== 'dev') {
      conditions.push(`(c.namespace = 'team' OR (c.namespace = 'personal' AND c.created_by = $${idx++}))`)
      values.push(userId)
    }
    // In legacy/dev mode, show all
  }

  if (search) {
    conditions.push(`c.tsv @@ plainto_tsquery('english', $${idx++})`)
    values.push(search)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM commands c ${where}`, values),
      pool.query(
        `SELECT
           c.*,
           p.name  AS project_name,
           p.color AS project_color
         FROM commands c
         LEFT JOIN projects p ON p.id = c.project_id
         ${where}
         ORDER BY c.is_favorite DESC, c.last_used DESC NULLS LAST, c.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PATCH /api/commands/bulk ─────────────────────────────────────────────────

router.patch('/bulk', requireRole('member'), async (req, res) => {
  const { ids, action, value } = req.body
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required and cannot be empty' })
  }
  if (!['tag', 'favorite', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (action === 'tag') {
      if (!value || typeof value !== 'string') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'value must be a string tag name' })
      }
      await client.query(
        `UPDATE commands SET tags = array_append(tags, $1) WHERE id = ANY($2) AND NOT ($1 = ANY(tags))`,
        [value, ids]
      )
    } else if (action === 'favorite') {
      const isFav = value !== 'false'
      await client.query(
        `UPDATE commands SET is_favorite = $1 WHERE id = ANY($2)`,
        [isFav, ids]
      )
    } else if (action === 'delete') {
      await client.query(
        `DELETE FROM commands WHERE id = ANY($1)`,
        [ids]
      )
    }
    await client.query('COMMIT')
    res.json({ data: { success: true } })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── GET /api/commands/:id ─────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*, p.name AS project_name, p.color AS project_color
       FROM commands c LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Command not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/commands ────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = CommandBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, command, language, description, project_id, tags, is_favorite, namespace } = parsed.data
  const createdBy = req.user?.id && req.user.id !== 'legacy' && req.user.id !== 'dev' ? req.user.id : null

  try {
    const { rows } = await pool.query(
      `INSERT INTO commands (project_id, title, command, language, description, tags, is_favorite, namespace, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [project_id ?? null, title, command, language, description, tags, is_favorite, namespace, createdBy]
    )
    res.status(201).json({ data: rows[0] })
    embedCommandAsync(rows[0].id, title, description, command)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/commands/:id ─────────────────────────────────────────────────

const COMMAND_UPDATABLE_COLS = new Set(['title', 'command', 'language', 'description', 'project_id', 'tags', 'is_favorite', 'namespace'])

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = CommandBody.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data as Record<string, unknown>
  const fields  = Object.keys(updates).filter(k => COMMAND_UPDATABLE_COLS.has(k))
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })

  const vals = fields.map(k => updates[k])
  const { setClauses, params } = buildSetClause(fields, vals)

  try {
    const { rows } = await pool.query(
      `UPDATE commands SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...params]
    )
    if (!rows.length) return res.status(404).json({ error: 'Command not found' })
    res.json({ data: rows[0] })
    embedCommandAsync(rows[0].id, rows[0].title, rows[0].description, rows[0].command)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/commands/:id ──────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM commands WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Command not found' })
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/commands/:id/use ────────────────────────────────────────────

router.post('/:id/use', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'UPDATE commands SET last_used = now() WHERE id = $1 RETURNING *',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Command not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/commands/:id/explain ───────────────────────────────────────

router.post('/:id/explain', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM commands WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Command not found' })

    const cmd = rows[0] as { command: string; language: string; title: string }
    const explanation = await aiChat(
      `Explain what this ${cmd.language} command does:\n\n\`\`\`${cmd.language}\n${cmd.command}\n\`\`\``,
      'You are a technical assistant that explains commands and code snippets clearly and concisely. Use Markdown for formatting. Cover what it does, what each flag or argument means, and when you would use it. Keep it under 200 words.'
    )
    await pool.query('UPDATE commands SET explanation = $2 WHERE id = $1', [req.params.id, explanation])
    res.json({ data: { explanation } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

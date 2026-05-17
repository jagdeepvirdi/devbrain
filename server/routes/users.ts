import { Router } from 'express'
import bcrypt     from 'bcryptjs'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import { logAudit }    from '../services/audit.js'

const router = Router()

// All user-management routes require admin
router.use(requireRole('admin'))

// ── GET /api/users ────────────────────────────────────────────────────────

router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, role, ldap_dn IS NOT NULL AS is_ldap, created_at
       FROM users ORDER BY created_at ASC`,
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/users ───────────────────────────────────────────────────────

const CreateBody = z.object({
  username: z.string().min(2).max(64).trim(),
  password: z.string().min(6).max(128),
  email:    z.string().email().optional(),
  role:     z.enum(['admin', 'editor', 'viewer']).default('editor'),
})

router.post('/', async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const { username, password, email, role } = parsed.data
  const hash = await bcrypt.hash(password, 10)

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, email, role, created_at`,
      [username, email ?? null, hash, role],
    )
    await logAudit(req.user!.id, req.user!.username, 'user', rows[0].id, username, 'create')
    res.status(201).json({ data: rows[0] })
  } catch (err: unknown) {
    const msg = (err as Error).message
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: 'Username already taken' })
    } else {
      res.status(500).json({ error: msg })
    }
  }
})

// ── PUT /api/users/:id ────────────────────────────────────────────────────

const UpdateBody = z.object({
  email:    z.string().email().optional(),
  role:     z.enum(['admin', 'editor', 'viewer']).optional(),
  password: z.string().min(6).max(128).optional(),
})

router.put('/:id', async (req, res) => {
  const parsed = UpdateBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const updates: Record<string, unknown> = {}
  if (parsed.data.email    !== undefined) updates.email         = parsed.data.email
  if (parsed.data.role     !== undefined) updates.role          = parsed.data.role
  if (parsed.data.password !== undefined) updates.password_hash = await bcrypt.hash(parsed.data.password, 10)

  if (!Object.keys(updates).length) { res.status(400).json({ error: 'Nothing to update' }); return }

  const cols   = Object.keys(updates)
  const values = Object.values(updates)
  const set    = cols.map((c, i) => `${c} = $${i + 1}`).join(', ')

  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${set} WHERE id = $${cols.length + 1}
       RETURNING id, username, email, role, created_at`,
      [...values, req.params.id],
    )
    if (!rows.length) { res.status(404).json({ error: 'User not found' }); return }
    await logAudit(req.user!.id, req.user!.username, 'user', req.params.id, rows[0].username, 'update', { changed: cols })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/users/:id ─────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user!.id) {
    res.status(400).json({ error: 'Cannot delete yourself' })
    return
  }
  try {
    const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username', [req.params.id])
    if (!rows.length) { res.status(404).json({ error: 'User not found' }); return }
    await logAudit(req.user!.id, req.user!.username, 'user', req.params.id, rows[0].username, 'delete')
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/users/me/projects ────────────────────────────────────────────

router.get('/me/projects', requireRole('viewer'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pm.role AS member_role, p.*
       FROM project_members pm
       JOIN projects p ON p.id = pm.project_id
       WHERE pm.user_id = $1`,
      [req.user!.id],
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

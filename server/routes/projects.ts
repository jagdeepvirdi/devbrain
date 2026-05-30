import { Router } from 'express'
import { z } from 'zod'
import { promises as fsPromises } from 'node:fs'
import { pool } from '../db/pool.js'
import { runSeed } from '../db/seed.js'
import { env } from '../lib/env.js'
import { requireRole } from '../middleware/auth.js'
import { refreshProjectWatch } from '../services/tasks-watcher.js'

const router = Router()

// ── Validation ────────────────────────────────────────────────────────────

const ProjectBody = z.object({
  name:        z.string().min(1).max(100).trim(),
  short_name:  z.string().min(1).max(30).trim()
               .regex(/^[a-z0-9-]+$/, 'short_name must be lowercase letters, numbers, hyphens'),
  description: z.string().max(1000).trim().default(''),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'color must be a 6-digit hex code'),
  status:      z.enum(['active', 'paused', 'planning']),
  tech_stack:  z.array(z.string().trim()).default([]),
  type:        z.enum(['mobile', 'web', 'desktop', 'fintech', 'tool']),
  repo_url:    z.string().url('repo_url must be a valid URL').optional().or(z.literal('')),
})

// ── GET /api/projects ─────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const isAdmin = req.user?.role === 'admin'
  const userId  = req.user?.id

  try {
    const query = `
      SELECT
         p.*,
         (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS doc_count,
         (SELECT COUNT(*)::int FROM issues    i WHERE i.project_id = p.id) AS issue_count,
         (SELECT COUNT(*)::int FROM commands  c WHERE c.project_id = p.id) AS command_count,
         (SELECT COUNT(*)::int FROM releases  r WHERE r.project_id = p.id) AS release_count
       FROM projects p
       ${isAdmin ? '' : 'JOIN project_members pm ON pm.project_id = p.id'}
       ${isAdmin ? '' : 'WHERE pm.user_id = $1'}
       ORDER BY p.created_at ASC`
    
    const { rows } = await pool.query(query, isAdmin ? [] : [userId])
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/projects/:id ─────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  const isAdmin = req.user?.role === 'admin'
  const userId  = req.user?.id

  try {
    const query = `
      SELECT
         p.*,
         (SELECT COUNT(*)::int FROM documents d WHERE d.project_id = p.id) AS doc_count,
         (SELECT COUNT(*)::int FROM issues    i WHERE i.project_id = p.id) AS issue_count,
         (SELECT COUNT(*)::int FROM commands  c WHERE c.project_id = p.id) AS command_count,
         (SELECT COUNT(*)::int FROM releases  r WHERE r.project_id = p.id) AS release_count
       FROM projects p
       ${isAdmin ? '' : 'JOIN project_members pm ON pm.project_id = p.id'}
       WHERE p.id = $1 ${isAdmin ? '' : 'AND pm.user_id = $2'}`
    
    const { rows } = await pool.query(query, isAdmin ? [req.params.id] : [req.params.id, userId])
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/projects ────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = ProjectBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const { name, short_name, description, color, status, tech_stack, type, repo_url } = parsed.data

  try {
    const { rows } = await pool.query(
      `INSERT INTO projects (name, short_name, description, color, status, tech_stack, type, repo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, short_name, description, color, status, tech_stack, type, repo_url ?? null]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err: unknown) {
    const msg = (err as Error).message
    if (msg.includes('unique') || msg.includes('short_name')) {
      return res.status(409).json({ error: `short_name "${short_name}" is already taken` })
    }
    res.status(500).json({ error: msg })
  }
})

// ── PUT /api/projects/:id ─────────────────────────────────────────────────

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = ProjectBody.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const updates = parsed.data
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No fields to update' })
  }

  // Build dynamic SET clause
  const fields = Object.keys(updates) as (keyof typeof updates)[]
  const setClauses = fields.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const values = fields.map(k => {
    const v = updates[k]
    return v === '' ? null : v
  })

  try {
    const { rows } = await pool.query(
      `UPDATE projects SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: rows[0] })
  } catch (err: unknown) {
    const msg = (err as Error).message
    if (msg.includes('unique') || msg.includes('short_name')) {
      return res.status(409).json({ error: 'short_name is already taken' })
    }
    res.status(500).json({ error: msg })
  }
})

// ── PUT /api/projects/:id/link ────────────────────────────────────────────

const LinkBody = z.object({
  fs_path: z.string().min(1).nullable(),
})

router.put('/:id/link', requireRole('member'), async (req, res) => {
  const parsed = LinkBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const { fs_path } = parsed.data

  if (fs_path !== null) {
    try {
      const stat = await fsPromises.stat(fs_path)
      if (!stat.isDirectory()) {
        return res.status(422).json({ error: 'fs_path must point to a directory' })
      }
    } catch {
      return res.status(422).json({ error: `Path does not exist or is not accessible: ${fs_path}` })
    }
  }

  try {
    const { rows } = await pool.query(
      `UPDATE projects SET fs_path = $1 WHERE id = $2 RETURNING *`,
      [fs_path, req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })

    // Update file watcher for this project
    await refreshProjectWatch(req.params.id, fs_path)

    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/projects/:id ──────────────────────────────────────────────

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM projects WHERE id = $1 RETURNING id, name`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/projects/seed/reset  (dev only) ─────────────────────────────

router.post('/seed/reset', async (_req, res) => {
  if (env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Seed reset is not allowed in production' })
  }

  try {
    await pool.query(`DELETE FROM projects`)
    await runSeed()
    res.json({ data: { message: 'Seed reset complete' } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Project member routes ─────────────────────────────────────────────────

// GET /api/projects/:id/members
router.get('/:id/members', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pm.role AS member_role, pm.added_at,
              u.id, u.username, u.email, u.role AS global_role
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id
       WHERE pm.project_id = $1
       ORDER BY pm.added_at ASC`,
      [req.params.id],
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

const MemberBody = z.object({
  user_id: z.string().min(1),
  role:    z.enum(['admin', 'member', 'viewer']).default('member'),
})

// POST /api/projects/:id/members
router.post('/:id/members', requireRole('admin'), async (req, res) => {
  const parsed = MemberBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  try {
    const { rows } = await pool.query(
      `INSERT INTO project_members (user_id, project_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, project_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING *`,
      [parsed.data.user_id, req.params.id, parsed.data.role],
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// PUT /api/projects/:id/members/:userId
router.put('/:id/members/:userId', requireRole('admin'), async (req, res) => {
  const { role } = req.body as { role?: string }
  if (!role || !['admin', 'member', 'viewer'].includes(role)) {
    res.status(400).json({ error: 'role must be admin | member | viewer' }); return
  }
  try {
    const { rows } = await pool.query(
      `UPDATE project_members SET role = $1 WHERE project_id = $2 AND user_id = $3 RETURNING *`,
      [role, req.params.id, req.params.userId],
    )
    if (!rows.length) { res.status(404).json({ error: 'Member not found' }); return }
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.params.userId],
    )
    if (!rows.length) { res.status(404).json({ error: 'Member not found' }); return }
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

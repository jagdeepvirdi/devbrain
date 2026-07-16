import { Router } from 'express'
import crypto from 'node:crypto'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { serverError } from '../lib/errors.js'

const router = Router()

const TOKEN_PREFIX = 'dbrn_'

// Dev-mode/legacy sessions have no real row in `users` — api_tokens.user_id
// has an FK to users(id), so token creation would fail for them anyway.
function requireRealUser(req: import('express').Request, res: import('express').Response): string | null {
  const id = req.user?.id
  if (!id || id === 'dev' || id === 'legacy') {
    res.status(400).json({ error: 'API tokens require password authentication to be enabled' })
    return null
  }
  return id
}

// ── GET /api/api-tokens — list current user's tokens (never returns the raw token) ──

router.get('/', async (req, res) => {
  const userId = requireRealUser(req, res)
  if (!userId) return
  try {
    const { rows } = await pool.query(
      `SELECT id, name, token_prefix, last_used_at, expires_at, created_at
       FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    )
    res.json({ data: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/api-tokens — generate a new token (raw value shown once) ──

const CreateBody = z.object({
  name:          z.string().min(1).max(80).trim(),
  expiresInDays: z.number().int().positive().max(3650).optional(),
})

router.post('/', async (req, res) => {
  const userId = requireRealUser(req, res)
  if (!userId) return

  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  const { name, expiresInDays } = parsed.data

  const raw    = TOKEN_PREFIX + crypto.randomBytes(32).toString('hex')
  const hash   = crypto.createHash('sha256').update(raw).digest('hex')
  const prefix = raw.slice(0, 12)
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86400_000) : null

  try {
    const { rows } = await pool.query(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, token_prefix, expires_at, created_at`,
      [userId, name, hash, prefix, expiresAt]
    )
    res.status(201).json({ data: { ...rows[0], token: raw } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── DELETE /api/api-tokens/:id — revoke a token (only your own) ──

router.delete('/:id', async (req, res) => {
  const userId = requireRealUser(req, res)
  if (!userId) return
  try {
    const { rows } = await pool.query(
      'DELETE FROM api_tokens WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Token not found' })
    res.json({ data: { deleted: rows[0].id } })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

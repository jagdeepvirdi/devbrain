import { Router }     from 'express'
import jwt             from 'jsonwebtoken'
import bcrypt          from 'bcryptjs'
import rateLimit       from 'express-rate-limit'
import { z }           from 'zod'
import { pool }        from '../db/pool.js'
import { env }         from '../lib/env.js'
import { ldapAuth }    from '../services/ldap.js'
import { requireAuth } from '../middleware/auth.js'
import { logAudit }    from '../services/audit.js'
import { serverError } from '../lib/errors.js'

const router = Router()

// Pre-computed to equalize response time when a username is not found
const DUMMY_HASH = bcrypt.hashSync('devbrain-timing-guard-unused', 10)

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge:   30 * 24 * 60 * 60 * 1000,  // 30 days
}

function signToken(userId: string, username: string, role: string): string {
  return jwt.sign(
    { userId, username, role },
    env.JWT_SECRET,
    { expiresIn: '30d', issuer: 'devbrain', audience: 'devbrain-client' },
  )
}

// ── POST /api/auth/login ──────────────────────────────────────────────────

const loginLimiter = rateLimit({
  windowMs:       15 * 60 * 1000,  // 15 minutes
  max:            10,
  standardHeaders: true,
  legacyHeaders:  false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many login attempts — try again in 15 minutes' })
  },
})

router.post('/login', loginLimiter, async (req, res) => {
  // Dev mode — no auth configured
  if (!env.AUTH_PASSWORD) {
    const token = jwt.sign(
      { userId: 'dev', username: 'dev', role: 'admin', dev: true },
      env.JWT_SECRET,
      { expiresIn: '30d' },
    )
    res.json({ data: { token, devMode: true, user: { id: 'dev', username: 'dev', role: 'admin' } } })
    return
  }

  const { username, password } = req.body as { username?: string; password?: string }
  if (typeof password !== 'string' || !password) {
    res.status(400).json({ error: 'password is required' })
    return
  }

  // ── Check if any users exist in the DB ────────────────────────────────
  const { rows: countRows } = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')
  const hasUsers = countRows[0].n > 0

  if (!hasUsers) {
    // Legacy single-password mode — accept any username + AUTH_PASSWORD
    if (password !== env.AUTH_PASSWORD) {
      res.status(401).json({ error: 'Incorrect password' })
      return
    }

    const name = (typeof username === 'string' && username.trim()) ? username.trim() : 'admin'
    const hash = await bcrypt.hash(password, 10)
    const { rows } = await pool.query<{ id: string; role: string }>(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, username, role`,
      [name, hash],
    )
    const user  = rows[0]
    const token = signToken(user.id, name, user.role)
    res.cookie('devbrain_token', token, COOKIE_OPTS)
    res.json({ data: { token, devMode: false, user: { id: user.id, username: name, role: user.role } } })
    return
  }

  // ── Multi-user mode ───────────────────────────────────────────────────
  if (!username || !username.trim()) {
    res.status(400).json({ error: 'username is required' })
    return
  }

  const uname = username.trim()

  const { rows: userRows } = await pool.query<{
    id: string; username: string; role: string; password_hash: string | null
  }>('SELECT id, username, role, password_hash FROM users WHERE username = $1', [uname])

  if (userRows.length && userRows[0].password_hash) {
    const ok = await bcrypt.compare(password, userRows[0].password_hash)
    if (!ok) { res.status(401).json({ error: 'Invalid credentials' }); return }
    const u     = userRows[0]
    const token = signToken(u.id, u.username, u.role)
    res.cookie('devbrain_token', token, COOKIE_OPTS)
    res.json({ data: { token, devMode: false, user: { id: u.id, username: u.username, role: u.role } } })
    return
  }

  // User not found or LDAP-only — run dummy bcrypt to equalize response time
  await bcrypt.compare(password, DUMMY_HASH)

  // Try LDAP if configured
  const ldapUser = await ldapAuth(uname, password)
  if (ldapUser) {
    const { rows: ldapRows } = await pool.query<{ id: string; role: string }>(
      `INSERT INTO users (username, email, ldap_dn, role)
       VALUES ($1, $2, $3, 'member')
       ON CONFLICT (username) DO UPDATE
         SET email = EXCLUDED.email, ldap_dn = EXCLUDED.ldap_dn
       RETURNING id, username, role`,
      [ldapUser.username, ldapUser.email, ldapUser.dn],
    )
    const u     = ldapRows[0]
    const token = signToken(u.id, ldapUser.username, u.role)
    res.cookie('devbrain_token', token, COOKIE_OPTS)
    res.json({ data: { token, devMode: false, user: { id: u.id, username: ldapUser.username, role: u.role } } })
    return
  }

  res.status(401).json({ error: 'Invalid credentials' })
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────

router.post('/logout', (_req, res) => {
  res.clearCookie('devbrain_token')
  res.json({ data: { ok: true } })
})

// ── POST /api/auth/register ───────────────────────────────────────────────

const RegisterBody = z.object({
  username: z.string().min(2).max(64).trim(),
  password: z.string().min(6).max(128),
  email:    z.string().email().optional(),
  role:     z.enum(['admin', 'member', 'viewer']).default('member'),
})

const JWT_VERIFY_OPTS: jwt.VerifyOptions = {
  issuer:   'devbrain',
  audience: 'devbrain-client',
}

router.post('/register', async (req, res) => {
  const { rows: countRows } = await pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')
  const firstRun = countRows[0].n === 0

  if (!firstRun) {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) { res.status(401).json({ error: 'Unauthorized' }); return }
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET, JWT_VERIFY_OPTS) as Record<string, unknown>
      if (payload.role !== 'admin') { res.status(403).json({ error: 'Admin role required' }); return }
    } catch {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
  }

  const parsed = RegisterBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const { username, password, email, role } = parsed.data
  const hash = await bcrypt.hash(password, 10)

  try {
    const { rows } = await pool.query<{ id: string; username: string; role: string }>(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, username, role`,
      [username, email ?? null, hash, firstRun ? 'admin' : role],
    )
    const u     = rows[0]
    const token = signToken(u.id, u.username, u.role)
    if (firstRun) res.cookie('devbrain_token', token, COOKIE_OPTS)
    res.status(201).json({ data: { token, user: { id: u.id, username: u.username, role: u.role } } })
  } catch (err: unknown) {
    const msg = (err as Error).message
    if (msg.includes('unique') || msg.includes('duplicate')) {
      res.status(409).json({ error: 'Username already taken' })
    } else {
      serverError(res, err)
    }
  }
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  if (!env.AUTH_PASSWORD) {
    res.json({ data: { authed: true, devMode: true, user: { id: 'dev', username: 'dev', role: 'admin' } } })
    return
  }

  const cookieToken: string | undefined = (req as unknown as Record<string, Record<string, string>>).cookies?.devbrain_token
  const bearerToken = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined
  const token = cookieToken ?? bearerToken

  if (!token) { res.json({ data: { authed: false } }); return }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTS) as Record<string, unknown>
    if (payload.userId) {
      res.json({ data: { authed: true, devMode: false, user: { id: payload.userId, username: payload.username, role: payload.role } } })
    } else {
      res.json({ data: { authed: false } })
    }
  } catch {
    res.json({ data: { authed: false } })
  }
})

// ── POST /api/auth/change-password ───────────────────────────────────────

const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(6).max(128),
})

router.post('/change-password', requireAuth, async (req, res) => {
  const parsed = ChangePasswordBody.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'currentPassword and newPassword (min 6 chars) are required' })
    return
  }
  const { currentPassword, newPassword } = parsed.data

  const userId = req.user!.id
  if (userId === 'legacy' || userId === 'dev') {
    res.status(400).json({ error: 'Cannot change password in legacy/dev mode' })
    return
  }

  const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [userId])
  if (!rows.length || !rows[0].password_hash) { res.status(404).json({ error: 'User not found or is LDAP-only' }); return }

  const ok = await bcrypt.compare(currentPassword, rows[0].password_hash)
  if (!ok) { res.status(401).json({ error: 'Current password is incorrect' }); return }

  const hash = await bcrypt.hash(newPassword, 10)
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, userId])
  await logAudit(userId, req.user!.username, 'user', userId, req.user!.username, 'update', { changed: ['password_hash'] })
  res.json({ data: { ok: true } })
})

export default router

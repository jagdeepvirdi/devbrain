import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'
import { env } from '../lib/env.js'
import { pool } from '../db/pool.js'

export type UserRole = 'admin' | 'member' | 'viewer'

export interface AuthUser {
  id:       string
  username: string
  role:     UserRole
}

declare global {
  // Express's own type augmentation pattern requires an ambient namespace here — there's no
  // ES2015-module equivalent for merging into a global namespace.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, member: 1, admin: 2 }

const JWT_VERIFY_OPTS: jwt.VerifyOptions = {
  issuer:   'devbrain',
  audience: 'devbrain-client',
}

// Personal access tokens (Settings > Account > API Tokens) use this prefix so
// requireAuth can tell them apart from JWTs without a DB round-trip for the
// common (cookie/JWT) case.
export const API_TOKEN_PREFIX = 'dbrn_'

export async function tryApiToken(token: string): Promise<AuthUser | null> {
  const hash = crypto.createHash('sha256').update(token).digest('hex')
  const { rows } = await pool.query<{ token_id: string; user_id: string; username: string; role: UserRole; expires_at: string | null }>(
    `SELECT t.id AS token_id, t.user_id, t.expires_at, u.username, u.role
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [hash]
  )
  if (!rows.length) return null

  const row = rows[0]
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null

  pool.query('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.token_id]).catch(() => {})

  return { id: row.user_id, username: row.username, role: row.role }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.AUTH_PASSWORD) {
    req.user = { id: 'dev', username: 'dev', role: 'admin' }
    return next()
  }

  // Accept token from HttpOnly cookie or Authorization header (for API clients)
  const cookieToken: string | undefined = (req as unknown as Record<string, Record<string, string>>).cookies?.devbrain_token
  const bearerToken  = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : undefined

  const token = cookieToken ?? bearerToken

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  if (token.startsWith(API_TOKEN_PREFIX)) {
    try {
      const user = await tryApiToken(token)
      if (!user) { res.status(401).json({ error: 'Invalid or expired API token' }); return }
      req.user = user
      next()
    } catch {
      res.status(401).json({ error: 'Invalid or expired API token' })
    }
    return
  }

  try {
    const payload = jwt.verify(token, env.JWT_SECRET, JWT_VERIFY_OPTS) as Record<string, unknown>

    if (payload.userId && payload.username && payload.role) {
      req.user = {
        id:       payload.userId  as string,
        username: payload.username as string,
        role:     payload.role    as UserRole,
      }
      next()
    } else {
      // Token missing required fields — must re-login (legacy tokens lack userId)
      res.status(401).json({ error: 'Session expired — please log in again' })
    }
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function requireRole(minRole: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role ?? 'viewer'
    if (ROLE_RANK[role] >= ROLE_RANK[minRole]) {
      next()
    } else {
      res.status(403).json({ error: `Requires ${minRole} role` })
    }
  }
}

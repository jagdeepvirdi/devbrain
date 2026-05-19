import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env.js'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id:       string
  username: string
  role:     UserRole
}

declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2 }

const JWT_VERIFY_OPTS: jwt.VerifyOptions = {
  issuer:   'devbrain',
  audience: 'devbrain-client',
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
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

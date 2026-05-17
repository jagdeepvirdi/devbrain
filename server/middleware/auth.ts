import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { env } from '../lib/env.js'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthUser {
  id:       string
  username: string
  role:     UserRole
}

// Augment Express Request type
declare global {
  namespace Express {
    interface Request { user?: AuthUser }
  }
}

const ROLE_RANK: Record<UserRole, number> = { viewer: 0, editor: 1, admin: 2 }

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!env.AUTH_PASSWORD) {
    // Dev mode — synthetic admin user so audit/RBAC code still has a user
    req.user = { id: 'dev', username: 'dev', role: 'admin' }
    return next()
  }

  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  try {
    const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as Record<string, unknown>

    if (payload.userId && payload.username && payload.role) {
      // v2 JWT with full user info
      req.user = {
        id:       payload.userId  as string,
        username: payload.username as string,
        role:     payload.role    as UserRole,
      }
    } else {
      // Legacy single-user token { authed: true } — treat as admin
      req.user = { id: 'legacy', username: 'admin', role: 'admin' }
    }

    next()
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

import type { Response } from 'express'
import { env } from './env.js'

export function serverError(res: Response, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[server error]', err)
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : msg,
  })
}

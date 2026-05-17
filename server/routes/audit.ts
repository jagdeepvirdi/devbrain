import { Router } from 'express'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import type { AuditEvent } from '../services/audit.js'

const router = Router()

// ── GET /api/audit ────────────────────────────────────────────────────────
// Admin only. Supports ?entityType=&entityId=&userId=&limit=&offset=

router.get('/', requireRole('admin'), async (req, res) => {
  const { entityType, entityId, userId } = req.query as Record<string, string>
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const conditions: string[] = []
  const values:     unknown[] = []
  let   idx = 1

  if (entityType) { conditions.push(`a.entity_type = $${idx++}`); values.push(entityType) }
  if (entityId)   { conditions.push(`a.entity_id   = $${idx++}`); values.push(entityId) }
  if (userId)     { conditions.push(`a.user_id     = $${idx++}`); values.push(userId) }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM audit_events a ${where}`, values),
      pool.query<AuditEvent>(
        `SELECT a.* FROM audit_events a ${where}
         ORDER BY a.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset],
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

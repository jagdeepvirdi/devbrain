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

// ── GET /api/audit/export ─────────────────────────────────────────────────
// Admin only. Exports all audit events as CSV.

router.get('/export', requireRole('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query<AuditEvent>(
      'SELECT a.* FROM audit_events a ORDER BY a.created_at DESC'
    )
    
    let csv = 'ID,Date,User,Action,Entity,Entity Name,Metadata\n'
    for (const r of rows) {
      const meta = r.metadata ? JSON.stringify(r.metadata).replace(/"/g, '""') : ''
      csv += `${r.id},${r.created_at},${r.username ?? 'system'},${r.action},${r.entity_type},"${(r.entity_name ?? '').replace(/"/g, '""')}","${meta}"\n`
    }

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="devbrain-audit-${new Date().toISOString().slice(0, 10)}.csv"`)
    res.send(csv)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

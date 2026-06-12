import { Router } from 'express'
import { pool } from '../db/pool.js'

const router = Router()

// ── GET /api/notifications ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const userId = req.user!.id
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  try {
    const [countRes, unreadRes, dataRes] = await Promise.all([
      pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1`,
        [userId]
      ),
      pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND read = false`,
        [userId]
      ),
      pool.query(
        `SELECT * FROM notifications 
         WHERE user_id = $1 
         ORDER BY created_at DESC 
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      ),
    ])

    res.json({
      data: {
        items: dataRes.rows,
        total: countRes.rows[0].n,
        unread_count: unreadRes.rows[0].n
      }
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PATCH /api/notifications/read-all ──────────────────────────────────────
router.patch('/read-all', async (req, res) => {
  const userId = req.user!.id

  try {
    await pool.query(
      `UPDATE notifications 
       SET read = true 
       WHERE user_id = $1`,
      [userId]
    )

    res.json({ data: { success: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PATCH /api/notifications/:id/read ──────────────────────────────────────
router.patch('/:id/read', async (req, res) => {
  const userId = req.user!.id
  const { id } = req.params

  try {
    const { rows } = await pool.query(
      `UPDATE notifications 
       SET read = true 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [id, userId]
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' })
    }

    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

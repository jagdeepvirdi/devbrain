import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { sendAppriseNotification } from '../services/notifier.js'
import { getUsersToNotify } from '../services/notifications.js'
import { requireAuth } from '../middleware/auth.js'
import { encrypt, decrypt } from '../services/crypto.js'

const router = Router()

// ── POST /api/notify (Public hook for Claude Code sessions or other tools) ───
router.post('/', async (req, res) => {
  const { project: shortName, title, body, level = 'info' } = req.body
  if (!shortName || !title || !body) {
    return res.status(400).json({ error: 'Missing required fields: project, title, body' })
  }

  try {
    const { rows: projRows } = await pool.query('SELECT * FROM projects WHERE short_name = $1', [shortName])
    if (!projRows.length) {
      return res.status(404).json({ error: 'Project not found' })
    }
    const project = projRows[0]

    const userIds = await getUsersToNotify(project.id)
    let sentCount = 0
    for (const userId of userIds) {
      const results = await sendAppriseNotification({
        userId,
        title,
        body,
        level,
        projectId: project.id
      })
      sentCount += results.length
    }

    res.json({ data: { success: true, delivered_to: sentCount } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/notify/send-digest (Internal loopback for daily digests) ───────
router.post('/send-digest', async (req, res) => {
  const ip = req.socket.remoteAddress
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    return res.status(403).json({ error: 'Forbidden — localhost only' })
  }

  const { title, body, userId } = req.body
  if (!title || !body || !userId) {
    return res.status(400).json({ error: 'Missing required fields: title, body, userId' })
  }

  try {
    const results = await sendAppriseNotification({
      userId,
      title,
      body,
      level: 'info'
    })
    res.json({ data: { success: true, details: results } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/notify/log (Paginated log for external deliveries) ──────────────
router.get('/log', requireAuth, async (req, res) => {
  const userId = req.user!.id
  const { project, level, channel, status, dateFrom, dateTo } = req.query as Record<string, string>
  const limit  = Math.min(Number(req.query.limit  ?? 50), 200)
  const offset = Number(req.query.offset ?? 0)

  const conditions: string[] = [`n.user_id = $1`, `n.channel != 'in_app'`]
  const values: unknown[] = [userId]
  let idx = 2

  if (project) {
    conditions.push(`n.entity_id = $${idx++}`)
    values.push(project)
  }
  if (level) {
    conditions.push(`n.type = $${idx++}`)
    values.push(`external_${level}`)
  }
  if (channel) {
    conditions.push(`n.channel = $${idx++}`)
    values.push(channel.toLowerCase())
  }
  if (status) {
    conditions.push(`n.delivery_status = $${idx++}`)
    values.push(status)
  }
  if (dateFrom) {
    conditions.push(`n.created_at >= $${idx++}`)
    values.push(new Date(dateFrom))
  }
  if (dateTo) {
    conditions.push(`n.created_at <= $${idx++}`)
    values.push(new Date(dateTo))
  }

  const where = `WHERE ${conditions.join(' AND ')}`

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM notifications n ${where}`, values),
      pool.query(
        `SELECT n.*, p.name AS project_name, p.color AS project_color
         FROM notifications n
         LEFT JOIN projects p ON p.id = n.entity_id AND n.entity_type = 'project'
         ${where}
         ORDER BY n.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ])

    res.json({
      data: {
        items: dataRes.rows,
        total: countRes.rows[0].n
      }
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/notify/test (Test user's external delivery channels) ───────────
router.post('/test', requireAuth, async (req, res) => {
  const userId = req.user!.id
  try {
    const results = await sendAppriseNotification({
      userId,
      title: 'DevBrain Test Notification',
      body: 'This is a test notification dispatched from your DevBrain settings.',
      level: 'success'
    })

    if (results.length === 0) {
      return res.status(400).json({ error: 'No notification channels configured or enabled.' })
    }

    const anyFailed = results.some(r => r.delivery_status === 'failed')
    if (anyFailed) {
      return res.status(500).json({ error: 'One or more notification channels failed to deliver.', details: results })
    }

    res.json({ data: { success: true, details: results } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/notify/retry/:id (Retry failed notification) ───────────────────
router.post('/retry/:id', requireAuth, async (req, res) => {
  const userId = req.user!.id
  const { id } = req.params

  try {
    const { rows } = await pool.query(
      `SELECT * FROM notifications WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Notification not found' })

    const notif = rows[0]
    const level = notif.type.replace('external_', '')

    const results = await sendAppriseNotification({
      userId,
      title: notif.title,
      body: notif.body,
      level,
      projectId: notif.entity_type === 'project' ? notif.entity_id : null
    })

    // Clean up old failed notification log entry on retry success
    const anySent = results.some(r => r.delivery_status === 'sent')
    if (anySent) {
      await pool.query('DELETE FROM notifications WHERE id = $1', [id])
    }

    res.json({ data: { success: true, details: results } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Apprise Channels CRUD ────────────────────────────────────────────────────
router.get('/channels', requireAuth, async (req, res) => {
  const userId = req.user!.id
  try {
    const { rows } = await pool.query(
      `SELECT id, name, apprise_url, enabled, created_at 
       FROM notification_channels 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    )

    const masked = rows.map(r => {
      let decrypted = ''
      try { decrypted = decrypt(r.apprise_url) } catch { decrypted = '' }
      let maskedUrl = decrypted
      if (decrypted.length > 15) {
        maskedUrl = decrypted.slice(0, 8) + '...' + decrypted.slice(-6)
      }
      return {
        ...r,
        apprise_url: maskedUrl
      }
    })

    res.json({ data: masked })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

const ChannelSchema = z.object({
  name: z.string().min(1).max(100),
  apprise_url: z.string().min(1).max(500),
  enabled: z.boolean().default(true)
})

router.post('/channels', requireAuth, async (req, res) => {
  const userId = req.user!.id
  const parsed = ChannelSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { name, apprise_url, enabled } = parsed.data
  const urlEnc = encrypt(apprise_url)

  try {
    const { rows } = await pool.query(
      `INSERT INTO notification_channels (user_id, name, apprise_url, enabled)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, enabled, created_at`,
      [userId, name, urlEnc, enabled]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.delete('/channels/:id', requireAuth, async (req, res) => {
  const userId = req.user!.id
  const { id } = req.params
  try {
    await pool.query(
      `DELETE FROM notification_channels WHERE id = $1 AND user_id = $2`,
      [id, userId]
    )
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.patch('/channels/:id', requireAuth, async (req, res) => {
  const userId = req.user!.id
  const { id } = req.params
  const { enabled } = req.body
  if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'enabled boolean required' })

  try {
    const { rows } = await pool.query(
      `UPDATE notification_channels 
       SET enabled = $1 
       WHERE id = $2 AND user_id = $3
       RETURNING id, name, enabled`,
      [enabled, id, userId]
    )
    if (!rows.length) return res.status(404).json({ error: 'Channel not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Project Notification Preferences ──────────────────────────────────────────
router.get('/project-prefs', requireAuth, async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM project_notification_prefs`)
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.put('/project-prefs', requireAuth, async (req, res) => {
  const { project_id, channel_id, enabled } = req.body
  if (!project_id || !channel_id || typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'Missing project_id, channel_id, or enabled boolean' })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO project_notification_prefs (project_id, channel_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (project_id, channel_id) DO UPDATE SET enabled = EXCLUDED.enabled
       RETURNING *`,
      [project_id, channel_id, enabled]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

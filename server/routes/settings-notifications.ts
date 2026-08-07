import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { serverError } from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'

// Notification rules and digest scheduling — split out of routes/settings.ts
// (TASKS.md Phase 39 Tier 2 god-file split). Mounted at the same /api/settings base.

const router = Router()

// ── GET /api/settings/notifications ─────────────────────────────────────────

router.get('/notifications', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'notification_rules'`)
    const cfg = rows[0]?.value ?? {
      stale_threshold_days: 14,
      stale_issues_enabled: true,
      sync_alerts_enabled: true,
      ai_task_alerts_enabled: true
    }
    res.json({ data: cfg })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PUT /api/settings/notifications ─────────────────────────────────────────

const NotificationsRulesBody = z.object({
  stale_threshold_days: z.number().int().min(1).max(365).default(14),
  stale_issues_enabled: z.boolean().default(true),
  sync_alerts_enabled: z.boolean().default(true),
  ai_task_alerts_enabled: z.boolean().default(true),
})

router.put('/notifications', requireRole('admin'), async (req, res) => {
  const parsed = NotificationsRulesBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('notification_rules', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(parsed.data)],
    )
    res.json({ data: parsed.data })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/settings/digest ─────────────────────────────────────────

router.get('/digest', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'digest_settings'`)
    const cfg = rows[0]?.value ?? {
      enabled: false,
      time: '09:00'
    }
    res.json({ data: cfg })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PUT /api/settings/digest ─────────────────────────────────────────

const DigestSettingsBody = z.object({
  enabled: z.boolean().default(false),
  time: z.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, "Invalid time format (HH:MM)").default("09:00"),
})

router.put('/digest', requireRole('admin'), async (req, res) => {
  const parsed = DigestSettingsBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('digest_settings', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(parsed.data)],
    )
    res.json({ data: parsed.data })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

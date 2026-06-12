import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { requireRole } from '../middleware/auth.js'
import { syncGitHub, syncJira, syncLinear } from '../services/integrations.js'
import { createNotification } from '../services/notifications.js'

const router = Router()

// ── GET /api/integrations/config ──────────────────────────────────────────

router.get('/config', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, project_id, external_project_id, token_enc IS NOT NULL AS has_token, last_synced_at, config 
       FROM integrations`,
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/integrations — create or update an integration ──────────────

const IntegrationBody = z.object({
  provider:            z.enum(['github', 'jira', 'linear']),
  project_id:          z.string().uuid(),
  external_project_id: z.string().min(1),
  token:               z.string().optional(),
  config:              z.record(z.unknown()).default({}),
})

router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = IntegrationBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { provider, project_id, external_project_id, token, config } = parsed.data
  const tokenEnc = token ? encrypt(token) : null

  try {
    const { rows } = await pool.query(
      `INSERT INTO integrations (provider, project_id, external_project_id, token_enc, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, provider) DO UPDATE SET
         external_project_id = EXCLUDED.external_project_id,
         token_enc = COALESCE(EXCLUDED.token_enc, integrations.token_enc),
         config = EXCLUDED.config,
         updated_at = now()
       RETURNING id, provider, project_id, external_project_id, last_synced_at, config`,
      [provider, project_id, external_project_id, tokenEnc, config]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/integrations/:id ──────────────────────────────────────────

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM integrations WHERE id = $1', [req.params.id])
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/integrations/:id/sync ───────────────────────────────────────

router.post('/:id/sync', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM integrations WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Integration not found' })

    const integration = rows[0]
    const token = integration.token_enc ? decrypt(integration.token_enc) : null

    let result = { created: 0, skipped: 0, total: 0 }

    if (integration.provider === 'github') {
      result = await syncGitHub(integration, token)
    } else if (integration.provider === 'jira') {
      result = await syncJira(integration, token)
    } else if (integration.provider === 'linear') {
      result = await syncLinear(integration, token)
    }

    await pool.query('UPDATE integrations SET last_synced_at = now() WHERE id = $1', [req.params.id])

    // Hook: notifications
    try {
      const { rows: settingsRows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'notification_rules'`)
      const rules = settingsRows[0]?.value ?? {}
      if (rules.sync_alerts_enabled !== false) {
        await createNotification(req.user!.id, {
          type: 'sync_complete',
          title: `Sync Complete: ${integration.provider}`,
          body: `Successfully imported ${result.created} new issues from ${integration.provider}.`,
          entityType: 'project',
          entityId: integration.project_id
        })
      }
    } catch (err) {
      console.error('Failed to create integration sync notification:', err)
    }

    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})


export default router

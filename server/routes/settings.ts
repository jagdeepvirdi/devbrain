import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { env } from '../lib/env.js'
import { requireRole } from '../middleware/auth.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { ldapAuth, type LdapConfig } from '../services/ldap.js'
import settingsBackupRouter        from './settings-backup.js'
import settingsNotificationsRouter from './settings-notifications.js'

const router = Router()

// ── GET /api/settings/ldap ────────────────────────────────────────────────

router.get('/ldap', requireRole('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'ldap_settings'`)
    const cfg = rows[0]?.value as (LdapConfig & { bindPasswordEnc?: string }) | undefined
    if (!cfg) return res.json({ data: null })

    res.json({ data: {
      url:        cfg.url,
      bindDn:     cfg.bindDn,
      searchBase: cfg.searchBase,
      userAttr:   cfg.userAttr,
      hasPassword: !!cfg.bindPasswordEnc
    } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/settings/ldap ────────────────────────────────────────────────

const LdapBody = z.object({
  url:          z.string().min(1),
  bindDn:       z.string().min(1),
  bindPassword: z.string().optional(),
  searchBase:   z.string().min(1),
  userAttr:     z.string().min(1).default('uid'),
})

router.put('/ldap', requireRole('admin'), async (req, res) => {
  const parsed = LdapBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'ldap_settings'`)
    const existing = (rows[0]?.value ?? {}) as LdapConfig & { bindPasswordEnc?: string }

    const { bindPassword, ...rest } = parsed.data
    const value = {
      ...rest,
      bindPasswordEnc: bindPassword ? encrypt(bindPassword) : existing.bindPasswordEnc
    }

    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('ldap_settings', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(value)],
    )
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/settings/ldap/test ──────────────────────────────────────────

router.post('/ldap/test', requireRole('admin'), async (req, res) => {
  const { username, password, ...config } = req.body as Partial<LdapConfig> & { username?: string; password?: string }
  if (!username || !password) return res.status(400).json({ error: 'Test username and password required' })

  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'ldap_settings'`)
    const existing = (rows[0]?.value ?? {}) as LdapConfig & { bindPasswordEnc?: string }

    const testConfig: LdapConfig = {
      url:          config.url        ?? existing.url,
      bindDn:       config.bindDn     ?? existing.bindDn,
      searchBase:   config.searchBase ?? existing.searchBase,
      userAttr:     config.userAttr   ?? existing.userAttr ?? 'uid',
      bindPassword: config.bindPassword ?? (existing.bindPasswordEnc ? decrypt(existing.bindPasswordEnc) : ''),
    }

    const user = await ldapAuth(username, password, testConfig)
    if (user) {
      res.json({ data: { ok: true, user } })
    } else {
      res.status(401).json({ error: 'LDAP authentication failed with these settings' })
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// GET /api/settings
router.get('/', (_req, res) => {
  res.json({
    data: {
      ai: {
        backend:    env.AI_PROVIDER,
        chatModel:  env.AI_PROVIDER === 'claude'
          ? 'claude-sonnet-4-6'
          : env.AI_PROVIDER === 'gemini'
          ? env.GEMINI_CHAT_MODEL
          : env.OLLAMA_CHAT_MODEL,
        embedModel: 'nomic-embed-text',
        ollamaUrl:  env.OLLAMA_URL,
      },
      auth: {
        enabled: !!env.AUTH_PASSWORD,
        devMode: !env.AUTH_PASSWORD,
      },
    }
  })
})

// ── GET /api/settings/claude ──────────────────────────────────────────────

router.get('/claude', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'claude_scan_root'`
    )
    const value = rows[0]?.value as { scan_root: string | null } | undefined
    res.json({ data: { scan_root: value?.scan_root ?? null } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/settings/claude ──────────────────────────────────────────────

const ClaudeSettingsBody = z.object({
  scan_root: z.string().min(1).nullable(),
})

router.put('/claude', requireRole('admin'), async (req, res) => {
  const parsed = ClaudeSettingsBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('claude_scan_root', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ scan_root: parsed.data.scan_root })]
    )
    res.json({ data: { scan_root: parsed.data.scan_root } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/settings/antigravity ──────────────────────────────────────────

router.get('/antigravity', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'antigravity_scan_root'`
    )
    const value = rows[0]?.value as { scan_root: string | null } | undefined
    res.json({ data: { scan_root: value?.scan_root ?? null } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/settings/antigravity ──────────────────────────────────────────

const AntigravitySettingsBody = z.object({
  scan_root: z.string().min(1).nullable(),
})

router.put('/antigravity', requireRole('admin'), async (req, res) => {
  const parsed = AntigravitySettingsBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('antigravity_scan_root', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ scan_root: parsed.data.scan_root })]
    )
    res.json({ data: { scan_root: parsed.data.scan_root } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Backup/restore/import and notifications/digest concerns — see routes/settings-backup.ts
// and routes/settings-notifications.ts. Every route in both sub-routers is a distinct bare
// path with no :id-style params anywhere in this router, so mount order doesn't matter.
router.use(settingsBackupRouter)
router.use(settingsNotificationsRouter)

export default router

import { Router } from 'express'
import { z } from 'zod'
import os   from 'os'
import path from 'path'
import multer from 'multer'
import AdmZip from 'adm-zip'
import matter from 'gray-matter'
import { pool } from '../db/pool.js'
import { env } from '../lib/env.js'
import { serverError } from '../lib/errors.js'
import { triggerBackupNow } from '../services/backup.js'
import { requireRole } from '../middleware/auth.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { ldapAuth, type LdapConfig } from '../services/ldap.js'

const upload = multer({ dest: path.join(os.tmpdir(), 'devbrain-uploads'), limits: { fileSize: 200 * 1024 * 1024 } })

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
    
    const value = {
      ...parsed.data,
      bindPasswordEnc: parsed.data.bindPassword ? encrypt(parsed.data.bindPassword) : existing.bindPasswordEnc
    }
    delete (value as any).bindPassword

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
  const { username, password, ...config } = req.body as any
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
        backend:    env.USE_CLAUDE ? 'claude' : 'ollama',
        chatModel:  env.USE_CLAUDE ? 'claude-sonnet-4-6' : env.OLLAMA_CHAT_MODEL,
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

// GET /api/settings/backup — full JSON export (excludes raw document content + chunk embeddings)
router.get('/backup', async (_req, res) => {
  try {
    const [projects, documents, issues, commands, releases, runbooks, tasks] = await Promise.all([
      pool.query('SELECT * FROM projects ORDER BY created_at'),
      pool.query('SELECT id, project_id, title, file_type, tags, source, created_at FROM documents ORDER BY created_at'),
      pool.query('SELECT * FROM issues ORDER BY created_at'),
      pool.query('SELECT * FROM commands ORDER BY created_at'),
      pool.query('SELECT * FROM releases ORDER BY created_at'),
      pool.query('SELECT * FROM runbooks ORDER BY created_at'),
      pool.query('SELECT * FROM tasks ORDER BY created_at').catch(() => ({ rows: [] })),
    ])

    const backup = {
      exportedAt: new Date().toISOString(),
      version:    1,
      data: {
        projects:  projects.rows,
        documents: documents.rows,
        issues:    issues.rows,
        commands:  commands.rows,
        releases:  releases.rows,
        runbooks:  runbooks.rows,
        tasks:     tasks.rows,
      },
    }

    const date = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', `attachment; filename="devbrain-backup-${date}.json"`)
    res.json(backup)
  } catch (err) {
    console.error('backup error:', err)
    res.status(500).json({ error: 'Backup failed' })
  }
})

// ── POST /api/settings/import ────────────────────────────────────────────────

router.post('/import', requireRole('admin'), async (req, res) => {
  const isDryRun = req.query.dry_run === 'true'
  const backup   = req.body

  if (!backup?.data || backup.version !== 1) {
    return res.status(400).json({ error: 'Invalid backup. Expected { version: 1, data: { ... } }' })
  }

  type Row = Record<string, unknown>
  const pRows  = (backup.data.projects  ?? []) as Row[]
  const dRows  = (backup.data.documents ?? []) as Row[]
  const iRows  = (backup.data.issues    ?? []) as Row[]
  const cRows  = (backup.data.commands  ?? []) as Row[]
  const rRows  = (backup.data.releases  ?? []) as Row[]
  const rbRows = (backup.data.runbooks  ?? []) as Row[]

  type Tally = { created: number; skipped: number }
  const summary: Record<string, Tally> = {}

  if (isDryRun) {
    async function countExisting(table: string, ids: string[]): Promise<number> {
      if (!ids.length) return 0
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE id = ANY($1)`, [ids])
      return (rows[0].n as number)
    }
    const ids = (rows: Row[]) => rows.map(r => r.id as string).filter(Boolean)
    const [ep, ed, ei, ec, er, erb] = await Promise.all([
      countExisting('projects',  ids(pRows)),
      countExisting('documents', ids(dRows)),
      countExisting('issues',    ids(iRows)),
      countExisting('commands',  ids(cRows)),
      countExisting('releases',  ids(rRows)),
      countExisting('runbooks',  ids(rbRows)),
    ])
    summary.projects  = { skipped: ep,  created: pRows.length  - ep  }
    summary.documents = { skipped: ed,  created: dRows.length  - ed  }
    summary.issues    = { skipped: ei,  created: iRows.length  - ei  }
    summary.commands  = { skipped: ec,  created: cRows.length  - ec  }
    summary.releases  = { skipped: er,  created: rRows.length  - er  }
    summary.runbooks  = { skipped: erb, created: rbRows.length - erb }
    return res.json({ data: { dry_run: true, summary } })
  }

  // Actual import in a transaction
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let n = 0

    // Projects first — others reference them via FK
    n = 0
    for (const p of pRows) {
      const r = await client.query(
        `INSERT INTO projects (id, name, short_name, description, color, status, tech_stack, type, repo_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.short_name, p.description ?? '', p.color ?? '#6366F1',
         p.status ?? 'active', p.tech_stack ?? [], p.type ?? 'web', p.repo_url ?? null, p.created_at]
      )
      if ((r.rowCount ?? 0) > 0) n++
    }
    summary.projects = { created: n, skipped: pRows.length - n }

    // Documents (stubs — content and chunks are not in backup)
    n = 0
    for (const d of dRows) {
      const r = await client.query(
        `INSERT INTO documents (id, project_id, title, file_type, tags, source, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [d.id, d.project_id ?? null, d.title, d.file_type ?? 'txt', d.tags ?? [], d.source ?? '', d.created_at]
      )
      if ((r.rowCount ?? 0) > 0) n++
    }
    summary.documents = { created: n, skipped: dRows.length - n }

    // Issues
    n = 0
    for (const i of iRows) {
      const r = await client.query(
        `INSERT INTO issues
           (id, project_id, title, description, status, priority,
            investigation_steps, notes, linked_docs, linked_commands,
            resolution, tags, created_at, resolved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT DO NOTHING`,
        [i.id, i.project_id ?? null, i.title, i.description ?? '',
         i.status ?? 'open', i.priority ?? 'medium',
         JSON.stringify(i.investigation_steps ?? []), JSON.stringify(i.notes ?? []),
         i.linked_docs ?? [], i.linked_commands ?? [],
         i.resolution ?? '', i.tags ?? [], i.created_at, i.resolved_at ?? null]
      )
      if ((r.rowCount ?? 0) > 0) n++
    }
    summary.issues = { created: n, skipped: iRows.length - n }

    // Commands
    n = 0
    for (const c of cRows) {
      const r = await client.query(
        `INSERT INTO commands
           (id, project_id, title, command, language, description, tags, is_favorite, last_used, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT DO NOTHING`,
        [c.id, c.project_id ?? null, c.title, c.command, c.language ?? 'bash',
         c.description ?? '', c.tags ?? [], c.is_favorite ?? false,
         c.last_used ?? null, c.created_at]
      )
      if ((r.rowCount ?? 0) > 0) n++
    }
    summary.commands = { created: n, skipped: cRows.length - n }

    // Releases
    n = 0
    for (const r of rRows) {
      const res2 = await client.query(
        `INSERT INTO releases
           (id, project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [r.id, r.project_id, r.version, r.date, r.type ?? 'patch',
         r.features ?? [], r.fixes ?? [], r.breaking_changes ?? [],
         r.notes ?? '', r.linked_issues ?? [], r.created_at]
      )
      if ((res2.rowCount ?? 0) > 0) n++
    }
    summary.releases = { created: n, skipped: rRows.length - n }

    // Runbooks
    n = 0
    for (const rb of rbRows) {
      const r = await client.query(
        `INSERT INTO runbooks (id, project_id, title, steps, tags, last_used_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [rb.id, rb.project_id ?? null, rb.title, JSON.stringify(rb.steps ?? []),
         rb.tags ?? [], rb.last_used_at ?? null, rb.created_at]
      )
      if ((r.rowCount ?? 0) > 0) n++
    }
    summary.runbooks = { created: n, skipped: rbRows.length - n }

    await client.query('COMMIT')
    res.json({ data: { dry_run: false, summary } })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── GET /api/settings/backup-config ─────────────────────────────────────────

router.get('/backup-config', async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const cfg = rows[0]?.value ?? { path: null, schedule: 'off', last_backup_at: null }
    res.json({ data: cfg })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PUT /api/settings/backup-config ─────────────────────────────────────────

const BackupConfigBody = z.object({
  path:     z.string().nullable(),
  schedule: z.enum(['daily', 'weekly', 'off']),
})

router.put('/backup-config', requireRole('admin'), async (req, res) => {
  const parsed = BackupConfigBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const existing = (rows[0]?.value ?? {}) as Record<string, unknown>
    const updated  = { ...existing, path: parsed.data.path, schedule: parsed.data.schedule }
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('backup_settings', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(updated)],
    )
    res.json({ data: updated })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/settings/backup-now ────────────────────────────────────────────

router.post('/backup-now', requireRole('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const cfg = rows[0]?.value as { path: string | null } | undefined
    if (!cfg?.path) return res.status(400).json({ error: 'No backup path configured' })
    await triggerBackupNow(cfg.path)
    res.json({ data: { ok: true, path: cfg.path } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/settings/zip-import ────────────────────────────────────────────

router.post('/zip-import', requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const isDryRun = req.query.dry_run === 'true'

  try {
    const zip     = new AdmZip(req.file.path)
    const entries = zip.getEntries()

    type Tally = { created: number; skipped: number }
    const summary: Record<string, Tally> = { documents: { created: 0, skipped: 0 }, issues: { created: 0, skipped: 0 }, commands: { created: 0, skipped: 0 } }

    // Build a map of short_name → project id (for FK lookups)
    const { rows: projects } = await pool.query<{ id: string; short_name: string }>('SELECT id, short_name FROM projects')
    const projectMap = new Map(projects.map(p => [p.short_name, p.id]))

    const client = isDryRun ? null : await pool.connect()
    if (client) await client.query('BEGIN')

    try {
      for (const entry of entries) {
        if (entry.isDirectory) continue
        const entryName = entry.entryName.replace(/\\/g, '/')
        const parts     = entryName.split('/')
        if (parts.length < 3) continue  // need at least {project}/{dir}/{file}.md

        const projectSlug = parts[0]
        const entityDir   = parts[1]    // 'documents', 'issues', 'commands'
        const filename    = parts[parts.length - 1]

        if (!filename.endsWith('.md')) continue
        if (!['documents', 'issues', 'commands'].includes(entityDir)) continue

        const projectId = projectMap.get(projectSlug)
        if (!projectId) continue  // skip unknown projects

        const content = entry.getData().toString('utf8')
        let parsed: matter.GrayMatterFile<string>
        try { parsed = matter(content) } catch { continue }

        const fm = parsed.data as Record<string, unknown>
        const title = (fm.title as string | undefined) ?? filename.replace(/\.md$/, '')

        if (entityDir === 'documents') {
          // Check duplicate: same title + project
          const { rows: existing } = isDryRun
            ? await pool.query('SELECT id FROM documents WHERE title = $1 AND project_id = $2', [title, projectId])
            : await client!.query('SELECT id FROM documents WHERE title = $1 AND project_id = $2', [title, projectId])

          if (existing.length > 0) {
            summary.documents.skipped++
          } else if (!isDryRun) {
            await client!.query(
              `INSERT INTO documents (project_id, title, file_type, tags, source, content, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [
                projectId,
                title,
                fm.file_type ?? 'md',
                Array.isArray(fm.tags) ? fm.tags : [],
                fm.source ?? '',
                parsed.content.trim(),
                fm.created_at ?? new Date().toISOString(),
              ],
            )
            summary.documents.created++
          } else {
            summary.documents.created++
          }
        } else if (entityDir === 'issues') {
          const { rows: existing } = isDryRun
            ? await pool.query('SELECT id FROM issues WHERE title = $1 AND project_id = $2', [title, projectId])
            : await client!.query('SELECT id FROM issues WHERE title = $1 AND project_id = $2', [title, projectId])

          if (existing.length > 0) {
            summary.issues.skipped++
          } else if (!isDryRun) {
            await client!.query(
              `INSERT INTO issues (project_id, title, status, priority, tags, description, resolution, created_at, resolved_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                projectId,
                title,
                fm.status  ?? 'open',
                fm.priority ?? 'medium',
                Array.isArray(fm.tags) ? fm.tags : [],
                fm.description ?? '',
                fm.resolution  ?? '',
                fm.created_at  ?? new Date().toISOString(),
                fm.resolved_at ?? null,
              ],
            )
            summary.issues.created++
          } else {
            summary.issues.created++
          }
        } else if (entityDir === 'commands') {
          const { rows: existing } = isDryRun
            ? await pool.query('SELECT id FROM commands WHERE title = $1 AND project_id = $2', [title, projectId])
            : await client!.query('SELECT id FROM commands WHERE title = $1 AND project_id = $2', [title, projectId])

          // Extract command from code block in body
          const cmdMatch = parsed.content.match(/```[^\n]*\n([\s\S]*?)```/)
          const cmdText  = cmdMatch ? cmdMatch[1].trim() : parsed.content.trim()

          if (existing.length > 0) {
            summary.commands.skipped++
          } else if (!isDryRun) {
            await client!.query(
              `INSERT INTO commands (project_id, title, command, language, description, tags, is_favorite, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                projectId,
                title,
                cmdText,
                fm.language   ?? 'bash',
                fm.description ?? '',
                Array.isArray(fm.tags) ? fm.tags : [],
                fm.is_favorite ?? false,
                fm.created_at  ?? new Date().toISOString(),
              ],
            )
            summary.commands.created++
          } else {
            summary.commands.created++
          }
        }
      }

      if (client) {
        await client.query('COMMIT')
        client.release()
      }
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK')
        client.release()
      }
      throw err
    }

    res.json({ data: { dry_run: isDryRun, summary } })
  } catch (err) {
    serverError(res, err)
  }
})

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


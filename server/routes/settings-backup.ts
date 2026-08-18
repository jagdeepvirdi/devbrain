import { Router } from 'express'
import { z } from 'zod'
import os   from 'os'
import path from 'path'
import multer from 'multer'
import AdmZip from 'adm-zip'
import matter from 'gray-matter'
import { pool } from '../db/pool.js'
import { serverError } from '../lib/errors.js'
import { triggerBackupNow, DEFAULT_BACKUP_RETENTION_COUNT, resolveRemoteConfig } from '../services/backup.js'
import { testRemoteConnection, type RemoteConfig } from '../services/remoteBackup.js'
import { requireRole } from '../middleware/auth.js'
import { encrypt, decrypt } from '../services/crypto.js'

// Backup/restore/import concerns split out of routes/settings.ts (TASKS.md Phase 39 Tier 2
// god-file split) — by far the largest chunk of the original file. Mounted at the same
// /api/settings base; every route here is a distinct bare path (/backup, /import,
// /backup-config, /backup-now, /backup-config/test-remote, /zip-import) with no :id-style
// params anywhere in this router, so there's no path-ordering concern with the other
// settings sub-routers regardless of mount order.
//
// This file is ~600 lines and creeping back toward god-file size (2026-08-17 audit) —
// not worth splitting preemptively, but the next feature landing here (a new backup
// destination, another import format, …) should pull its own concern into a sibling
// file rather than growing this one further.

const upload = multer({ dest: path.join(os.tmpdir(), 'devbrain-uploads'), limits: { fileSize: 200 * 1024 * 1024 } })

const router = Router()

// adm-zip <0.6.0 has an unpatched DoS advisory: a crafted zip can declare an
// enormous uncompressed size in its (attacker-controlled) header, which then
// gets fully allocated in memory the moment something calls entry.getData().
// Multer's fileSize limit only bounds the *compressed* upload — it does
// nothing against a small zip bomb — so zip-import validates each entry's
// declared header.size itself, before ever touching getData(), and rejects
// anything past a sane cap rather than trusting the archive's own claims.
const MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES = 50  * 1024 * 1024  // 50MB per file
const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 200 * 1024 * 1024  // 200MB per archive

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
    const cfg = (rows[0]?.value ?? {}) as Record<string, unknown>
    res.json({ data: redactBackupConfig(cfg) })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PUT /api/settings/backup-config ─────────────────────────────────────────

const S3RemoteBody = z.object({
  type:            z.literal('s3'),
  endpoint:        z.string().optional().nullable(),
  region:          z.string().optional().nullable(),
  bucket:          z.string().min(1),
  prefix:          z.string().optional().nullable(),
  accessKeyId:     z.string().min(1),
  secretAccessKey: z.string().optional(), // omitted = keep the existing encrypted value
  forcePathStyle:  z.boolean().optional(),
})

const SftpRemoteBody = z.object({
  type:       z.literal('sftp'),
  host:       z.string().min(1),
  port:       z.number().int().optional().nullable(),
  username:   z.string().min(1),
  remotePath: z.string().min(1),
  password:   z.string().optional(), // omitted = keep the existing encrypted value
  privateKey: z.string().optional(), // omitted = keep the existing encrypted value
})

const NoneRemoteBody = z.object({ type: z.literal('none') })

const RemoteBody = z.discriminatedUnion('type', [NoneRemoteBody, S3RemoteBody, SftpRemoteBody])

const BackupConfigBody = z.object({
  path:            z.string().nullable(),
  schedule:        z.enum(['daily', 'weekly', 'off']),
  retention_count: z.number().int().min(1).max(365).optional(),
  remote:          RemoteBody.optional(),
})

// Redacts encrypted secret fields to booleans (hasSecretAccessKey / hasPassword
// / hasPrivateKey) so the client can show "already configured" without ever
// seeing the plaintext or ciphertext — same pattern as GET /ldap's hasPassword.
function redactBackupConfig(cfg: Record<string, unknown>) {
  const remote = (cfg.remote ?? { type: 'none' }) as Record<string, unknown>
  const redactedRemote =
    remote.type === 's3'
      ? {
          type:               's3',
          endpoint:           remote.endpoint ?? null,
          region:             remote.region ?? null,
          bucket:             remote.bucket,
          prefix:             remote.prefix ?? null,
          accessKeyId:        remote.accessKeyId,
          forcePathStyle:     !!remote.forcePathStyle,
          hasSecretAccessKey: !!remote.secretAccessKeyEnc,
        }
      : remote.type === 'sftp'
      ? {
          type:          'sftp',
          host:          remote.host,
          port:          remote.port ?? null,
          username:      remote.username,
          remotePath:    remote.remotePath,
          hasPassword:   !!remote.passwordEnc,
          hasPrivateKey: !!remote.privateKeyEnc,
        }
      : { type: 'none' }

  return {
    path:                     (cfg.path as string | null) ?? null,
    schedule:                 (cfg.schedule as string) ?? 'off',
    last_backup_at:           (cfg.last_backup_at as string | null) ?? null,
    retention_count:          (cfg.retention_count as number | null) ?? DEFAULT_BACKUP_RETENTION_COUNT,
    remote:                   redactedRemote,
    last_remote_backup_at:    (cfg.last_remote_backup_at as string | null) ?? null,
    last_remote_backup_error: (cfg.last_remote_backup_error as string | null) ?? null,
  }
}

router.put('/backup-config', requireRole('admin'), async (req, res) => {
  const parsed = BackupConfigBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const existing       = (rows[0]?.value ?? {}) as Record<string, unknown>
    const existingRemote = (existing.remote ?? { type: 'none' }) as Record<string, unknown>

    let remote: Record<string, unknown> | undefined
    const r = parsed.data.remote
    if (r?.type === 'none') {
      remote = { type: 'none' }
    } else if (r?.type === 's3') {
      remote = {
        type:               's3',
        endpoint:           r.endpoint ?? null,
        region:             r.region ?? null,
        bucket:             r.bucket,
        prefix:             r.prefix ?? null,
        accessKeyId:        r.accessKeyId,
        secretAccessKeyEnc: r.secretAccessKey ? encrypt(r.secretAccessKey) : existingRemote.secretAccessKeyEnc,
        forcePathStyle:     !!r.forcePathStyle,
      }
    } else if (r?.type === 'sftp') {
      remote = {
        type:          'sftp',
        host:          r.host,
        port:          r.port ?? null,
        username:      r.username,
        remotePath:    r.remotePath,
        passwordEnc:   r.password   ? encrypt(r.password)   : existingRemote.passwordEnc,
        privateKeyEnc: r.privateKey ? encrypt(r.privateKey) : existingRemote.privateKeyEnc,
      }
    }

    const updated = {
      ...existing,
      path:            parsed.data.path,
      schedule:        parsed.data.schedule,
      retention_count: parsed.data.retention_count ?? existing.retention_count ?? DEFAULT_BACKUP_RETENTION_COUNT,
      ...(remote ? { remote } : {}),
    }
    await pool.query(
      `INSERT INTO app_settings (key, value)
       VALUES ('backup_settings', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(updated)],
    )
    res.json({ data: redactBackupConfig(updated) })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/settings/backup-now ────────────────────────────────────────────

router.post('/backup-now', requireRole('admin'), async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const cfg = rows[0]?.value as { path: string | null; retention_count?: number | null; remote?: unknown } | undefined
    if (!cfg?.path) return res.status(400).json({ error: 'No backup path configured' })
    await triggerBackupNow(cfg.path, cfg.retention_count ?? DEFAULT_BACKUP_RETENTION_COUNT, resolveRemoteConfig(cfg.remote))
    res.json({ data: { ok: true, path: cfg.path } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/settings/backup-config/test-remote ────────────────────────────
// Verifies the remote destination is reachable before the user commits to a
// schedule — mirrors /ldap/test's "override falls back to stored+decrypted"
// pattern so a secret field can be left blank to test against what's already
// saved rather than re-entering it.

function resolveSecret(provided: string | undefined, existingRemote: Record<string, unknown>, expectedType: string, encField: string): string | undefined {
  if (provided) return provided
  if (existingRemote.type === expectedType && existingRemote[encField]) return decrypt(existingRemote[encField] as string)
  return undefined
}

router.post('/backup-config/test-remote', requireRole('admin'), async (req, res) => {
  const parsed = RemoteBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  if (parsed.data.type === 'none') return res.status(400).json({ error: 'No remote destination selected' })

  try {
    const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'backup_settings'`)
    const existingRemote = ((rows[0]?.value as Record<string, unknown> | undefined)?.remote ?? { type: 'none' }) as Record<string, unknown>

    const r = parsed.data
    const testConfig: RemoteConfig =
      r.type === 's3'
        ? {
            type:            's3',
            endpoint:        r.endpoint ?? undefined,
            region:          r.region ?? undefined,
            bucket:          r.bucket,
            prefix:          r.prefix ?? undefined,
            accessKeyId:     r.accessKeyId,
            secretAccessKey: resolveSecret(r.secretAccessKey, existingRemote, 's3', 'secretAccessKeyEnc') ?? '',
            forcePathStyle:  !!r.forcePathStyle,
          }
        : {
            type:       'sftp',
            host:       r.host,
            port:       r.port ?? undefined,
            username:   r.username,
            remotePath: r.remotePath,
            password:   resolveSecret(r.password, existingRemote, 'sftp', 'passwordEnc'),
            privateKey: resolveSecret(r.privateKey, existingRemote, 'sftp', 'privateKeyEnc'),
          }

    await testRemoteConnection(testConfig)
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// ── POST /api/settings/zip-import ────────────────────────────────────────────

router.post('/zip-import', requireRole('admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const isDryRun = req.query.dry_run === 'true'

  try {
    const zip     = new AdmZip(req.file.path)
    const entries = zip.getEntries()

    // Validate declared (uncompressed) entry sizes before any entry.getData()
    // call decompresses anything — see MAX_ZIP_* comment above.
    let totalUncompressed = 0
    for (const entry of entries) {
      if (entry.isDirectory) continue
      if (entry.header.size > MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES) {
        return res.status(400).json({
          error: `Zip entry "${entry.entryName}" declares an uncompressed size over the ${MAX_ZIP_ENTRY_UNCOMPRESSED_BYTES / (1024 * 1024)}MB per-file limit`,
        })
      }
      totalUncompressed += entry.header.size
      if (totalUncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        return res.status(400).json({
          error: `Zip archive's total uncompressed size exceeds the ${MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES / (1024 * 1024)}MB limit`,
        })
      }
    }

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
          // Check duplicate: same title + project. Branches on `client` itself (not `isDryRun`)
          // so TypeScript's own null-narrowing proves client is non-null wherever it's used,
          // rather than trusting a separately-tracked boolean to stay in sync with it.
          const { rows: existing } = client
            ? await client.query('SELECT id FROM documents WHERE title = $1 AND project_id = $2', [title, projectId])
            : await pool.query('SELECT id FROM documents WHERE title = $1 AND project_id = $2', [title, projectId])

          if (existing.length > 0) {
            summary.documents.skipped++
          } else if (client) {
            await client.query(
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
          const { rows: existing } = client
            ? await client.query('SELECT id FROM issues WHERE title = $1 AND project_id = $2', [title, projectId])
            : await pool.query('SELECT id FROM issues WHERE title = $1 AND project_id = $2', [title, projectId])

          if (existing.length > 0) {
            summary.issues.skipped++
          } else if (client) {
            await client.query(
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
          const { rows: existing } = client
            ? await client.query('SELECT id FROM commands WHERE title = $1 AND project_id = $2', [title, projectId])
            : await pool.query('SELECT id FROM commands WHERE title = $1 AND project_id = $2', [title, projectId])

          // Extract command from code block in body
          const cmdMatch = parsed.content.match(/```[^\n]*\n([\s\S]*?)```/)
          const cmdText  = cmdMatch ? cmdMatch[1].trim() : parsed.content.trim()

          if (existing.length > 0) {
            summary.commands.skipped++
          } else if (client) {
            await client.query(
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

export default router

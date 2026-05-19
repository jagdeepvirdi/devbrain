import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { env } from '../lib/env.js'

const router = Router()

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

router.put('/claude', async (req, res) => {
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

router.post('/import', async (req, res) => {
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

export default router

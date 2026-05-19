import { Router } from 'express'
import { pool } from '../db/pool.js'
import { discoverProjects } from '../services/claude-discovery.js'
import { readTaskTree, subscribe } from '../services/tasks-watcher.js'
import { readSessions, readSessionDetail } from '../services/session-reader.js'

const router = Router()

// One active scan at a time — aborted if a new request comes in
let activeScanController: AbortController | null = null

// ── POST /api/claude-projects/scan ────────────────────────────────────────────

router.post('/scan', async (_req, res) => {
  if (activeScanController) {
    activeScanController.abort()
    activeScanController = null
  }

  try {
    const { rows: settingsRows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'claude_scan_root'`
    )
    const scanRoot = (settingsRows[0]?.value as { scan_root: string | null } | undefined)?.scan_root ?? null

    if (!scanRoot) {
      res.status(422).json({ error: 'No scan root configured. Go to Settings → Claude Integration.' })
      return
    }

    const { rows: projectRows } = await pool.query(
      `SELECT id, name, short_name FROM projects ORDER BY created_at`
    )

    const controller = new AbortController()
    activeScanController = controller

    const candidates = await discoverProjects(scanRoot, controller.signal, projectRows)
    activeScanController = null

    res.json({ data: { root: scanRoot, count: candidates.length, candidates } })
  } catch (err) {
    activeScanController = null
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/claude-projects/:id/tasks ────────────────────────────────────────

router.get('/:id/tasks', async (req, res) => {
  try {
    const { rows } = await pool.query<{ fs_path: string | null }>(
      `SELECT fs_path FROM projects WHERE id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    const fsPath = rows[0].fs_path
    if (!fsPath) return res.status(422).json({ error: 'Project is not linked to a filesystem path' })

    const tree = await readTaskTree(req.params.id, fsPath)
    res.json({ data: tree })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/claude-projects/:id/tasks/watch  (SSE) ───────────────────────────

router.get('/:id/tasks/watch', async (req, res) => {
  try {
    const { rows } = await pool.query<{ fs_path: string | null }>(
      `SELECT fs_path FROM projects WHERE id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) { res.status(404).end(); return }
    const fsPath = rows[0].fs_path
    if (!fsPath) { res.status(422).end(); return }

    res.setHeader('Content-Type',  'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection',    'keep-alive')
    res.flushHeaders()

    // Send current state immediately
    const initial = await readTaskTree(req.params.id, fsPath)
    res.write(`data: ${JSON.stringify(initial)}\n\n`)

    // Subscribe to live updates
    const unsubscribe = subscribe(req.params.id, res)
    req.on('close', unsubscribe)
  } catch (err) {
    res.status(500).end()
  }
})

// ── GET /api/claude-projects/:id/sessions ─────────────────────────────────────
// Query params: ?status=active|completed  ?q=<search>  ?page=1  ?limit=20

router.get('/:id/sessions', async (req, res) => {
  try {
    const { rows } = await pool.query<{ fs_path: string | null }>(
      `SELECT fs_path FROM projects WHERE id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    const fsPath = rows[0].fs_path
    if (!fsPath) return res.status(422).json({ error: 'Project is not linked to a filesystem path' })

    let sessions = await readSessions(fsPath)

    const status = req.query.status as string | undefined
    if (status === 'active' || status === 'completed') {
      sessions = sessions.filter(s => s.status === status)
    }

    const q = (req.query.q as string | undefined)?.trim().toLowerCase()
    if (q) {
      sessions = sessions.filter(s =>
        s.goals.some(g => g.toLowerCase().includes(q)) ||
        s.workDone.some(w => w.toLowerCase().includes(q)) ||
        s.decisions.some(d => d.toLowerCase().includes(q)) ||
        s.openItems.some(o => o.toLowerCase().includes(q)) ||
        s.folderName.toLowerCase().includes(q)
      )
    }

    const total   = sessions.length
    const page    = Math.max(1, parseInt(req.query.page  as string) || 1)
    const limit   = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20))
    const offset  = (page - 1) * limit
    const paged   = sessions.slice(offset, offset + limit)

    res.json({ data: { sessions: paged, total, page, limit } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/claude-projects/:id/sessions/:sessionId ──────────────────────────

router.get('/:id/sessions/:sessionId', async (req, res) => {
  try {
    const { rows } = await pool.query<{ fs_path: string | null }>(
      `SELECT fs_path FROM projects WHERE id = $1`,
      [req.params.id]
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' })
    const fsPath = rows[0].fs_path
    if (!fsPath) return res.status(422).json({ error: 'Project is not linked to a filesystem path' })

    const detail = await readSessionDetail(fsPath, req.params.sessionId)
    if (!detail) return res.status(404).json({ error: 'Session not found' })

    res.json({ data: detail })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

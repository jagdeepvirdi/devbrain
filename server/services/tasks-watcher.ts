import chokidar from 'chokidar'
import matter from 'gray-matter'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Response } from 'express'
import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import { frontmatterString } from '../lib/frontmatter.js'

export interface TaskItem {
  text: string
  status: 'todo' | 'done' | 'in_progress' | 'blocked'
  doneDate?: string
}

export interface TaskPhase {
  name: string
  total: number
  done: number
  pct: number
  items: TaskItem[]
}

export interface TaskTree {
  projectId: string
  lastUpdated: string | null
  phases: TaskPhase[]
  overallPct: number
  totalDone: number
  totalItems: number
}

const watchers    = new Map<string, chokidar.FSWatcher>()
const subscribers = new Map<string, Set<Response>>()

// ── Parser ────────────────────────────────────────────────────────────────────

function parseTasksFile(content: string, projectId: string): TaskTree {
  let lastUpdated: string | null = null
  const phases: TaskPhase[] = []

  try {
    const { data, content: body } = matter(content)
    lastUpdated = frontmatterString(data.last_updated) ?? null

    let current: { name: string; items: TaskItem[] } | null = null

    for (const raw of body.split('\n')) {
      const line = raw.trimEnd()

      if (/^## /.test(line)) {
        if (current) phases.push(buildPhase(current))
        current = { name: line.slice(3).trim(), items: [] }
        continue
      }

      if (current && /^- \[/.test(line)) {
        current.items.push(parseItem(line))
      }
    }

    if (current) phases.push(buildPhase(current))
  } catch {
    // malformed frontmatter — return partial result
  }

  const totalDone  = phases.reduce((s, p) => s + p.done,  0)
  const totalItems = phases.reduce((s, p) => s + p.total, 0)
  const overallPct = totalItems > 0 ? Math.round(totalDone / totalItems * 100) : 0

  return { projectId, lastUpdated, phases, overallPct, totalDone, totalItems }
}

function parseItem(line: string): TaskItem {
  let status: TaskItem['status'] = 'todo'
  if (/^- \[x\]/.test(line)) status = 'done'
  else if (/^- \[~\]/.test(line)) status = 'in_progress'
  else if (/^- \[!\]/.test(line)) status = 'blocked'

  // Extract done date stamp if present
  let doneDate: string | undefined
  const dateMatch = line.match(/<!--\s*done:\s*(\d{4}-\d{2}-\d{2})\s*-->/)
  if (dateMatch) doneDate = dateMatch[1]

  // Strip the stamp and checkbox prefix from display text
  const text = line
    .replace(/^- \[[x~! ]\]\s*/, '')
    .replace(/\s*<!--\s*done:[^>]*-->\s*$/, '')
    .trim()

  return { text, status, ...(doneDate ? { doneDate } : {}) }
}

function buildPhase(current: { name: string; items: TaskItem[] }): TaskPhase {
  const total = current.items.length
  const done  = current.items.filter(i => i.status === 'done').length
  const pct   = total > 0 ? Math.round(done / total * 100) : 0
  return { name: current.name, total, done, pct, items: current.items }
}

// ── Public: one-shot read ─────────────────────────────────────────────────────

export async function readTaskTree(projectId: string, fsPath: string): Promise<TaskTree> {
  const tasksFile = path.join(fsPath, 'TASKS.md')
  try {
    const content = await fs.readFile(tasksFile, 'utf-8')
    return parseTasksFile(content, projectId)
  } catch {
    return { projectId, lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 }
  }
}

// ── SSE pub/sub ───────────────────────────────────────────────────────────────

export function subscribe(projectId: string, res: Response): () => void {
  if (!subscribers.has(projectId)) subscribers.set(projectId, new Set())
  subscribers.get(projectId)!.add(res)

  return () => {
    subscribers.get(projectId)?.delete(res)
  }
}

function broadcast(projectId: string, tree: TaskTree) {
  const subs = subscribers.get(projectId)
  if (!subs || subs.size === 0) return
  const payload = `data: ${JSON.stringify(tree)}\n\n`
  for (const res of subs) {
    try { res.write(payload) } catch { subs.delete(res) }
  }
}

// ── Cross-instance broadcast (Postgres LISTEN/NOTIFY) ─────────────────────────
// Only the server instance with a given project's fs_path actually mounted can ever
// detect a TASKS.md change via chokidar — but a load balancer may route any given
// client's SSE connection to a *different* instance. publishTaskUpdate() caches the
// freshly-parsed tree in task_tree_cache and pg_notify's every instance (including
// itself), so whichever instance holds a given client's connection can broadcast to it.
// NOTIFY payloads are capped at 8000 bytes by Postgres — too small for an arbitrarily
// large task tree — so the payload is just the project id; the cache table carries
// the real data.

const NOTIFY_CHANNEL = 'tasks_update'

async function publishTaskUpdate(projectId: string, tree: TaskTree): Promise<void> {
  await pool.query(
    `INSERT INTO task_tree_cache (project_id, tree, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (project_id) DO UPDATE SET tree = $2::jsonb, updated_at = now()`,
    [projectId, JSON.stringify(tree)]
  )
  await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, projectId])
}

let listenClient: PoolClient | null = null

async function handleNotification(payload: string | undefined): Promise<void> {
  if (!payload) return
  try {
    const { rows } = await pool.query<{ tree: TaskTree }>(
      'SELECT tree FROM task_tree_cache WHERE project_id = $1', [payload]
    )
    if (rows[0]) broadcast(payload, rows[0].tree)
  } catch (err) {
    console.error('  tasks-watcher: failed to load cached tree after notify:', (err as Error).message)
  }
}

// Keeps one dedicated connection LISTENing indefinitely — never returned to the pool.
// Reconnects with a short delay if the connection drops (network blip, DB restart).
export async function startListening(): Promise<void> {
  try {
    const client = await pool.connect()
    listenClient = client
    await client.query(`LISTEN ${NOTIFY_CHANNEL}`)

    client.on('notification', msg => { handleNotification(msg.payload).catch(() => {}) })
    client.on('error', err => {
      console.error('  tasks-watcher: listen connection error, reconnecting:', err.message)
      listenClient = null
      setTimeout(() => { startListening().catch(() => {}) }, 2000)
    })
  } catch (err) {
    console.error('  tasks-watcher: failed to start listen connection, retrying:', (err as Error).message)
    setTimeout(() => { startListening().catch(() => {}) }, 2000)
  }
}

// The listen client is checked out from the pool indefinitely (see startListening
// above) and never returned normally — `pool.end()` on graceful shutdown would hang
// waiting for it. release(true) destroys the underlying connection instead of
// returning it to the idle pool, so shutdown can proceed. Call before pool.end().
export function stopListening(): void {
  listenClient?.release(true)
  listenClient = null
}

// ── Watcher lifecycle ─────────────────────────────────────────────────────────

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

function startWatch(projectId: string, fsPath: string) {
  const tasksFile = path.join(fsPath, 'TASKS.md')

  const watcher = chokidar.watch(tasksFile, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  watcher.on('change', () => {
    const existing = debounceTimers.get(projectId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(async () => {
      debounceTimers.delete(projectId)
      const tree = await readTaskTree(projectId, fsPath)
      await publishTaskUpdate(projectId, tree).catch(err => {
        console.error('  tasks-watcher: failed to publish update:', (err as Error).message)
      })
    }, 300)

    debounceTimers.set(projectId, timer)
  })

  watchers.set(projectId, watcher)
}

export async function refreshProjectWatch(projectId: string, fsPath: string | null) {
  const existing = watchers.get(projectId)
  if (existing) {
    await existing.close()
    watchers.delete(projectId)
  }

  const timer = debounceTimers.get(projectId)
  if (timer) { clearTimeout(timer); debounceTimers.delete(projectId) }

  if (fsPath) startWatch(projectId, fsPath)
}

export async function initTasksWatcher() {
  await startListening()
  try {
    const { rows } = await pool.query<{ id: string; fs_path: string }>(
      `SELECT id, fs_path FROM projects WHERE fs_path IS NOT NULL`
    )
    for (const row of rows) {
      startWatch(row.id, row.fs_path)
    }
    console.log(`  tasks-watcher: watching ${rows.length} project(s) ✓`)
  } catch (err) {
    console.error('  tasks-watcher: init failed:', (err as Error).message)
  }
}

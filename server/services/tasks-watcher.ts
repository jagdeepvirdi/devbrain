import chokidar from 'chokidar'
import matter from 'gray-matter'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { Response } from 'express'
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
      broadcast(projectId, tree)
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

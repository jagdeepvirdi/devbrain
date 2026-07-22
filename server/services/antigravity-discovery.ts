import { promises as fs, type Dirent } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { frontmatterString } from '../lib/frontmatter.js'

export interface Phase {
  name: string
  total: number
  done: number
  pct: number
}

export interface DiscoveredProject {
  path: string
  name: string
  lastUpdated: string | null
  lastSessionDate: string | null
  phases: Phase[]
  overallPct: number
  matchedProjectId?: string
  matchedProjectName?: string
}

// Directories that are never worth scanning into
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.claude', '.gemini', '.venv', 'venv',
  'dist', 'build', '.next', 'out', 'coverage',
  '__pycache__', 'target', '.cargo', 'vendor',
])

function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_\-]/g, '')
}

// ── TASKS.md parser ───────────────────────────────────────────────────────────

function parseTasksMd(content: string): { name: string | null; lastUpdated: string | null; phases: Phase[] } {
  let name: string | null = null
  let lastUpdated: string | null = null
  const phases: Phase[] = []

  try {
    const { data, content: body } = matter(content)
    name = data.project ? String(data.project) : null
    lastUpdated = frontmatterString(data.last_updated) ?? null

    let current: { name: string; total: number; done: number } | null = null

    for (const raw of body.split('\n')) {
      const line = raw.trimEnd()

      if (/^## /.test(line)) {
        if (current) phases.push({ ...current, pct: current.total > 0 ? Math.round(current.done / current.total * 100) : 0 })
        current = { name: line.slice(3).trim(), total: 0, done: 0 }
        continue
      }

      if (current && /^- \[/.test(line)) {
        current.total++
        if (/^- \[x\]/.test(line)) current.done++
      }
    }

    if (current) phases.push({ ...current, pct: current.total > 0 ? Math.round(current.done / current.total * 100) : 0 })
  } catch {
    // Malformed frontmatter — return what we have
  }

  return { name, lastUpdated, phases }
}

// ── Last session date ─────────────────────────────────────────────────────────

async function getLastSessionDate(projectPath: string, signal: AbortSignal): Promise<string | null> {
  if (signal.aborted) return null
  try {
    const entries = await fs.readdir(path.join(projectPath, 'sessions'), { withFileTypes: true })
    if (signal.aborted) return null

    const sorted = entries
      .filter(e => e.isDirectory() && /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_/.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse()

    if (sorted.length === 0) return null

    // YYYY-MM-DD_HH-MM_<id> → ISO string
    const [dateStr, timeStr] = sorted[0].split('_')
    if (!dateStr || !timeStr) return null
    return `${dateStr}T${timeStr.replace('-', ':')}:00Z`
  } catch {
    return null
  }
}

// ── Qualification check ───────────────────────────────────────────────────────

async function qualify(
  dirPath: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; tasksContent?: string }> {
  if (signal.aborted) return { ok: false }
  try {
    const names = await fs.readdir(dirPath)
    if (signal.aborted) return { ok: false }

    if (names.includes('ANTIGRAVITY.md')) return { ok: true }

    if (names.includes('TASKS.md')) {
      const content = await fs.readFile(path.join(dirPath, 'TASKS.md'), 'utf-8')
      if (signal.aborted) return { ok: false }
      const { data } = matter(content)
      if (data.project) return { ok: true, tasksContent: content }
    }

    if (names.includes('sessions')) {
      const sessionEntries = await fs.readdir(path.join(dirPath, 'sessions'), { withFileTypes: true })
        .catch(() => [] as Dirent[])
      if (signal.aborted) return { ok: false }

      for (const e of sessionEntries) {
        if (!e.isDirectory()) continue
        const files = await fs.readdir(path.join(dirPath, 'sessions', e.name)).catch(() => [] as string[])
        if (files.includes('SESSION.md')) return { ok: true }
      }
    }
  } catch {
    // Permission error or not a directory — skip
  }
  return { ok: false }
}

// ── Recursive scanner ─────────────────────────────────────────────────────────

async function scanDir(
  dirPath: string,
  depth: number,
  maxDepth: number,
  signal: AbortSignal,
  results: DiscoveredProject[],
  existingProjects: { id: string; name: string; short_name: string }[],
): Promise<void> {
  if (signal.aborted || depth > maxDepth) return

  const check = await qualify(dirPath, signal)
  if (signal.aborted) return

  if (check.ok) {
    // Parse tasks
    let tasksContent = check.tasksContent
    if (!tasksContent) {
      tasksContent = await fs.readFile(path.join(dirPath, 'TASKS.md'), 'utf-8').catch(() => '')
    }

    const { name: parsedName, lastUpdated, phases } = parseTasksMd(tasksContent)
    const name = parsedName ?? path.basename(dirPath)

    const totalDone  = phases.reduce((s, p) => s + p.done,  0)
    const totalItems = phases.reduce((s, p) => s + p.total, 0)
    const overallPct = totalItems > 0 ? Math.round(totalDone / totalItems * 100) : 0

    const lastSessionDate = await getLastSessionDate(dirPath, signal)

    // Auto-match to existing DevBrain project by normalised name
    const normName = normalize(name)
    const match = existingProjects.find(
      p => normalize(p.name) === normName || normalize(p.short_name) === normName
    )

    results.push({
      path: dirPath,
      name,
      lastUpdated,
      lastSessionDate,
      phases,
      overallPct,
      ...(match ? { matchedProjectId: match.id, matchedProjectName: match.name } : {}),
    })

    // Don't recurse into a qualifying folder — avoids double-counting nested repos
    return
  }

  // Recurse into subdirectories
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return
  }
  if (signal.aborted) return

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
    await scanDir(path.join(dirPath, entry.name), depth + 1, maxDepth, signal, results, existingProjects)
    if (signal.aborted) return
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function discoverProjects(
  scanRoot: string,
  signal: AbortSignal,
  existingProjects: { id: string; name: string; short_name: string }[],
): Promise<DiscoveredProject[]> {
  const results: DiscoveredProject[] = []
  await scanDir(scanRoot, 0, 3, signal, results, existingProjects)
  return results
}

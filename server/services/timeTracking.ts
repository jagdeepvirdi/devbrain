import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pool } from '../db/pool.js'
import { readSessions } from './session-reader.js'
import { computeAggregates, fetchAwData, type Rule } from './activityWatch.js'
import {
  type Interval, DEFAULT_GAP_MS, DEFAULT_CREDIT_MS,
  clusterCommitTimes, sumByDay, dayStart, localDay,
} from '../lib/timeMath.js'

const execFileAsync = promisify(execFile)

export type TimeSource = 'activitywatch' | 'claude-session' | 'git-estimate'

export interface Entry { project_id: string | null; day: string; seconds: number; detail?: Record<string, unknown> }
interface ProjectRow { id: string; name: string; fs_path: string }

const MAX_SESSION_MS = 12 * 60 * 60 * 1000   // a session left open for days isn't 40 hours of work

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Replace a source's rows inside `scope` atomically (delete + insert in one transaction), so a
 * re-import is idempotent and rows that no longer apply don't linger. Scope is either a day
 * range (ActivityWatch — all projects incl. Unassigned) or a set of projects (git/session).
 */
export async function replaceEntries(
  source: TimeSource,
  entries: Entry[],
  scope: { from: string; to: string } | { projectIds: string[] },
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if ('projectIds' in scope) {
      await client.query(`DELETE FROM time_entries WHERE source = $1 AND project_id = ANY($2::text[])`, [source, scope.projectIds])
    } else {
      await client.query(`DELETE FROM time_entries WHERE source = $1 AND day BETWEEN $2 AND $3`, [source, scope.from, scope.to])
    }
    if (entries.length) {
      await client.query(
        `INSERT INTO time_entries (project_id, source, day, seconds, detail)
         SELECT p, $1, d, s, j FROM unnest($2::text[], $3::date[], $4::int[], $5::jsonb[]) AS t(p, d, s, j)`,
        [source,
         entries.map(e => e.project_id),
         entries.map(e => e.day),
         entries.map(e => Math.round(e.seconds)),
         entries.map(e => JSON.stringify(e.detail ?? {}))],
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

async function linkedProjects(): Promise<ProjectRow[]> {
  const { rows } = await pool.query(
    `SELECT id, name, fs_path FROM projects WHERE fs_path IS NOT NULL AND fs_path <> '' ORDER BY name`,
  )
  return rows as ProjectRow[]
}

const entriesFrom = (projectId: string, days: Map<string, number>): Entry[] =>
  [...days].map(([day, seconds]) => ({ project_id: projectId, day, seconds })).filter(e => Math.round(e.seconds) > 0)

// ── ActivityWatch ────────────────────────────────────────────────────────────

export async function importActivityWatch(from: string, to: string): Promise<{ days: number; entries: number }> {
  const { rows } = await pool.query(`SELECT project_id, kind, pattern, priority FROM time_mapping_rules ORDER BY priority DESC, created_at`)
  const startMs = dayStart(from)
  const endMs   = dayStart(to) + 24 * 60 * 60 * 1000   // `to` is inclusive
  const data = await fetchAwData(new Date(startMs).toISOString(), new Date(endMs).toISOString())

  const entries: Entry[] = computeAggregates(data, rows as Rule[])
    .map(a => ({ project_id: a.project_id, day: a.day, seconds: a.seconds, detail: { apps: a.apps } }))
  await replaceEntries('activitywatch', entries, { from, to })
  return { days: new Set(entries.map(e => e.day)).size, entries: entries.length }
}

// ── Git estimate ─────────────────────────────────────────────────────────────

async function commitTimes(repoPath: string): Promise<number[]> {
  const { stdout } = await execFileAsync('git', ['log', '--all', '--no-merges', '--pretty=format:%ct'], {
    cwd: repoPath, maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.split('\n').filter(Boolean).map(s => Number(s) * 1000).filter(Number.isFinite)
}

export interface EstimateOptions { gapMs?: number; creditMs?: number }
export interface ProjectResult { project: string; commits?: number; hours?: number; days?: number; error?: string }

/**
 * git-hours estimate per linked project. Never overwrites ActivityWatch days: any day on which
 * ActivityWatch recorded anything is skipped, because AW was running then and is the better source.
 */
export async function estimateGitHours(opts: EstimateOptions = {}): Promise<ProjectResult[]> {
  const { gapMs = DEFAULT_GAP_MS, creditMs = DEFAULT_CREDIT_MS } = opts
  const { rows: awDays } = await pool.query(`SELECT DISTINCT day FROM time_entries WHERE source = 'activitywatch'`)
  const skip = new Set((awDays as { day: string }[]).map(r => r.day))

  const results: ProjectResult[] = []
  for (const p of await linkedProjects()) {
    try {
      const times = await commitTimes(p.fs_path)
      const days = sumByDay(clusterCommitTimes(times, { gapMs, creditMs }))
      for (const d of skip) days.delete(d)
      const entries = entriesFrom(p.id, days)
      await replaceEntries('git-estimate', entries, { projectIds: [p.id] })
      results.push({
        project: p.name, commits: times.length, days: entries.length,
        hours: Math.round(entries.reduce((n, e) => n + e.seconds, 0) / 36) / 100,
      })
    } catch (err) {
      results.push({ project: p.name, error: (err as Error).message })
    }
  }
  return results
}

// ── Claude Code / Antigravity sessions ───────────────────────────────────────

export async function importSessions(): Promise<ProjectResult[]> {
  const results: ProjectResult[] = []
  for (const p of await linkedProjects()) {
    try {
      const intervals: Interval[] = []
      for (const s of await readSessions(p.fs_path)) {
        const start = Date.parse(s.started)
        const end   = s.ended ? Date.parse(s.ended) : NaN
        // Active (never ended) or unparsable sessions have no trustworthy duration — skip them.
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
        intervals.push({ start, end: Math.min(end, start + MAX_SESSION_MS) })
      }
      const entries = entriesFrom(p.id, sumByDay(intervals))
      await replaceEntries('claude-session', entries, { projectIds: [p.id] })
      results.push({
        project: p.name, days: entries.length,
        hours: Math.round(entries.reduce((n, e) => n + e.seconds, 0) / 36) / 100,
      })
    } catch (err) {
      results.push({ project: p.name, error: (err as Error).message })
    }
  }
  return results
}

// ── Reporting ────────────────────────────────────────────────────────────────

export type Group = 'day' | 'week' | 'month'

export interface ReportRow {
  period: string; project_id: string | null; project_name: string | null; color: string | null
  seconds: number; sources: TimeSource[]
}

/**
 * Per period + project totals. Sources overlap (ActivityWatch, sessions and git estimates all
 * describe the same hours), so each project-day uses ONE source — the most trustworthy one
 * available: activitywatch > claude-session > git-estimate. `by_source` is the raw per-source
 * total (not deduplicated) so the UI can show what each tracker saw.
 */
export async function getTimeReport(opts: { from: string; to: string; projectId?: string; group: Group }) {
  const params: unknown[] = [opts.from, opts.to]
  let projectFilter = ''
  if (opts.projectId) { params.push(opts.projectId); projectFilter = ` AND project_id = $${params.length}` }

  // opts.group is a zod-validated enum, never user text, so interpolating it is safe.
  const { rows } = await pool.query(
    `WITH best AS (
       SELECT DISTINCT ON (COALESCE(project_id, ''), day) project_id, day, source, seconds
         FROM time_entries
        WHERE day BETWEEN $1 AND $2${projectFilter}
        ORDER BY COALESCE(project_id, ''), day,
                 CASE source WHEN 'activitywatch' THEN 1 WHEN 'claude-session' THEN 2 ELSE 3 END
     )
     SELECT date_trunc('${opts.group}', b.day)::date AS period, b.project_id, p.name AS project_name, p.color,
            SUM(b.seconds)::int AS seconds, array_agg(DISTINCT b.source) AS sources
       FROM best b LEFT JOIN projects p ON p.id = b.project_id
      GROUP BY 1, b.project_id, p.name, p.color
      ORDER BY 1 DESC, seconds DESC`,
    params,
  )
  const { rows: bySource } = await pool.query(
    `SELECT source, SUM(seconds)::int AS seconds FROM time_entries
      WHERE day BETWEEN $1 AND $2${projectFilter} GROUP BY source ORDER BY source`,
    params,
  )
  return { rows: rows as ReportRow[], by_source: bySource as { source: TimeSource; seconds: number }[] }
}

export const todayLocal = () => localDay(Date.now())

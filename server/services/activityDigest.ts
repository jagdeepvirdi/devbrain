import { pool } from '../db/pool.js'
import { env } from '../lib/env.js'
import { withAdvisoryLock, LOCK_KEYS } from '../lib/advisoryLock.js'
import { LocalAIRequiredError } from '../lib/requireLocalAI.js'
import { buildProjectDigest, weekBounds, type DigestSummary, type GitStats } from './gitDigest.js'
import { sendAppriseNotification } from './notifier.js'

export interface DigestRow {
  id: string; project_id: string; week_start: string; week_end: string; commit_count: number
  branches: string[]; stats: GitStats; summary: DigestSummary
}
export interface GenerateResult {
  digests: unknown[]
  errors: { project_id: string; project: string; error: string }[]
  /** Same rows as `digests`, paired with the project name (used for notifications). */
  generated: { project: string; row: DigestRow }[]
}

/**
 * Generates (or regenerates — upsert) digests for every project with a linked fs_path,
 * or just `projectId`. With `onlyMissing`, projects that already have a digest for the
 * week are skipped, which makes the scheduler's catch-up check idempotent.
 * Per-project failures are collected in `errors`; the local-AI guard aborts the whole run.
 */
export async function generateDigests(
  week: string,
  opts: { projectId?: string; onlyMissing?: boolean } = {},
): Promise<GenerateResult> {
  const params: unknown[] = []
  let where = `fs_path IS NOT NULL AND fs_path <> ''`
  if (opts.projectId) { params.push(opts.projectId); where += ` AND id = $${params.length}` }
  if (opts.onlyMissing) {
    params.push(weekBounds(week).start)
    where += ` AND NOT EXISTS (SELECT 1 FROM activity_digests d
                                WHERE d.project_id = projects.id AND d.week_start = $${params.length})`
  }
  const { rows: projects } = await pool.query(
    `SELECT id, name, fs_path FROM projects WHERE ${where} ORDER BY name`, params,
  )

  const result: GenerateResult = { digests: [], errors: [], generated: [] }
  for (const p of projects as { id: string; name: string; fs_path: string }[]) {
    try {
      const d = await buildProjectDigest(p.fs_path, week)
      const { rows } = await pool.query(
        `INSERT INTO activity_digests
           (project_id, week_start, week_end, commit_count, branches, stats, summary, model, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (project_id, week_start) DO UPDATE SET
           week_end = EXCLUDED.week_end, commit_count = EXCLUDED.commit_count,
           branches = EXCLUDED.branches, stats = EXCLUDED.stats, summary = EXCLUDED.summary,
           model = EXCLUDED.model, generated_at = now()
         RETURNING *`,
        [p.id, d.week_start, d.week_end, d.commit_count,
         JSON.stringify(d.branches), JSON.stringify(d.stats), JSON.stringify(d.summary), env.OLLAMA_CHAT_MODEL],
      )
      result.digests.push(rows[0])
      result.generated.push({ project: p.name, row: rows[0] })
    } catch (err) {
      // The local-AI guard applies to the whole request, not one project.
      if (err instanceof LocalAIRequiredError) throw err
      result.errors.push({ project_id: p.id, project: p.name, error: (err as Error).message })
    }
  }
  return result
}

// ── Notification ─────────────────────────────────────────────────────────────

const MAX_SUMMARY = 200

export function formatDigestMessage(generated: GenerateResult['generated']): { title: string; body: string } {
  const withCommits = generated.filter(g => g.row.commit_count > 0)
  const first = generated[0].row
  const total = generated.reduce((n, g) => n + g.row.commit_count, 0)
  const title = `Weekly git digest: ${first.week_start} to ${first.week_end}`

  if (!withCommits.length) return { title, body: 'No commits in any linked project this week.' }

  const lines = withCommits.map(({ project, row }) => {
    const s = row.summary.summary.trim()
    const text = s.length > MAX_SUMMARY ? `${s.slice(0, MAX_SUMMARY - 1)}…` : s
    const delta = `+${row.stats.insertions}/-${row.stats.deletions}`
    return `• ${project}: ${row.commit_count} commits (${delta})${text ? ` — ${text}` : ''}`
  })
  return { title, body: `${total} commits across ${withCommits.length} project(s)\n${lines.join('\n')}` }
}

async function notifyActiveUsers(generated: GenerateResult['generated']): Promise<void> {
  const { title, body } = formatDigestMessage(generated)
  const { rows: users } = await pool.query<{ id: string }>(`SELECT id FROM users WHERE is_active = true`)
  for (const u of users) {
    try {
      await sendAppriseNotification({ userId: u.id, title, body, level: 'info' })
    } catch (err) {
      console.error(`[Activity Digest] notify failed for user ${u.id}:`, (err as Error).message)
    }
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/** Monday of the most recently completed week (UTC), as YYYY-MM-DD. */
export function lastCompletedWeek(now: Date = new Date()): string {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  return weekBounds(weekAgo).start
}

/**
 * One scheduler tick. Catch-up semantics: instead of firing at an exact Monday time (and
 * missing the week if the server was off), every tick checks whether last week's digests
 * exist and generates only the missing ones. Notifies once per tick that generated any.
 */
export async function runWeeklyDigest(now: Date = new Date()): Promise<void> {
  if (env.AI_PROVIDER !== 'ollama') return   // personal data: never route to a cloud model
  const week = lastCompletedWeek(now)
  const { generated, errors } = await generateDigests(week, { onlyMissing: true })
  for (const e of errors) console.error(`[Activity Digest] ${e.project}: ${e.error}`)
  if (generated.length) await notifyActiveUsers(generated)
}

async function tick(): Promise<void> {
  try {
    await runWeeklyDigest()
  } catch (err) {
    console.error('[Activity Digest] tick failed:', (err as Error).message)
  }
}

function runLockedTick(): Promise<void> {
  // Advisory-locked so only one server instance generates and notifies per tick.
  return withAdvisoryLock(LOCK_KEYS.activityDigest, tick)
}

export function startActivityDigestScheduler(): void {
  // First check after 60s (let DB + Ollama settle), then hourly — same shape as the
  // embedding-health and backup schedulers.
  setTimeout(() => {
    runLockedTick().catch(() => {})
    setInterval(() => { runLockedTick().catch(() => {}) }, 60 * 60 * 1000)
  }, 60_000)
}

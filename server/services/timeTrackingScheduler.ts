import { withAdvisoryLock, LOCK_KEYS } from '../lib/advisoryLock.js'
import { dayStart, localDay } from '../lib/timeMath.js'
import { importActivityWatch, importSessions, estimateGitHours, type ProjectResult } from './timeTracking.js'

// Keeps the Time Tracked widget fresh without anyone clicking Import (Phase 46 Step 3).
//   - ActivityWatch: every tick, re-importing yesterday + today so a late-night stretch is
//     finalized on the right day (imports replace their scope, so repeating is idempotent).
//   - Sessions + git estimate: they only change when you commit or end a session, and the git
//     scan walks every linked repo, so they run at most every SLOW_REFRESH_MS.
// ActivityWatch not running is the normal state on some machines/days, so it's logged once per
// distinct error rather than every hour. No AI is involved, so no local-AI guard is needed.

export const SLOW_REFRESH_MS = 6 * 60 * 60 * 1000

let lastSlowRun = 0
let lastAwError: string | null = null
let lastSlowErrors = ''

/** Test hook — the throttle/dedupe state is module-level on purpose (one scheduler per process). */
export function resetTimeSchedulerState(): void {
  lastSlowRun = 0
  lastAwError = null
  lastSlowErrors = ''
}

const errorsOf = (results: ProjectResult[]) =>
  results.filter(r => r.error).map(r => `${r.project}: ${r.error}`).join(' | ')

export async function runTimeImportTick(nowMs: number = Date.now()): Promise<void> {
  const today = localDay(nowMs)
  const yesterday = localDay(dayStart(today) - 1)   // last millisecond of the previous local day

  // ActivityWatch first: the git estimate skips every day ActivityWatch has data for.
  try {
    await importActivityWatch(yesterday, today)
    lastAwError = null
  } catch (err) {
    const msg = (err as Error).message
    if (msg !== lastAwError) console.warn(`[Time Tracking] ActivityWatch import skipped: ${msg}`)
    lastAwError = msg
  }

  if (nowMs - lastSlowRun >= SLOW_REFRESH_MS) {
    const sessions = await importSessions()
    const git = await estimateGitHours()
    lastSlowRun = nowMs
    const errs = [errorsOf(sessions), errorsOf(git)].filter(Boolean).join(' | ')
    if (errs && errs !== lastSlowErrors) console.warn(`[Time Tracking] some projects were skipped: ${errs}`)
    lastSlowErrors = errs
  }
}

async function tick(): Promise<void> {
  try {
    await runTimeImportTick()
  } catch (err) {
    console.error('[Time Tracking] tick failed:', (err as Error).message)
  }
}

function runLockedTick(): Promise<void> {
  // Advisory-locked so only one server instance imports per tick.
  return withAdvisoryLock(LOCK_KEYS.timeImport, tick)
}

export function startTimeTrackingScheduler(): void {
  // First run 90s after boot (after the digest scheduler's 60s, so the two don't contend for
  // the pool), then hourly — same shape as the other schedulers.
  setTimeout(() => {
    runLockedTick().catch(() => {})
    setInterval(() => { runLockedTick().catch(() => {}) }, 60 * 60 * 1000)
  }, 90_000)
}

/**
 * estimate-hours-from-git.ts — one-off backfill of per-project hours from git commit
 * timestamps (TASKS.md Phase 46 Step 3). Writes source='git-estimate' rows to time_entries;
 * never overwrites days ActivityWatch has data for. Re-runnable: each run replaces the
 * previous estimate for every linked project.
 *
 * Heuristic (git-hours): commits <= --gap-hours apart are one session; a session is worth
 * (last - first) + --credit-minutes, so a lone commit counts as --credit-minutes.
 *
 * Usage (run from server/):
 *   npx tsx scripts/estimate-hours-from-git.ts [--gap-hours 2] [--credit-minutes 30]
 */

import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { pool } from '../db/pool.js'
import { estimateGitHours } from '../services/timeTracking.js'

export function parseArgs(argv: string[]): { gapHours?: number; creditMinutes?: number; error?: string } {
  const out: { gapHours?: number; creditMinutes?: number; error?: string } = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag !== '--gap-hours' && flag !== '--credit-minutes') { out.error = `Unknown argument: ${flag}`; return out }
    const n = Number(argv[++i])
    if (!Number.isFinite(n) || n < 0) { out.error = `${flag} needs a non-negative number`; return out }
    if (flag === '--gap-hours') out.gapHours = n; else out.creditMinutes = n
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.error) {
    console.error(args.error)
    console.error('Usage: npx tsx scripts/estimate-hours-from-git.ts [--gap-hours 2] [--credit-minutes 30]')
    process.exitCode = 1
    return
  }

  const results = await estimateGitHours({
    gapMs:    args.gapHours      !== undefined ? args.gapHours * 3_600_000 : undefined,
    creditMs: args.creditMinutes !== undefined ? args.creditMinutes * 60_000 : undefined,
  })
  if (!results.length) console.log('No projects have a linked folder (fs_path) — nothing to estimate.')
  for (const r of results) {
    console.log(r.error
      ? `  ${r.project}: FAILED — ${r.error}`
      : `  ${r.project}: ${r.commits} commits → ${r.hours} h over ${r.days} day(s)`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch(err => { console.error(err); process.exitCode = 1 })
    .finally(() => pool.end())
}

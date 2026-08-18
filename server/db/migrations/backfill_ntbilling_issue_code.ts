/**
 * One-off backfill: split "<issue_code> — <title>" into separate issue_code/title values
 *
 * NT Billing Support issues were bulk-imported (import_ntbilling_issues.ts) with the
 * Case ID baked into the title as a "<case_id> — " prefix, back when issues.issue_code
 * didn't exist as a real column (schema.sql, Phase 44 added it). This moves that
 * prefix out of title text into the new column and cleans up title to just the
 * description.
 *
 * Idempotent — the WHERE clause only matches titles still carrying the "X — " prefix
 * pattern, which no longer holds once a row has been migrated, so re-running after a
 * successful pass is a no-op.
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/backfill_ntbilling_issue_code.ts
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

try {
  const raw = readFileSync(resolve(__dirname, '../../.env'), 'utf-8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
} catch { /* no .env — rely on environment */ }

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('[!!] DATABASE_URL is not set')
  process.exit(1)
}

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

async function run(): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: string; issue_code: string; title: string }>(
      `UPDATE issues
       SET issue_code = substring(title from '^(\\S+) — '),
           title       = regexp_replace(title, '^\\S+ — ', '')
       WHERE title ~ '^\\S+ — ' AND issue_code IS NULL
       RETURNING id, issue_code, title`
    )
    console.log(`Backfilled ${rows.length} issue(s).\n`)
    for (const r of rows) console.log(`  [ok] ${r.issue_code} -> "${r.title}"`)
  } finally {
    await pool.end()
  }
}

run().catch(err => { console.error('\n[!!] Backfill failed:', (err as Error).message); process.exit(1) })

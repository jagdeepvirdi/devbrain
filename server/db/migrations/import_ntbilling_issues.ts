/**
 * One-off import: NT Billing Support Case IDs -> Issues
 *
 * Loads server/../scratchpad-parsed issue records (from
 * D:\TOT\Release\NT-Release 2025.xlsx's Case ID column) into the `issues`
 * table for the "NT Billing Support" project — each Case ID referenced in
 * the release log becomes an Issue, with its component carried over and
 * its resolution/status derived from delivery status. Also links each
 * created issue back to every release it was delivered in (releases.linked_issues),
 * matched by version string.
 *
 * Input JSON must be an array of:
 *   { case_id, title, description, component, status, resolution, resolved_at, release_versions }
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/import_ntbilling_issues.ts <path-to-issues.json>
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

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

const PROJECT_ID = '5b4cc0ca-3b6f-401d-a6f5-f2fe03fb2542' // NT Billing Support

type IssueRecord = {
  case_id: string
  title: string
  description: string
  component: string | null
  status: 'open' | 'investigating' | 'resolved' | 'wont-fix'
  resolution: string
  resolved_at: string | null
  release_versions: string[]
}

async function run(): Promise<void> {
  const jsonPath = process.argv[2]
  if (!jsonPath) { console.error('Usage: import_ntbilling_issues.ts <path-to-issues.json>'); process.exit(1) }

  const records = JSON.parse(readFileSync(jsonPath, 'utf-8')) as IssueRecord[]
  const { pool } = await import('../pool.js')

  console.log(`Importing ${records.length} issue(s) into NT Billing Support...\n`)

  let created = 0
  let skipped = 0
  let linked = 0

  for (const r of records) {
    // Idempotent: skip if an issue for this Case ID already exists (title starts with "<case_id> —").
    const { rows: existingRows } = await pool.query(
      `SELECT id FROM issues WHERE project_id = $1 AND title LIKE $2`,
      [PROJECT_ID, `${r.case_id} %`]
    )
    if (existingRows.length) {
      skipped++
      console.log(`  [skip, already exists] ${r.case_id}`)
      continue
    }

    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO issues (project_id, title, description, status, priority, tags, component, resolution, resolved_at)
       VALUES ($1,$2,$3,$4,'medium',$5,$6,$7,$8)
       RETURNING id`,
      [PROJECT_ID, r.title, r.description, r.status, ['release-history'], r.component, r.resolution, r.resolved_at]
    )
    const issueId = rows[0].id
    created++
    console.log(`  [ok] ${r.case_id} -> issue ${issueId}`)

    for (const version of r.release_versions) {
      const { rowCount } = await pool.query(
        `UPDATE releases SET linked_issues = array_append(linked_issues, $1)
         WHERE project_id = $2 AND version = $3 AND NOT ($1 = ANY(linked_issues))`,
        [issueId, PROJECT_ID, version]
      )
      if (rowCount) linked++
      else console.warn(`      [!!] no release found for version "${version}" (issue ${r.case_id})`)
    }
  }

  console.log(`\nDone. ${created} issue(s) created, ${skipped} skipped, ${linked} release<->issue link(s) added.`)
  await pool.end()
}

run().catch(err => { console.error(err); process.exit(1) })

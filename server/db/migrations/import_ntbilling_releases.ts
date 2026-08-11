/**
 * One-off import: NT Billing Support release history
 *
 * Loads server/../scratchpad-parsed release records (from
 * D:\TOT\Release\NT-Release 2025.xlsx) into the `releases` table for the
 * "NT Billing Support" project, so release history moves from a manually
 * maintained spreadsheet into DevBrain's native Releases feature.
 *
 * Input JSON must be an array of:
 *   { version, date, type, component, fixes, features, breaking_changes, notes }
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/import_ntbilling_releases.ts <path-to-releases.json>
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

type ReleaseRecord = {
  version: string
  date: string
  type: 'major' | 'minor' | 'patch' | 'hotfix'
  component: string | null
  fixes: string[]
  features: string[]
  breaking_changes: string[]
  notes: string
}

async function run(): Promise<void> {
  const jsonPath = process.argv[2]
  if (!jsonPath) { console.error('Usage: import_ntbilling_releases.ts <path-to-releases.json>'); process.exit(1) }

  const records = JSON.parse(readFileSync(jsonPath, 'utf-8')) as ReleaseRecord[]
  const { pool } = await import('../pool.js')

  console.log(`Importing ${records.length} release(s) into NT Billing Support...\n`)

  let created = 0
  let skipped = 0

  for (const r of records) {
    try {
      const { rowCount } = await pool.query(
        `INSERT INTO releases (project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues, component)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (project_id, version) DO NOTHING`,
        [PROJECT_ID, r.version, r.date, r.type, r.features, r.fixes, r.breaking_changes, r.notes, [], r.component]
      )
      if (rowCount) { created++; console.log(`  [ok] ${r.date}  ${r.version}`) }
      else { skipped++; console.log(`  [skip, already exists] ${r.version}`) }
    } catch (err) {
      skipped++
      console.error(`  [!!] ${r.version} failed: ${(err as Error).message}`)
    }
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`)
  await pool.end()
}

run().catch(err => { console.error(err); process.exit(1) })

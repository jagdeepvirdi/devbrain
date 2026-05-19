/**
 * Migration: normalize investigation_steps and notes from JSONB into relational tables.
 *
 * Idempotent — only migrates issues that have no rows in issue_steps / issue_notes yet.
 * Run once after deploying the schema change:
 *   npx tsx server/db/migrations/normalize_issue_jsonb.ts
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
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
} catch { /* no .env — rely on environment */ }

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })

interface JsonStep { id: string; order: number; instruction: string; done: boolean }
interface JsonNote { id: string; content: string; created_at: string }

async function main() {
  const client = await pool.connect()
  try {
    console.log('Fetching issues with JSONB data...')

    // Only process issues that have no rows in issue_steps yet
    const { rows: issues } = await client.query<{
      id: string
      investigation_steps: JsonStep[]
      notes: JsonNote[]
    }>(`
      SELECT i.id, i.investigation_steps, i.notes
      FROM issues i
      WHERE NOT EXISTS (SELECT 1 FROM issue_steps s WHERE s.issue_id = i.id)
        AND (jsonb_array_length(i.investigation_steps) > 0 OR jsonb_array_length(i.notes) > 0)
    `)

    console.log(`Found ${issues.length} issue(s) to migrate.`)
    if (issues.length === 0) { console.log('Nothing to do.'); return }

    let stepsMigrated = 0
    let notesMigrated = 0

    await client.query('BEGIN')

    for (const issue of issues) {
      for (const step of issue.investigation_steps ?? []) {
        await client.query(
          `INSERT INTO issue_steps (id, issue_id, "order", instruction, done)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO NOTHING`,
          [step.id ?? crypto.randomUUID(), issue.id, step.order ?? 0, step.instruction, step.done ?? false]
        )
        stepsMigrated++
      }
      for (const note of issue.notes ?? []) {
        await client.query(
          `INSERT INTO issue_notes (id, issue_id, content, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO NOTHING`,
          [note.id ?? crypto.randomUUID(), issue.id, note.content, note.created_at ?? new Date().toISOString()]
        )
        notesMigrated++
      }
    }

    await client.query('COMMIT')
    console.log(`Migrated ${stepsMigrated} step(s) and ${notesMigrated} note(s).`)
    console.log('Done.')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', (err as Error).message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

main()

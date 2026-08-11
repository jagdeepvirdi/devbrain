/**
 * Migration: add_entity_components
 *
 * Extends the single-select `component` grouping (e.g. 'SAP', 'BPP', 'Payment')
 * from documents to issues, tasks, releases, and commands, so items across all
 * entity types can share the same feature/module tag — used to filter and
 * bulk-link related items in the "+ Link item" picker.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_entity_components.ts
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
if (!DATABASE_URL) { console.error('[!!] DATABASE_URL not set'); process.exit(1) }

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

const TABLES = ['issues', 'tasks', 'releases', 'commands']

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    for (const [i, table] of TABLES.entries()) {
      console.log(`[${i + 1}/${TABLES.length}] Adding ${table}.component column + index...`)
      await client.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS component TEXT`)
      await client.query(`
        CREATE INDEX IF NOT EXISTS ${table}_component_idx
          ON ${table} (project_id, component) WHERE component IS NOT NULL
      `)
      console.log('      done')
    }

    await client.query('COMMIT')
    console.log('\nMigration complete.\n')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\n[!!] ROLLBACK:', (err as Error).message)
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

run().catch(() => process.exit(1))

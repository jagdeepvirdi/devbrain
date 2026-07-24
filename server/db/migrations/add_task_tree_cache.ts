/**
 * Migration: add_task_tree_cache
 *
 * Adds `task_tree_cache` — lets services/tasks-watcher.ts's SSE broadcast reach
 * subscribers connected to a *different* server instance than the one whose chokidar
 * watcher actually detected the TASKS.md change (only one instance can have the
 * project's fs_path mounted in the first place). The watcher UPSERTs the freshly-parsed
 * tree here, then does `pg_notify('tasks_update', projectId)` — every instance keeps one
 * LISTEN connection open and re-reads this row (not the NOTIFY payload itself, which is
 * capped at 8000 bytes by Postgres and too small for an arbitrarily large task tree) to
 * broadcast to its own local SSE subscribers. See TASKS.md Phase 33.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_task_tree_cache.ts
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

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('[1/1] Creating task_tree_cache table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS task_tree_cache (
        project_id TEXT        PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        tree       JSONB       NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    console.log('      done')

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

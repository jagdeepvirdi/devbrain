/**
 * Migration: add_embedding_health_snapshots
 *
 * Adds `embedding_health_snapshots` — a periodic global count of
 * documents.embedding_status (pending/processing/done/failed), captured
 * hourly by services/embeddingHealthSnapshot.ts's scheduler. Current status
 * alone only shows "right now"; this gives the Dashboard a trend line, which
 * would have surfaced the 2026-07-15 GPU-thrashing regression (see
 * TASKS.md Known Issues) without needing a live incident to notice it.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_embedding_health_snapshots.ts
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

    console.log('[1/2] Creating embedding_health_snapshots table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS embedding_health_snapshots (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        pending     INTEGER     NOT NULL,
        processing  INTEGER     NOT NULL,
        done        INTEGER     NOT NULL,
        failed      INTEGER     NOT NULL
      )
    `)
    console.log('      done')

    console.log('[2/2] Creating index on captured_at...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS embedding_health_snapshots_captured_idx
        ON embedding_health_snapshots (captured_at)
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

/**
 * Migration: add_entity_links
 *
 * Adds the `entity_links` table — a general-purpose, polymorphic many-to-many
 * link between Tasks, Documents (including Codes), Issues, Releases, and
 * Commands. See schema.sql for the design notes on canonical ordering.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_entity_links.ts
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

    console.log('[1/3] Creating entity_links table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS entity_links (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        a_type     TEXT        NOT NULL CHECK (a_type IN ('task', 'document', 'issue', 'release', 'command')),
        a_id       TEXT        NOT NULL,
        b_type     TEXT        NOT NULL CHECK (b_type IN ('task', 'document', 'issue', 'release', 'command')),
        b_id       TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (a_type, a_id, b_type, b_id)
      )
    `)
    console.log('      done')

    console.log('[2/3] Adding a-side index...')
    await client.query(`CREATE INDEX IF NOT EXISTS entity_links_a_idx ON entity_links (a_type, a_id)`)
    console.log('      done')

    console.log('[3/3] Adding b-side index...')
    await client.query(`CREATE INDEX IF NOT EXISTS entity_links_b_idx ON entity_links (b_type, b_id)`)
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

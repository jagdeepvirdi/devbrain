/**
 * Migration: add_source_component
 *
 * Adds a nullable `source_component` column to `documents` — marks a
 * generated document as the overview for a whole `component` group of code
 * files (POST /api/documents/component-overview). Combined with project_id,
 * it's the idempotency key that lets regenerating an overview update the
 * same row instead of creating duplicates, mirroring how source_document_id
 * does the same thing for single-file "Save as document".
 * Safe to re-run (IF NOT EXISTS).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_source_component.ts
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

    console.log('[1/1] Adding documents.source_component column...')
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS source_component TEXT`)
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

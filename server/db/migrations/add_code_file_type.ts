/**
 * Migration: add_code_file_type
 *
 * Adds 'code' to the documents.file_type CHECK constraint and a nullable
 * `language` column (e.g. 'typescript', 'python') so source files can be
 * tracked as documents and surfaced in the new Codes tab.
 * Safe to re-run (constraint is dropped/recreated, column is IF NOT EXISTS).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_code_file_type.ts
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

    console.log('[1/2] Adding documents.language column...')
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS language TEXT`)
    console.log('      done')

    console.log('[2/2] Widening file_type CHECK to include \'code\'...')
    await client.query(`ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_file_type_check`)
    await client.query(`
      ALTER TABLE documents ADD CONSTRAINT documents_file_type_check
        CHECK (file_type IN ('pdf', 'docx', 'md', 'txt', 'xlsx', 'url', 'code'))
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

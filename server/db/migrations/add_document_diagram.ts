/**
 * Migration: add_document_diagram
 *
 * Adds `diagram` and `diagram_hash` columns to `documents` — an AI-generated
 * Mermaid diagram of a code file's structure, populated on demand via
 * POST /api/documents/:id/diagram. `diagram_hash` mirrors the
 * explanation_hash staleness pattern (see add_explanation_hash.ts).
 * Safe to re-run (IF NOT EXISTS).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_document_diagram.ts
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

    console.log('[1/2] Adding documents.diagram column...')
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS diagram TEXT`)
    console.log('      done')

    console.log('[2/2] Adding documents.diagram_hash column...')
    await client.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS diagram_hash TEXT`)
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

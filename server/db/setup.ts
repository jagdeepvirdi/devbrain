/**
 * db/setup.ts — idempotent database initialiser
 *
 * Runs schema.sql against the configured DATABASE_URL, then seeds
 * default projects/commands/runbooks if the projects table is empty.
 *
 * Usage (from server/ directory):
 *   npx tsx db/setup.ts
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import pg from 'pg'
import { runSeed } from './seed.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = dirname(__filename)

// ── Load .env ─────────────────────────────────────────────────────────────

try {
  const raw = readFileSync(resolve(__dirname, '../.env'), 'utf-8')
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
if (!DATABASE_URL) {
  console.error('[!!] DATABASE_URL is not set')
  process.exit(1)
}

// ── Run ───────────────────────────────────────────────────────────────────

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

async function main(): Promise<void> {
  const client = await pool.connect()

  try {
    console.log('\n[1/2] Applying schema.sql...')
    const sql = readFileSync(resolve(__dirname, 'schema.sql'), 'utf-8')
    await client.query(sql)
    console.log('      done')

    client.release()

    console.log('\n[2/2] Seeding default data...')
    await runSeed()
    console.log('      done')

    console.log('\nSetup complete.\n')
  } catch (err) {
    client.release()
    console.error('\n[!!] Setup failed:', (err as Error).message)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

main()

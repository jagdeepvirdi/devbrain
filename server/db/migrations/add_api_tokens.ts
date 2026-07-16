/**
 * Migration: add_api_tokens
 *
 * Adds the `api_tokens` table — personal access tokens generated from
 * Settings > Account, used to authenticate scripted/curl requests without
 * a browser session cookie. Only a sha256 hash of the token is stored.
 * Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_api_tokens.ts
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

    console.log('[1/3] Creating api_tokens table...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS api_tokens (
        id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name         TEXT        NOT NULL,
        token_hash   TEXT        NOT NULL UNIQUE,
        token_prefix TEXT        NOT NULL,
        last_used_at TIMESTAMPTZ,
        expires_at   TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    console.log('      done')

    console.log('[2/3] Adding user index...')
    await client.query(`CREATE INDEX IF NOT EXISTS api_tokens_user_idx ON api_tokens (user_id)`)
    console.log('      done')

    console.log('[3/3] Adding hash index...')
    await client.query(`CREATE INDEX IF NOT EXISTS api_tokens_hash_idx ON api_tokens (token_hash)`)
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

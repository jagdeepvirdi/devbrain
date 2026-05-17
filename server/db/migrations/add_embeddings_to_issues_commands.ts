/**
 * Migration: add_embeddings_to_issues_commands
 *
 * Adds embedding VECTOR(768) + HNSW index to issues and commands tables.
 * Embeddings are populated at write-time (create/update) — no backfill here.
 *
 * Run from D:\Project\devbrain\server:
 *   npx tsx db/migrations/add_embeddings_to_issues_commands.ts
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
} catch { /* rely on environment */ }

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) { console.error('[!!] DATABASE_URL not set'); process.exit(1) }

const { Pool } = pg
const pool = new Pool({ connectionString: DATABASE_URL })

async function run(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('\n[1/4] issues.embedding...')
    await client.query(`ALTER TABLE issues ADD COLUMN IF NOT EXISTS embedding VECTOR(768)`)
    console.log('      done')

    console.log('\n[2/4] issues HNSW index...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS issues_embedding_hnsw_idx
        ON issues USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
    `)
    console.log('      done')

    console.log('\n[3/4] commands.embedding...')
    await client.query(`ALTER TABLE commands ADD COLUMN IF NOT EXISTS embedding VECTOR(768)`)
    console.log('      done')

    console.log('\n[4/4] commands HNSW index...')
    await client.query(`
      CREATE INDEX IF NOT EXISTS commands_embedding_hnsw_idx
        ON commands USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 64)
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

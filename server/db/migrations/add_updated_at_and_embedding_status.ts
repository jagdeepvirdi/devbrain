/**
 * Migration: add_updated_at_and_embedding_status
 *
 * Adds updated_at columns + set_updated_at triggers to all main tables.
 * Adds embedding_status column to documents and issues.
 * Safe to re-run (IF NOT EXISTS / DO NOTHING patterns throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_updated_at_and_embedding_status.ts
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

    // ── Trigger function ──────────────────────────────────────────────────
    console.log('[1/3] set_updated_at trigger function...')
    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$
    `)
    console.log('      done')

    // ── updated_at columns ────────────────────────────────────────────────
    console.log('[2/3] Adding updated_at columns...')
    const tables = [
      'projects', 'documents', 'issues', 'commands',
      'releases', 'runbooks', 'tasks', 'users',
    ]
    for (const tbl of tables) {
      await client.query(`
        ALTER TABLE ${tbl}
          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      `)
      // Create trigger only if it does not already exist
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_trigger
            WHERE tgname = 'trg_${tbl}_updated_at'
              AND tgrelid = '${tbl}'::regclass
          ) THEN
            CREATE TRIGGER trg_${tbl}_updated_at
              BEFORE UPDATE ON ${tbl}
              FOR EACH ROW EXECUTE FUNCTION set_updated_at();
          END IF;
        END $$
      `)
      console.log(`      ${tbl}.updated_at + trigger: ok`)
    }

    // ── embedding_status columns ──────────────────────────────────────────
    console.log('[3/3] Adding embedding_status columns...')
    for (const tbl of ['documents', 'issues']) {
      await client.query(`
        ALTER TABLE ${tbl}
          ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending'
      `)
      // Add CHECK constraint only if not already present
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conrelid = '${tbl}'::regclass
              AND conname   = '${tbl}_embedding_status_check'
          ) THEN
            ALTER TABLE ${tbl}
              ADD CONSTRAINT ${tbl}_embedding_status_check
              CHECK (embedding_status IN ('pending', 'processing', 'done', 'failed'));
          END IF;
        END $$
      `)
      // Backfill: mark as done where chunks/embeddings already exist
      if (tbl === 'documents') {
        await client.query(`
          UPDATE documents d
             SET embedding_status = 'done'
           WHERE embedding_status = 'pending'
             AND EXISTS (
               SELECT 1 FROM document_chunks dc
                WHERE dc.document_id = d.id
                  AND dc.embedding IS NOT NULL
             )
        `)
      } else {
        await client.query(`
          UPDATE issues
             SET embedding_status = 'done'
           WHERE embedding_status = 'pending'
             AND embedding IS NOT NULL
        `)
      }
      console.log(`      ${tbl}.embedding_status: ok`)
    }

    // Partial indexes for pending/failed rows (efficient retry queries)
    await client.query(`
      CREATE INDEX IF NOT EXISTS documents_emb_status_idx
        ON documents (embedding_status) WHERE embedding_status != 'done'
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS issues_emb_status_idx
        ON issues (embedding_status) WHERE embedding_status != 'done'
    `)

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

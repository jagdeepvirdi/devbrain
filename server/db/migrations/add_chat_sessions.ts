/**
 * Migration: add_chat_sessions
 *
 * Adds chat_sessions + chat_messages tables — conversation memory for
 * DocChat (Phase 32.1). Safe to re-run (IF NOT EXISTS throughout).
 *
 * Run from server/ directory:
 *   npx tsx db/migrations/add_chat_sessions.ts
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

    console.log('[1/3] Creating chat_sessions...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT        REFERENCES projects(id) ON DELETE CASCADE,
        component  TEXT,
        title      TEXT        NOT NULL DEFAULT 'New chat',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_chat_sessions_updated_at'
        ) THEN
          CREATE TRIGGER trg_chat_sessions_updated_at
            BEFORE UPDATE ON chat_sessions
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_sessions_user_idx ON chat_sessions (user_id, updated_at DESC)
    `)
    console.log('      done')

    console.log('[2/3] Creating chat_messages...')
    await client.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        session_id TEXT        NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
        role       TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
        content    TEXT        NOT NULL DEFAULT '',
        citations  JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query(`
      CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at)
    `)
    console.log('      done')

    console.log('[3/3] Verifying set_updated_at() trigger function exists...')
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

/**
 * Org v2 migration — run once against an existing DevBrain database.
 * Idempotent (IF NOT EXISTS / IF NOT EXISTS columns).
 *
 * Usage:  node server/db/migrate-org-v2.mjs
 */

import pg from 'pg'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
import { config } from 'dotenv'
config()

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

async function run() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // ── Users ──────────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        username      TEXT        NOT NULL UNIQUE,
        email         TEXT,
        password_hash TEXT,                    -- NULL for LDAP-only users
        role          TEXT        NOT NULL DEFAULT 'editor'
                        CHECK (role IN ('admin', 'editor', 'viewer')),
        ldap_dn       TEXT,                    -- LDAP distinguished name if LDAP user
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    console.log('  users table: ok')

    // ── Project members ────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_members (
        user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        role       TEXT NOT NULL DEFAULT 'editor'
                     CHECK (role IN ('admin', 'editor', 'viewer')),
        added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, project_id)
      )
    `)
    console.log('  project_members table: ok')

    // ── Audit events ───────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_events (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id     TEXT        REFERENCES users(id) ON DELETE SET NULL,
        username    TEXT,
        entity_type TEXT        NOT NULL,
        entity_id   TEXT        NOT NULL,
        entity_name TEXT,
        action      TEXT        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS audit_entity_idx  ON audit_events (entity_type, entity_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS audit_user_idx    ON audit_events (user_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events (created_at DESC)`)
    console.log('  audit_events table: ok')

    // ── Commands: namespace + created_by columns ───────────────────────────
    await client.query(`
      ALTER TABLE commands
        ADD COLUMN IF NOT EXISTS namespace   TEXT NOT NULL DEFAULT 'team'
                                               CHECK (namespace IN ('personal', 'team')),
        ADD COLUMN IF NOT EXISTS created_by  TEXT REFERENCES users(id) ON DELETE SET NULL
    `)
    console.log('  commands.namespace + created_by: ok')

    await client.query('COMMIT')
    console.log('\nOrg v2 migration complete ✓')
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', err.message)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

run()

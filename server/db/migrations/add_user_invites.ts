import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Adding is_active to users and creating user_invites table...')

    // 1. Add is_active to users
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
    `)

    // 2. Create user_invites table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_invites (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email       TEXT        NOT NULL UNIQUE,
        role        TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'viewer')),
        token_hash  TEXT        NOT NULL,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by  TEXT        REFERENCES users(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS user_invites_token_idx ON user_invites (token_hash);
    `)

    await client.query('COMMIT')
    console.log('Migration complete.')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('Migration failed:', e)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

migrate()

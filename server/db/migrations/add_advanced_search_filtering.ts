import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Running Phase 28.2 (Advanced Search & Filtering) migrations...')

    // Create saved_filters table
    await client.query(`
      CREATE TABLE IF NOT EXISTS saved_filters (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        entity_type TEXT        NOT NULL,
        filter_json JSONB       NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS saved_filters_user_idx ON saved_filters (user_id);
    `)

    // Create search_history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS search_history (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id    TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        query      TEXT        NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS search_history_user_idx ON search_history (user_id);
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

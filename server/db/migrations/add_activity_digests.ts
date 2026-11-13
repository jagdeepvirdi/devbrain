import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    console.log('Running Phase 46 Step 2 (activity digests) migration...')

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_digests (
        id           TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id   TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        week_start   DATE        NOT NULL,
        week_end     DATE        NOT NULL,
        commit_count INT         NOT NULL DEFAULT 0,
        branches     JSONB       NOT NULL DEFAULT '[]',
        stats        JSONB       NOT NULL DEFAULT '{}',
        summary      JSONB       NOT NULL DEFAULT '{}',
        model        TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (project_id, week_start)
      );
      CREATE INDEX IF NOT EXISTS activity_digests_week_idx ON activity_digests (week_start);
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

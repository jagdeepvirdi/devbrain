import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    console.log('Running Phase 46 Step 3 (time tracking) migration...')

    // project_id NULL = the "Unassigned" bucket, so uniqueness is on COALESCE(project_id, '').
    await client.query(`
      CREATE TABLE IF NOT EXISTS time_entries (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id TEXT        REFERENCES projects(id) ON DELETE CASCADE,
        source     TEXT        NOT NULL CHECK (source IN ('activitywatch', 'claude-session', 'git-estimate')),
        day        DATE        NOT NULL,
        seconds    INT         NOT NULL CHECK (seconds >= 0),
        detail     JSONB       NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS time_entries_uniq_idx ON time_entries (COALESCE(project_id, ''), source, day);
      CREATE INDEX IF NOT EXISTS time_entries_day_idx ON time_entries (day);

      CREATE TABLE IF NOT EXISTS time_mapping_rules (
        id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        kind       TEXT        NOT NULL CHECK (kind IN ('path', 'title', 'app', 'editor_project')),
        pattern    TEXT        NOT NULL CHECK (length(pattern) BETWEEN 1 AND 500),
        priority   INT         NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS time_mapping_rules_project_idx ON time_mapping_rules (project_id);
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

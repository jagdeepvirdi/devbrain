import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Running Phase 24 and 25 migrations...')

    await client.query(`
      CREATE OR REPLACE FUNCTION set_updated_at()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$;

      CREATE TABLE IF NOT EXISTS issue_commits (
        issue_id   TEXT        NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
        sha        TEXT        NOT NULL,
        project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        linked_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (issue_id, sha)
      );
      CREATE INDEX IF NOT EXISTS issue_commits_issue_idx ON issue_commits (issue_id);

      ALTER TABLE issues ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'devbrain';
      ALTER TABLE issues ADD COLUMN IF NOT EXISTS external_id TEXT;
      CREATE INDEX IF NOT EXISTS issues_external_id_idx ON issues (external_id) WHERE external_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS integrations (
        id                  TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        provider            TEXT        NOT NULL,
        project_id          TEXT        REFERENCES projects(id) ON DELETE CASCADE,
        external_project_id TEXT,
        token_enc           TEXT,
        last_synced_at      TIMESTAMPTZ,
        config              JSONB       NOT NULL DEFAULT '{}',
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_trigger WHERE tgname = 'trg_integrations_updated_at'
        ) THEN
          CREATE TRIGGER trg_integrations_updated_at
            BEFORE UPDATE ON integrations
            FOR EACH ROW EXECUTE FUNCTION set_updated_at();
        END IF;
      END $$;

      CREATE INDEX IF NOT EXISTS integrations_project_provider_idx ON integrations (project_id, provider);
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

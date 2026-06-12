import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Running Phase 28.5 (Notification Hub) migrations...')

    // 1. Create notification_channels table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_channels (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id     TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name        TEXT        NOT NULL,
        apprise_url TEXT        NOT NULL,
        enabled     BOOLEAN     NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS notification_channels_user_idx ON notification_channels (user_id);
    `)

    // 2. Create project_notification_prefs table
    await client.query(`
      CREATE TABLE IF NOT EXISTS project_notification_prefs (
        project_id TEXT        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        channel_id TEXT        NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
        enabled    BOOLEAN     NOT NULL DEFAULT true,
        PRIMARY KEY (project_id, channel_id)
      );
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

import 'dotenv/config'
import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Running Phase 28.1 (Notifications) migrations...')

    // Create notifications table
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type            TEXT        NOT NULL,
        title           TEXT        NOT NULL,
        body            TEXT        NOT NULL DEFAULT '',
        entity_type     TEXT,
        entity_id       TEXT,
        read            BOOLEAN     NOT NULL DEFAULT false,
        channel         TEXT        NOT NULL DEFAULT 'in_app',
        delivery_status TEXT        NOT NULL DEFAULT 'delivered',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS notifications_user_read_idx ON notifications (user_id, read);
      CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications (created_at DESC);
    `)

    // Seed default notification rules in app_settings
    await client.query(`
      INSERT INTO app_settings (key, value)
      VALUES (
        'notification_rules',
        '{"stale_threshold_days": 14, "sync_alerts_enabled": true, "ai_task_alerts_enabled": true}'::jsonb
      )
      ON CONFLICT (key) DO NOTHING;
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

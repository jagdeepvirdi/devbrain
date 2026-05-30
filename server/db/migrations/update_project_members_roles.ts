import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Migrating project_members roles to member...')

    // 1. Update existing records
    await client.query("UPDATE project_members SET role = 'member' WHERE role = 'editor'")

    // 2. Drop old constraint and add new one
    await client.query(`
      ALTER TABLE project_members DROP CONSTRAINT IF EXISTS project_members_role_check;
      ALTER TABLE project_members ADD CONSTRAINT project_members_role_check 
        CHECK (role IN ('admin', 'member', 'viewer'));
      ALTER TABLE project_members ALTER COLUMN role SET DEFAULT 'member';
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

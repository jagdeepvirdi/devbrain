import { pool } from '../pool.js'

async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    console.log('Migrating role names from editor to member...')

    // 1. Update existing records
    await client.query("UPDATE users SET role = 'member' WHERE role = 'editor'")

    // 2. Drop old constraint and add new one
    // Note: We need to find the constraint name first. Usually it's users_role_check
    await client.query(`
      ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
      ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role IN ('admin', 'member', 'viewer'));
      ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
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

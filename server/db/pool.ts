import pg from 'pg'
import { env } from '../lib/env.js'

const { Pool, types } = pg

// DATE columns (OID 1082) have no time-of-day or timezone component, but
// node-postgres's default parser still routes them through a JS Date object
// anchored at *local* midnight (see postgres-date's getDate()). Once that
// Date is JSON-serialized, toISOString() converts it to UTC — which shifts
// the calendar date backward by a day on any server running east of UTC
// (e.g. Asia/Bangkok, UTC+7) and turns a plain "YYYY-MM-DD" into a full
// datetime string the client code doesn't expect. Keeping the raw text
// bypasses Date entirely, so the value that comes back is always exactly
// what's stored — same fix applies to every DATE column app-wide (releases,
// tasks.due_date, etc.), not just the one that surfaced it.
types.setTypeParser(1082, (val: string) => val)

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pool.on('error', (err) => {
  console.error('pg pool error:', err.message)
})

export async function dbReady(): Promise<boolean> {
  try {
    const client = await pool.connect()
    await client.query('SELECT 1')
    client.release()
    return true
  } catch {
    return false
  }
}

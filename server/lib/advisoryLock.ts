import { pool } from '../db/pool.js'

// Postgres advisory locks make sure only one server instance executes a given scheduled
// job at a time, even when 2+ instances run against the same database (the default
// in-process `setInterval` schedulers had no such coordination — see TASKS.md Phase 33).
// Arbitrary but distinct integers; keep them here so every scheduler's key is visible
// in one place instead of scattered magic numbers.
export const LOCK_KEYS = {
  backup:            727_001,
  staleIssueScan:    727_002,
  dailyDigest:       727_003,
  embeddingSnapshot: 727_004,
} as const

/**
 * Runs `fn` only if this process wins a transaction-scoped advisory lock for `key`.
 * The lock is held on one dedicated client for the duration of a single transaction and
 * releases automatically on COMMIT/ROLLBACK (or if the connection drops) — there's no
 * separate unlock step to forget. If another instance already holds the lock, `fn` is
 * skipped silently; that's the expected common case for a periodic tick, not an error.
 * Suited to short-lived, one-shot jobs (a single backup/scan/snapshot run).
 */
export async function withAdvisoryLock(key: number, fn: () => Promise<void>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock($1) AS locked', [key]
    )
    if (!rows[0]?.locked) {
      await client.query('ROLLBACK')
      return
    }
    await fn()
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Tries to acquire a session-level advisory lock for `key`, held for as long as the
 * caller wants (unlike withAdvisoryLock, not tied to a single transaction) — suited to
 * a long-running singleton process (e.g. a spawned child process that runs for the
 * server's whole lifetime). Returns `null` if another instance already holds it;
 * otherwise returns a release function the caller must call exactly once when the
 * long-running work ends, which unlocks and returns the dedicated client to the pool.
 */
export async function tryAcquireLongLivedLock(key: number): Promise<(() => Promise<void>) | null> {
  const client = await pool.connect()
  const { rows } = await client.query<{ locked: boolean }>(
    'SELECT pg_try_advisory_lock($1) AS locked', [key]
  )
  if (!rows[0]?.locked) {
    client.release()
    return null
  }

  let released = false
  return async () => {
    if (released) return
    released = true
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [key])
    } finally {
      client.release()
    }
  }
}

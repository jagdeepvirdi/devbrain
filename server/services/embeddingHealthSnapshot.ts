import { pool } from '../db/pool.js'

const RETENTION_DAYS = 30

export async function captureSnapshot(): Promise<void> {
  const { rows } = await pool.query<{ pending: number; processing: number; done: number; failed: number }>(
    `SELECT
       COUNT(*) FILTER (WHERE embedding_status = 'pending')::int    AS pending,
       COUNT(*) FILTER (WHERE embedding_status = 'processing')::int AS processing,
       COUNT(*) FILTER (WHERE embedding_status = 'done')::int       AS done,
       COUNT(*) FILTER (WHERE embedding_status = 'failed')::int     AS failed
     FROM documents`
  )
  const { pending, processing, done, failed } = rows[0]
  await pool.query(
    `INSERT INTO embedding_health_snapshots (pending, processing, done, failed) VALUES ($1, $2, $3, $4)`,
    [pending, processing, done, failed]
  )
}

export async function pruneOldSnapshots(): Promise<void> {
  await pool.query(
    `DELETE FROM embedding_health_snapshots WHERE captured_at < now() - ($1 || ' days')::interval`,
    [RETENTION_DAYS]
  )
}

async function tick(): Promise<void> {
  try {
    await captureSnapshot()
    await pruneOldSnapshots()
  } catch {
    // DB not ready, or a transient failure — next scheduled tick will retry.
  }
}

export function startEmbeddingHealthScheduler(): void {
  // Run once after 30s delay (let DB settle on startup), then every hour —
  // same shape as services/backup.ts's startBackupScheduler().
  setTimeout(() => {
    tick().catch(() => {})
    setInterval(() => { tick().catch(() => {}) }, 60 * 60 * 1000)
  }, 30_000)
}

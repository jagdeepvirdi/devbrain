import fs   from 'fs'
import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const archiver = require('archiver') as typeof import('archiver')
import { pool } from '../db/pool.js'
import { buildZipToStream } from './exporter.js'

type BackupSchedule = 'daily' | 'weekly' | 'off'

interface BackupSettings {
  path:           string | null
  schedule:       BackupSchedule
  last_backup_at: string | null
}

async function readConfig(): Promise<BackupSettings> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'backup_settings'`,
  )
  return (rows[0]?.value as BackupSettings) ?? { path: null, schedule: 'off', last_backup_at: null }
}

async function writeLastBackupAt(ts: string): Promise<void> {
  await pool.query(
    `UPDATE app_settings
       SET value = jsonb_set(value, '{last_backup_at}', $1::jsonb), updated_at = now()
     WHERE key = 'backup_settings'`,
    [JSON.stringify(ts)],
  )
}

async function runBackup(backupPath: string): Promise<void> {
  // Ensure directory exists
  fs.mkdirSync(backupPath, { recursive: true })

  const date     = new Date().toISOString().slice(0, 10)
  const filename = path.join(backupPath, `devbrain-backup-${date}.zip`)
  const output   = fs.createWriteStream(filename)

  await new Promise<void>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 6 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    buildZipToStream(archive, 'all').catch(reject)
  })
}

async function maybeRunBackup(): Promise<void> {
  let cfg: BackupSettings
  try {
    cfg = await readConfig()
  } catch {
    return // DB not ready
  }

  if (cfg.schedule === 'off' || !cfg.path) return

  const now        = Date.now()
  const last       = cfg.last_backup_at ? new Date(cfg.last_backup_at).getTime() : 0
  const thresholds = { daily: 24 * 3600 * 1000, weekly: 7 * 24 * 3600 * 1000 }
  const threshold  = thresholds[cfg.schedule]

  if (now - last < threshold) return

  try {
    await runBackup(cfg.path)
    await writeLastBackupAt(new Date().toISOString())
    console.log(`  backup: scheduled backup written to ${cfg.path}`)
  } catch (err) {
    console.error('  backup: scheduled backup failed:', (err as Error).message)
  }
}

export async function triggerBackupNow(backupPath: string): Promise<void> {
  await runBackup(backupPath)
  await writeLastBackupAt(new Date().toISOString())
}

export function startBackupScheduler(): void {
  // Run once after 30 s delay (let DB settle on startup), then every hour
  setTimeout(() => {
    maybeRunBackup().catch(() => {})
    setInterval(() => { maybeRunBackup().catch(() => {}) }, 60 * 60 * 1000)
  }, 30_000)
}

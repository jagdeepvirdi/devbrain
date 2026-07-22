import fs   from 'fs'
import path from 'path'
import { createRequire } from 'module'
import type { Archiver, ArchiverOptions } from 'archiver'
const require = createRequire(import.meta.url)
// archiver@8 is ESM-only and dropped the old `archiver(format, opts)` factory
// in favor of format-specific classes (ZipArchive, TarArchive, ...) — but
// @types/archiver is still pinned to the old v7 factory-function shape, so
// the cast below reflects the real runtime API rather than the stale types.
const { ZipArchive } = require('archiver') as { ZipArchive: new (options?: ArchiverOptions) => Archiver }
import { pool } from '../db/pool.js'
import { buildZipToStream } from './exporter.js'

type BackupSchedule = 'daily' | 'weekly' | 'off'

interface BackupSettings {
  path:            string | null
  schedule:        BackupSchedule
  last_backup_at:  string | null
  retention_count: number | null
}

export const DEFAULT_BACKUP_RETENTION_COUNT = 30

async function readConfig(): Promise<BackupSettings> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'backup_settings'`,
  )
  return (rows[0]?.value as BackupSettings) ?? { path: null, schedule: 'off', last_backup_at: null, retention_count: null }
}

const BACKUP_FILENAME_RE = /^devbrain-backup-\d{4}-\d{2}-\d{2}\.zip$/

// Deletes the oldest dated backup zips beyond `keepLastN`, so a scheduler
// left running for months doesn't grow `backupPath` unbounded. ISO-format
// filenames sort chronologically as plain strings, so no date parsing needed.
export async function pruneOldBackups(backupPath: string, keepLastN: number): Promise<void> {
  if (keepLastN <= 0) return // 0/negative means "no limit", not "delete everything"

  let entries: string[]
  try {
    entries = await fs.promises.readdir(backupPath)
  } catch {
    return
  }

  const backups = entries.filter(f => BACKUP_FILENAME_RE.test(f)).sort()
  const excess  = backups.length - keepLastN
  if (excess <= 0) return

  await Promise.all(
    backups.slice(0, excess).map(f =>
      fs.promises.unlink(path.join(backupPath, f)).catch(err => {
        console.error(`  backup: failed to prune ${f}:`, (err as Error).message)
      }),
    ),
  )
}

async function writeLastBackupAt(ts: string): Promise<void> {
  await pool.query(
    `UPDATE app_settings
       SET value = jsonb_set(value, '{last_backup_at}', $1::jsonb), updated_at = now()
     WHERE key = 'backup_settings'`,
    [JSON.stringify(ts)],
  )
}

async function runBackup(backupPath: string, keepLastN: number): Promise<void> {
  // Ensure directory exists
  fs.mkdirSync(backupPath, { recursive: true })

  const date     = new Date().toISOString().slice(0, 10)
  const filename = path.join(backupPath, `devbrain-backup-${date}.zip`)
  const output   = fs.createWriteStream(filename)

  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    buildZipToStream(archive, 'all').catch(reject)
  })

  await pruneOldBackups(backupPath, keepLastN)
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
    await runBackup(cfg.path, cfg.retention_count ?? DEFAULT_BACKUP_RETENTION_COUNT)
    await writeLastBackupAt(new Date().toISOString())
    console.log(`  backup: scheduled backup written to ${cfg.path}`)
  } catch (err) {
    console.error('  backup: scheduled backup failed:', (err as Error).message)
  }
}

export async function triggerBackupNow(backupPath: string, keepLastN: number = DEFAULT_BACKUP_RETENTION_COUNT): Promise<void> {
  await runBackup(backupPath, keepLastN)
  await writeLastBackupAt(new Date().toISOString())
}

export function startBackupScheduler(): void {
  // Run once after 30 s delay (let DB settle on startup), then every hour
  setTimeout(() => {
    maybeRunBackup().catch(() => {})
    setInterval(() => { maybeRunBackup().catch(() => {}) }, 60 * 60 * 1000)
  }, 30_000)
}

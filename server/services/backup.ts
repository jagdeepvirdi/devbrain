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
import { decrypt } from './crypto.js'
import { uploadBackupToRemote, pruneRemoteBackups, type RemoteConfig } from './remoteBackup.js'

type BackupSchedule = 'daily' | 'weekly' | 'off'

interface BackupSettings {
  path:            string | null
  schedule:        BackupSchedule
  last_backup_at:  string | null
  retention_count: number | null
  remote:          unknown // stored shape has *Enc secret fields — see resolveRemoteConfig()
}

export const DEFAULT_BACKUP_RETENTION_COUNT = 30

async function readConfig(): Promise<BackupSettings> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'backup_settings'`,
  )
  return (rows[0]?.value as BackupSettings) ?? { path: null, schedule: 'off', last_backup_at: null, retention_count: null, remote: null }
}

// Turns the stored (encrypted-secret) remote shape into the plaintext
// RemoteConfig the upload/prune/test functions in remoteBackup.ts expect.
export function resolveRemoteConfig(raw: unknown): RemoteConfig {
  const r = (raw ?? { type: 'none' }) as Record<string, unknown>
  if (r.type === 's3') {
    return {
      type:            's3',
      endpoint:        (r.endpoint as string | null) ?? undefined,
      region:          (r.region as string | null) ?? undefined,
      bucket:          r.bucket as string,
      prefix:          (r.prefix as string | null) ?? undefined,
      accessKeyId:     r.accessKeyId as string,
      secretAccessKey: r.secretAccessKeyEnc ? decrypt(r.secretAccessKeyEnc as string) : '',
      forcePathStyle:  !!r.forcePathStyle,
    }
  }
  if (r.type === 'sftp') {
    return {
      type:        'sftp',
      host:        r.host as string,
      port:        (r.port as number | null) ?? undefined,
      username:    r.username as string,
      remotePath:  r.remotePath as string,
      password:    r.passwordEnc   ? decrypt(r.passwordEnc as string)   : undefined,
      privateKey:  r.privateKeyEnc ? decrypt(r.privateKeyEnc as string) : undefined,
    }
  }
  return { type: 'none' }
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

async function writeRemoteBackupSuccess(ts: string): Promise<void> {
  await pool.query(
    `UPDATE app_settings
       SET value = jsonb_set(jsonb_set(value, '{last_remote_backup_at}', $1::jsonb), '{last_remote_backup_error}', 'null'::jsonb),
           updated_at = now()
     WHERE key = 'backup_settings'`,
    [JSON.stringify(ts)],
  )
}

async function writeRemoteBackupError(message: string): Promise<void> {
  await pool.query(
    `UPDATE app_settings
       SET value = jsonb_set(value, '{last_remote_backup_error}', $1::jsonb), updated_at = now()
     WHERE key = 'backup_settings'`,
    [JSON.stringify(message)],
  )
}

// Best-effort remote mirror of the local backup that was just written —
// failures here are logged and recorded but never bubble up, since the local
// backup (the primary safety net) already succeeded by the time this runs.
async function handleRemote(localFilePath: string, keepLastN: number, remote: RemoteConfig): Promise<void> {
  if (remote.type === 'none') return
  try {
    const filename = path.basename(localFilePath)
    await uploadBackupToRemote(localFilePath, filename, remote)
    await pruneRemoteBackups(remote, keepLastN)
    await writeRemoteBackupSuccess(new Date().toISOString())
  } catch (err) {
    console.error('  backup: remote upload failed:', (err as Error).message)
    await writeRemoteBackupError((err as Error).message).catch(() => {})
  }
}

async function runBackup(backupPath: string, keepLastN: number): Promise<string> {
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
  return filename
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

  const keepLastN = cfg.retention_count ?? DEFAULT_BACKUP_RETENTION_COUNT

  try {
    const filePath = await runBackup(cfg.path, keepLastN)
    await writeLastBackupAt(new Date().toISOString())
    console.log(`  backup: scheduled backup written to ${cfg.path}`)
    await handleRemote(filePath, keepLastN, resolveRemoteConfig(cfg.remote))
  } catch (err) {
    console.error('  backup: scheduled backup failed:', (err as Error).message)
  }
}

export async function triggerBackupNow(
  backupPath: string,
  keepLastN: number = DEFAULT_BACKUP_RETENTION_COUNT,
  remote: RemoteConfig = { type: 'none' },
): Promise<void> {
  const filePath = await runBackup(backupPath, keepLastN)
  await writeLastBackupAt(new Date().toISOString())
  await handleRemote(filePath, keepLastN, remote)
}

export function startBackupScheduler(): void {
  // Run once after 30 s delay (let DB settle on startup), then every hour
  setTimeout(() => {
    maybeRunBackup().catch(() => {})
    setInterval(() => { maybeRunBackup().catch(() => {}) }, 60 * 60 * 1000)
  }, 30_000)
}

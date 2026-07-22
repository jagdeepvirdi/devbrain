import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs   from 'fs'
import os   from 'os'
import path from 'path'
import type { Archiver } from 'archiver'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const buildZipToStreamMock = vi.fn(async (archive: Archiver, _projectIds: string[] | 'all') => {
  archive.append('hello world', { name: 'test.txt' })
  await archive.finalize()
})

vi.mock('../../services/exporter.js', () => ({
  buildZipToStream: (archive: Archiver, projectIds: string[] | 'all') => buildZipToStreamMock(archive, projectIds),
}))

vi.mock('../../services/crypto.js', () => ({
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

const uploadBackupToRemoteMock = vi.fn()
const pruneRemoteBackupsMock   = vi.fn()

vi.mock('../../services/remoteBackup.js', () => ({
  uploadBackupToRemote: (...args: unknown[]) => uploadBackupToRemoteMock(...args),
  pruneRemoteBackups:   (...args: unknown[]) => pruneRemoteBackupsMock(...args),
}))

const { triggerBackupNow, startBackupScheduler, pruneOldBackups, resolveRemoteConfig } = await import('../../services/backup.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

describe('backup service', () => {
  let tmpRoot: string

  beforeEach(async () => {
    vi.clearAllMocks()
    buildZipToStreamMock.mockClear()
    tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'devbrain-backup-test-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    try {
      // Windows may briefly hold a file handle open from a dangling write
      // stream in the failure-path tests below; retry rather than fail.
      await fs.promises.rm(tmpRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // best-effort cleanup
    }
  })

  describe('triggerBackupNow', () => {
    it('creates the backup directory, writes a zip archive, and records last_backup_at', async () => {
      const backupDir = path.join(tmpRoot, 'nested', 'backups')
      mockQuery.mockResolvedValue({ rows: [] } as never)

      await triggerBackupNow(backupDir)

      const files = await fs.promises.readdir(backupDir)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^devbrain-backup-\d{4}-\d{2}-\d{2}\.zip$/)

      const stat = await fs.promises.stat(path.join(backupDir, files[0]))
      expect(stat.size).toBeGreaterThan(0)

      expect(buildZipToStreamMock).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock.mock.calls[0][1]).toBe('all')

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0]).toMatch(/UPDATE app_settings/)
    })

    it('rejects when the archive build fails', async () => {
      buildZipToStreamMock.mockRejectedValueOnce(new Error('export exploded'))

      await expect(triggerBackupNow(path.join(tmpRoot, 'fails'))).rejects.toThrow('export exploded')
      // last_backup_at is only written after runBackup resolves successfully
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe('startBackupScheduler / maybeRunBackup', () => {
    it('does nothing when reading settings fails (DB not ready)', async () => {
      vi.useFakeTimers()
      mockQuery.mockRejectedValueOnce(new Error('DB not ready'))

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock).not.toHaveBeenCalled()
    })

    it('does nothing when no backup_settings row exists yet', async () => {
      vi.useFakeTimers()
      mockQuery.mockResolvedValueOnce({ rows: [] } as never)

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock).not.toHaveBeenCalled()
    })

    it('does nothing when schedule is off', async () => {
      vi.useFakeTimers()
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: tmpRoot, schedule: 'off', last_backup_at: null } }] } as never)

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock).not.toHaveBeenCalled()
    })

    it('does nothing when no backup path is configured', async () => {
      vi.useFakeTimers()
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: null, schedule: 'daily', last_backup_at: null } }] } as never)

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock).not.toHaveBeenCalled()
    })

    it('skips when the last backup is still within the schedule threshold', async () => {
      vi.useFakeTimers()
      const recent = new Date(Date.now() - 60_000).toISOString() // 1 minute ago, daily threshold is 24h
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: tmpRoot, schedule: 'daily', last_backup_at: recent } }] } as never)

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(buildZipToStreamMock).not.toHaveBeenCalled()
    })

    it('runs a backup and records last_backup_at once the threshold has elapsed', async () => {
      vi.useFakeTimers()
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: tmpRoot, schedule: 'daily', last_backup_at: null } }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never) // the writeLastBackupAt UPDATE

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      startBackupScheduler()
      // The 30s initial delay is a fake timer; the zip write underneath it is
      // real fs/archiver I/O, which fake timers don't control — switch back
      // to real timers to let that finish, then poll for it.
      await vi.advanceTimersByTimeAsync(30_000)
      vi.useRealTimers()

      await vi.waitFor(() => {
        expect(mockQuery).toHaveBeenCalledTimes(2)
      }, { timeout: 3000, interval: 10 })

      expect(buildZipToStreamMock).toHaveBeenCalledTimes(1)
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('scheduled backup written to'))

      logSpy.mockRestore()
    })

    it('logs an error when the scheduled backup fails', async () => {
      vi.useFakeTimers()
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: tmpRoot, schedule: 'daily', last_backup_at: null } }] } as never)
      buildZipToStreamMock.mockRejectedValueOnce(new Error('disk full'))

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)
      vi.useRealTimers()

      await vi.waitFor(() => {
        expect(errSpy).toHaveBeenCalled()
      }, { timeout: 3000, interval: 10 })

      expect(errSpy).toHaveBeenCalledWith('  backup: scheduled backup failed:', 'disk full')
      // last_backup_at is not written when the backup itself failed
      expect(mockQuery).toHaveBeenCalledTimes(1)

      errSpy.mockRestore()
    })
  })

  describe('pruneOldBackups', () => {
    async function makeBackupFile(dir: string, date: string) {
      await fs.promises.mkdir(dir, { recursive: true })
      await fs.promises.writeFile(path.join(dir, `devbrain-backup-${date}.zip`), 'zip')
    }

    it('deletes the oldest dated backups beyond keepLastN', async () => {
      for (const date of ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']) {
        await makeBackupFile(tmpRoot, date)
      }

      await pruneOldBackups(tmpRoot, 2)

      const remaining = (await fs.promises.readdir(tmpRoot)).sort()
      expect(remaining).toEqual(['devbrain-backup-2026-01-03.zip', 'devbrain-backup-2026-01-04.zip'])
    })

    it('does nothing when the count is already within keepLastN', async () => {
      await makeBackupFile(tmpRoot, '2026-01-01')

      await pruneOldBackups(tmpRoot, 2)

      expect(await fs.promises.readdir(tmpRoot)).toHaveLength(1)
    })

    it('ignores files that do not match the dated backup filename pattern', async () => {
      await makeBackupFile(tmpRoot, '2026-01-01')
      await fs.promises.writeFile(path.join(tmpRoot, 'notes.txt'), 'unrelated')

      // keepLastN=1 with exactly 1 matching backup file means no deletion is
      // due — proves notes.txt was never counted as a backup to begin with.
      await pruneOldBackups(tmpRoot, 1)

      expect((await fs.promises.readdir(tmpRoot)).sort()).toEqual(['devbrain-backup-2026-01-01.zip', 'notes.txt'])
    })

    it('treats a zero or negative keepLastN as "no limit" rather than deleting everything', async () => {
      await makeBackupFile(tmpRoot, '2026-01-01')
      await makeBackupFile(tmpRoot, '2026-01-02')

      await pruneOldBackups(tmpRoot, 0)
      await pruneOldBackups(tmpRoot, -1)

      expect(await fs.promises.readdir(tmpRoot)).toHaveLength(2)
    })

    it('returns without throwing when the backup directory does not exist', async () => {
      await expect(pruneOldBackups(path.join(tmpRoot, 'missing'), 2)).resolves.toBeUndefined()
    })

    it('logs and continues when deleting one file fails', async () => {
      await makeBackupFile(tmpRoot, '2026-01-01')
      await makeBackupFile(tmpRoot, '2026-01-02')
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const unlinkSpy = vi.spyOn(fs.promises, 'unlink').mockRejectedValueOnce(new Error('locked'))

      await pruneOldBackups(tmpRoot, 1)

      expect(errSpy).toHaveBeenCalledWith(
        '  backup: failed to prune devbrain-backup-2026-01-01.zip:',
        'locked',
      )

      unlinkSpy.mockRestore()
      errSpy.mockRestore()
    })
  })

  describe('triggerBackupNow retention integration', () => {
    it('prunes pre-existing old backups down to the requested retention count', async () => {
      const backupDir = tmpRoot
      for (const date of ['2020-01-01', '2020-01-02']) {
        await fs.promises.writeFile(path.join(backupDir, `devbrain-backup-${date}.zip`), 'zip')
      }
      mockQuery.mockResolvedValue({ rows: [] } as never)

      await triggerBackupNow(backupDir, 2)

      const remaining = (await fs.promises.readdir(backupDir)).sort()
      // The 2 oldest fixtures plus today's fresh write exceed keepLastN=2,
      // so the single oldest fixture should have been pruned.
      expect(remaining).toHaveLength(2)
      expect(remaining).not.toContain('devbrain-backup-2020-01-01.zip')
    })
  })

  describe('resolveRemoteConfig', () => {
    it('resolves null/undefined to type "none"', () => {
      expect(resolveRemoteConfig(null)).toEqual({ type: 'none' })
      expect(resolveRemoteConfig(undefined)).toEqual({ type: 'none' })
    })

    it('passes an explicit "none" through unchanged', () => {
      expect(resolveRemoteConfig({ type: 'none' })).toEqual({ type: 'none' })
    })

    it('decrypts a stored S3 secret access key', () => {
      const resolved = resolveRemoteConfig({
        type: 's3', bucket: 'b', accessKeyId: 'AKIA123', secretAccessKeyEnc: 'enc:shh', region: 'us-east-1', forcePathStyle: true,
      })
      expect(resolved).toEqual({
        type: 's3', endpoint: undefined, region: 'us-east-1', bucket: 'b', prefix: undefined,
        accessKeyId: 'AKIA123', secretAccessKey: 'shh', forcePathStyle: true,
      })
    })

    it('defaults an S3 config with no stored secret to an empty string', () => {
      const resolved = resolveRemoteConfig({ type: 's3', bucket: 'b', accessKeyId: 'AKIA123' })
      expect(resolved).toMatchObject({ type: 's3', secretAccessKey: '' })
    })

    it('decrypts a stored SFTP password and private key', () => {
      const resolved = resolveRemoteConfig({
        type: 'sftp', host: 'h', username: 'u', remotePath: '/r', passwordEnc: 'enc:pw', privateKeyEnc: 'enc:key',
      })
      expect(resolved).toEqual({ type: 'sftp', host: 'h', port: undefined, username: 'u', remotePath: '/r', password: 'pw', privateKey: 'key' })
    })

    it('leaves SFTP password/private key undefined when none are stored', () => {
      const resolved = resolveRemoteConfig({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' })
      expect(resolved).toMatchObject({ password: undefined, privateKey: undefined })
    })
  })

  describe('triggerBackupNow remote handling', () => {
    it('does not attempt a remote upload when remote is type "none"', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never)
      await triggerBackupNow(tmpRoot, 30, { type: 'none' })
      expect(uploadBackupToRemoteMock).not.toHaveBeenCalled()
      expect(pruneRemoteBackupsMock).not.toHaveBeenCalled()
    })

    it('uploads and prunes remotely, then records last_remote_backup_at, when a remote is configured', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never)
      const remote = { type: 's3' as const, bucket: 'b', accessKeyId: 'AKIA123', secretAccessKey: 'shh' }

      await triggerBackupNow(tmpRoot, 5, remote)

      expect(uploadBackupToRemoteMock).toHaveBeenCalledWith(
        expect.stringContaining('devbrain-backup-'), expect.stringMatching(/^devbrain-backup-\d{4}-\d{2}-\d{2}\.zip$/), remote,
      )
      expect(pruneRemoteBackupsMock).toHaveBeenCalledWith(remote, 5)
      const remoteStatusCall = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('last_remote_backup_at'))
      expect(remoteStatusCall).toBeDefined()
    })

    it('logs and records the error, without throwing, when the remote upload fails', async () => {
      mockQuery.mockResolvedValue({ rows: [] } as never)
      uploadBackupToRemoteMock.mockRejectedValueOnce(new Error('network unreachable'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const remote = { type: 'sftp' as const, host: 'h', username: 'u', remotePath: '/r' }

      await expect(triggerBackupNow(tmpRoot, 30, remote)).resolves.toBeUndefined()

      expect(errSpy).toHaveBeenCalledWith('  backup: remote upload failed:', 'network unreachable')
      const errorStatusCall = mockQuery.mock.calls.find(([sql]) => (sql as string).includes('last_remote_backup_error'))
      expect(errorStatusCall).toBeDefined()
      // A failed remote upload must not also attempt to prune the remote side.
      expect(pruneRemoteBackupsMock).not.toHaveBeenCalled()

      errSpy.mockRestore()
    })
  })

  describe('scheduled backup remote handling', () => {
    it('resolves and uploads to the configured remote after a successful scheduled run', async () => {
      vi.useFakeTimers()
      const rawRemote = { type: 's3', bucket: 'b', accessKeyId: 'AKIA123', secretAccessKeyEnc: 'enc:shh' }
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: tmpRoot, schedule: 'daily', last_backup_at: null, remote: rawRemote } }] } as never)
      mockQuery.mockResolvedValue({ rows: [] } as never) // writeLastBackupAt / writeRemoteBackupSuccess

      startBackupScheduler()
      await vi.advanceTimersByTimeAsync(30_000)
      vi.useRealTimers()

      await vi.waitFor(() => {
        expect(uploadBackupToRemoteMock).toHaveBeenCalled()
      }, { timeout: 3000, interval: 10 })

      expect(uploadBackupToRemoteMock.mock.calls[0][2]).toEqual({ type: 's3', bucket: 'b', accessKeyId: 'AKIA123', secretAccessKey: 'shh', endpoint: undefined, region: undefined, prefix: undefined, forcePathStyle: false })
      expect(pruneRemoteBackupsMock).toHaveBeenCalled()
    })
  })
})

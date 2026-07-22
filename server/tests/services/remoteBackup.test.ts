import { describe, it, expect, vi, beforeEach } from 'vitest'
import os   from 'os'
import path from 'path'
import fs   from 'fs'

const s3Send = vi.fn()

vi.mock('@aws-sdk/client-s3', () => {
  class S3Client { send = s3Send }
  class PutObjectCommand { input: unknown; constructor(input: unknown) { this.input = input } }
  class ListObjectsV2Command { input: unknown; constructor(input: unknown) { this.input = input } }
  class DeleteObjectCommand { input: unknown; constructor(input: unknown) { this.input = input } }
  class HeadBucketCommand { input: unknown; constructor(input: unknown) { this.input = input } }
  return { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadBucketCommand }
})

const sftpMock = {
  connect: vi.fn(),
  mkdir:   vi.fn(),
  put:     vi.fn(),
  list:    vi.fn(),
  delete:  vi.fn(),
  end:     vi.fn(),
}

vi.mock('ssh2-sftp-client', () => ({
  default: vi.fn().mockImplementation(function SftpClientMock() { return sftpMock }),
}))

const { uploadBackupToRemote, pruneRemoteBackups, testRemoteConnection } = await import('../../services/remoteBackup.js')

describe('remoteBackup service', () => {
  let tmpFile: string

  beforeEach(async () => {
    vi.clearAllMocks()
    sftpMock.connect.mockResolvedValue(undefined)
    sftpMock.mkdir.mockResolvedValue(undefined)
    sftpMock.put.mockResolvedValue(undefined)
    sftpMock.list.mockResolvedValue([])
    sftpMock.delete.mockResolvedValue(undefined)
    sftpMock.end.mockResolvedValue(undefined)

    const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'devbrain-remote-backup-test-'))
    tmpFile = path.join(tmpDir, 'devbrain-backup-2026-01-05.zip')
    await fs.promises.writeFile(tmpFile, 'zip-bytes')
  })

  describe('uploadBackupToRemote', () => {
    it('does nothing for type "none"', async () => {
      await uploadBackupToRemote(tmpFile, 'devbrain-backup-2026-01-05.zip', { type: 'none' })
      expect(s3Send).not.toHaveBeenCalled()
      expect(sftpMock.connect).not.toHaveBeenCalled()
    })

    it('uploads to S3 with the bucket/prefix-joined key', async () => {
      s3Send.mockResolvedValueOnce({})
      await uploadBackupToRemote(tmpFile, 'devbrain-backup-2026-01-05.zip', {
        type: 's3', bucket: 'my-bucket', prefix: 'backups', accessKeyId: 'AKIA', secretAccessKey: 'shh',
      })
      expect(s3Send).toHaveBeenCalledTimes(1)
      const cmd = s3Send.mock.calls[0][0] as { input: { Bucket: string; Key: string; Body: Buffer } }
      expect(cmd.input.Bucket).toBe('my-bucket')
      expect(cmd.input.Key).toBe('backups/devbrain-backup-2026-01-05.zip')
      expect(cmd.input.Body.toString()).toBe('zip-bytes')
    })

    it('uploads to S3 with no prefix when unset', async () => {
      s3Send.mockResolvedValueOnce({})
      await uploadBackupToRemote(tmpFile, 'devbrain-backup-2026-01-05.zip', {
        type: 's3', bucket: 'my-bucket', accessKeyId: 'AKIA', secretAccessKey: 'shh',
      })
      const cmd = s3Send.mock.calls[0][0] as { input: { Key: string } }
      expect(cmd.input.Key).toBe('devbrain-backup-2026-01-05.zip')
    })

    it('uploads over SFTP, creating the remote directory first', async () => {
      await uploadBackupToRemote(tmpFile, 'devbrain-backup-2026-01-05.zip', {
        type: 'sftp', host: 'h', username: 'u', remotePath: '/remote/backups/',
      })
      expect(sftpMock.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'h', port: 22, username: 'u' }))
      expect(sftpMock.mkdir).toHaveBeenCalledWith('/remote/backups', true)
      expect(sftpMock.put).toHaveBeenCalledWith(tmpFile, '/remote/backups/devbrain-backup-2026-01-05.zip')
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('still closes the SFTP connection when the upload fails', async () => {
      sftpMock.put.mockRejectedValueOnce(new Error('upload failed'))
      await expect(uploadBackupToRemote(tmpFile, 'f.zip', {
        type: 'sftp', host: 'h', username: 'u', remotePath: '/r',
      })).rejects.toThrow('upload failed')
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('swallows an error from closing the SFTP connection itself', async () => {
      sftpMock.end.mockRejectedValueOnce(new Error('already closed'))
      await expect(uploadBackupToRemote(tmpFile, 'f.zip', {
        type: 'sftp', host: 'h', username: 'u', remotePath: '/r',
      })).resolves.toBeUndefined()
    })

    it('tolerates mkdir failing because the directory already exists', async () => {
      sftpMock.mkdir.mockRejectedValueOnce(new Error('already exists'))
      await uploadBackupToRemote(tmpFile, 'f.zip', { type: 'sftp', host: 'h', username: 'u', remotePath: '/r' })
      expect(sftpMock.put).toHaveBeenCalled()
    })
  })

  describe('pruneRemoteBackups', () => {
    it('does nothing for type "none"', async () => {
      await pruneRemoteBackups({ type: 'none' }, 2)
      expect(s3Send).not.toHaveBeenCalled()
    })

    it('treats a zero or negative keepLastN as "no limit"', async () => {
      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 0)
      expect(s3Send).not.toHaveBeenCalled()
    })

    it('deletes the oldest S3 objects beyond keepLastN', async () => {
      s3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'devbrain-backup-2026-01-01.zip' },
          { Key: 'devbrain-backup-2026-01-02.zip' },
          { Key: 'devbrain-backup-2026-01-03.zip' },
          { Key: 'not-a-backup.txt' },
        ],
      })
      s3Send.mockResolvedValue({}) // subsequent delete calls

      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 1)

      const deleteKeys = s3Send.mock.calls.slice(1).map(([cmd]) => (cmd as { input: { Key: string } }).input.Key)
      expect(deleteKeys.sort()).toEqual(['devbrain-backup-2026-01-01.zip', 'devbrain-backup-2026-01-02.zip'])
    })

    it('treats a missing Contents field (empty bucket/prefix) as no objects to prune', async () => {
      s3Send.mockResolvedValueOnce({}) // no Contents key at all

      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 1)

      expect(s3Send).toHaveBeenCalledTimes(1) // only the list call, no deletes
    })

    it('does nothing when the S3 object count is already within keepLastN', async () => {
      s3Send.mockResolvedValueOnce({ Contents: [{ Key: 'devbrain-backup-2026-01-01.zip' }] })

      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 5)

      expect(s3Send).toHaveBeenCalledTimes(1) // only the list call, no deletes
    })

    it('tolerates an S3 listing entry with no Key', async () => {
      s3Send.mockResolvedValueOnce({ Contents: [{ Key: undefined }, { Key: 'devbrain-backup-2026-01-01.zip' }] })

      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 5)

      expect(s3Send).toHaveBeenCalledTimes(1) // 1 real backup within limit, the keyless entry never matches the filename pattern
    })

    it('respects the prefix when listing and pruning S3 objects', async () => {
      s3Send.mockResolvedValueOnce({
        Contents: [
          { Key: 'backups/devbrain-backup-2026-01-01.zip' },
          { Key: 'backups/devbrain-backup-2026-01-02.zip' },
        ],
      })
      s3Send.mockResolvedValue({})

      await pruneRemoteBackups({ type: 's3', bucket: 'b', prefix: 'backups', accessKeyId: 'a', secretAccessKey: 's' }, 1)

      const listCmd = s3Send.mock.calls[0][0] as { input: { Prefix: string } }
      expect(listCmd.input.Prefix).toBe('backups/')
      const deleteCmd = s3Send.mock.calls[1][0] as { input: { Key: string } }
      expect(deleteCmd.input.Key).toBe('backups/devbrain-backup-2026-01-01.zip')
    })

    it('logs and continues when an S3 delete fails', async () => {
      s3Send.mockResolvedValueOnce({ Contents: [{ Key: 'devbrain-backup-2026-01-01.zip' }, { Key: 'devbrain-backup-2026-01-02.zip' }] })
      s3Send.mockRejectedValueOnce(new Error('access denied'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await pruneRemoteBackups({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' }, 1)

      expect(errSpy).toHaveBeenCalledWith('  backup: failed to prune remote devbrain-backup-2026-01-01.zip:', 'access denied')
      errSpy.mockRestore()
    })

    it('does nothing when the SFTP file count is already within keepLastN', async () => {
      sftpMock.list.mockResolvedValueOnce([{ name: 'devbrain-backup-2026-01-01.zip' }])

      await pruneRemoteBackups({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' }, 5)

      expect(sftpMock.delete).not.toHaveBeenCalled()
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('deletes the oldest SFTP files beyond keepLastN', async () => {
      sftpMock.list.mockResolvedValueOnce([
        { name: 'devbrain-backup-2026-01-01.zip' },
        { name: 'devbrain-backup-2026-01-02.zip' },
        { name: 'notes.txt' },
      ])

      await pruneRemoteBackups({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' }, 1)

      expect(sftpMock.delete).toHaveBeenCalledTimes(1)
      expect(sftpMock.delete).toHaveBeenCalledWith('/r/devbrain-backup-2026-01-01.zip')
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('logs and continues when an SFTP delete fails', async () => {
      sftpMock.list.mockResolvedValueOnce([{ name: 'devbrain-backup-2026-01-01.zip' }, { name: 'devbrain-backup-2026-01-02.zip' }])
      sftpMock.delete.mockRejectedValueOnce(new Error('permission denied'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      await pruneRemoteBackups({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' }, 1)

      expect(errSpy).toHaveBeenCalledWith('  backup: failed to prune remote devbrain-backup-2026-01-01.zip:', 'permission denied')
      errSpy.mockRestore()
    })

    it('swallows an error from closing the SFTP connection itself', async () => {
      sftpMock.list.mockResolvedValueOnce([{ name: 'devbrain-backup-2026-01-01.zip' }])
      sftpMock.end.mockRejectedValueOnce(new Error('already closed'))
      await expect(pruneRemoteBackups({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' }, 5)).resolves.toBeUndefined()
    })
  })

  describe('testRemoteConnection', () => {
    it('throws for type "none"', async () => {
      await expect(testRemoteConnection({ type: 'none' })).rejects.toThrow('No remote destination selected')
    })

    it('calls HeadBucket for an S3 config', async () => {
      s3Send.mockResolvedValueOnce({})
      await testRemoteConnection({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' })
      const cmd = s3Send.mock.calls[0][0] as { input: { Bucket: string } }
      expect(cmd.input.Bucket).toBe('b')
    })

    it('propagates an S3 connection failure', async () => {
      s3Send.mockRejectedValueOnce(new Error('bucket not found'))
      await expect(testRemoteConnection({ type: 's3', bucket: 'b', accessKeyId: 'a', secretAccessKey: 's' })).rejects.toThrow('bucket not found')
    })

    it('connects and disconnects for an SFTP config', async () => {
      await testRemoteConnection({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' })
      expect(sftpMock.connect).toHaveBeenCalled()
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('still disconnects when the SFTP connection attempt fails', async () => {
      sftpMock.connect.mockRejectedValueOnce(new Error('auth failed'))
      await expect(testRemoteConnection({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' })).rejects.toThrow('auth failed')
      expect(sftpMock.end).toHaveBeenCalled()
    })

    it('swallows an error from closing the SFTP connection itself', async () => {
      sftpMock.end.mockRejectedValueOnce(new Error('already closed'))
      await expect(testRemoteConnection({ type: 'sftp', host: 'h', username: 'u', remotePath: '/r' })).resolves.toBeUndefined()
    })
  })
})

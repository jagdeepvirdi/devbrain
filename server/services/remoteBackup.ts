import fs from 'fs'
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import SftpClient from 'ssh2-sftp-client'

export interface S3RemoteConfig {
  type:             's3'
  endpoint?:        string
  region?:          string
  bucket:           string
  prefix?:          string
  accessKeyId:      string
  secretAccessKey:  string
  forcePathStyle?:  boolean
}

export interface SftpRemoteConfig {
  type:        'sftp'
  host:        string
  port?:       number
  username:    string
  remotePath:  string
  password?:   string
  privateKey?: string
}

export type RemoteConfig = { type: 'none' } | S3RemoteConfig | SftpRemoteConfig

const BACKUP_FILENAME_RE = /^devbrain-backup-\d{4}-\d{2}-\d{2}\.zip$/

function s3Client(cfg: S3RemoteConfig): S3Client {
  return new S3Client({
    region:         cfg.region || 'us-east-1',
    endpoint:       cfg.endpoint || undefined,
    forcePathStyle: !!cfg.forcePathStyle,
    credentials:    { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })
}

function s3Prefix(cfg: S3RemoteConfig): string {
  return cfg.prefix ? cfg.prefix.replace(/\/+$/, '') + '/' : ''
}

function sftpConnectOptions(cfg: SftpRemoteConfig) {
  return {
    host:       cfg.host,
    port:       cfg.port || 22,
    username:   cfg.username,
    password:   cfg.password || undefined,
    privateKey: cfg.privateKey || undefined,
  }
}

function sftpRemoteDir(cfg: SftpRemoteConfig): string {
  return cfg.remotePath.replace(/\/+$/, '')
}

// Uploads the already-written local zip to the configured remote destination.
// A no-op for `{ type: 'none' }` — callers decide whether to invoke this at
// all, but it's also safe to call unconditionally.
export async function uploadBackupToRemote(localFilePath: string, filename: string, remote: RemoteConfig): Promise<void> {
  if (remote.type === 'none') return

  if (remote.type === 's3') {
    const client = s3Client(remote)
    const body   = await fs.promises.readFile(localFilePath)
    await client.send(new PutObjectCommand({ Bucket: remote.bucket, Key: `${s3Prefix(remote)}${filename}`, Body: body }))
    return
  }

  const sftp = new SftpClient()
  try {
    await sftp.connect(sftpConnectOptions(remote))
    const dir = sftpRemoteDir(remote)
    await sftp.mkdir(dir, true).catch(() => {}) // best-effort — dir may already exist
    await sftp.put(localFilePath, `${dir}/${filename}`)
  } finally {
    await sftp.end().catch(() => {})
  }
}

// Mirrors pruneOldBackups()'s local retention policy on the remote side —
// otherwise the remote store grows unbounded the same way the local
// directory used to before that fix.
export async function pruneRemoteBackups(remote: RemoteConfig, keepLastN: number): Promise<void> {
  if (remote.type === 'none' || keepLastN <= 0) return

  if (remote.type === 's3') {
    const client = s3Client(remote)
    const prefix = s3Prefix(remote)
    const { Contents } = await client.send(new ListObjectsV2Command({ Bucket: remote.bucket, Prefix: prefix }))
    const keys = (Contents ?? [])
      .map(o => o.Key ?? '')
      .filter(key => BACKUP_FILENAME_RE.test(key.slice(prefix.length)))
      .sort()
    const excess = keys.length - keepLastN
    if (excess <= 0) return
    await Promise.all(
      keys.slice(0, excess).map(Key =>
        client.send(new DeleteObjectCommand({ Bucket: remote.bucket, Key })).catch(err => {
          console.error(`  backup: failed to prune remote ${Key}:`, (err as Error).message)
        }),
      ),
    )
    return
  }

  const sftp = new SftpClient()
  try {
    await sftp.connect(sftpConnectOptions(remote))
    const dir  = sftpRemoteDir(remote)
    const list = await sftp.list(dir)
    const names = list.map(f => f.name).filter(name => BACKUP_FILENAME_RE.test(name)).sort()
    const excess = names.length - keepLastN
    if (excess <= 0) return
    for (const name of names.slice(0, excess)) {
      try {
        await sftp.delete(`${dir}/${name}`)
      } catch (err) {
        console.error(`  backup: failed to prune remote ${name}:`, (err as Error).message)
      }
    }
  } finally {
    await sftp.end().catch(() => {})
  }
}

// Verifies the destination is reachable with the given credentials, without
// uploading anything — used by the Settings UI's "Test connection" button.
export async function testRemoteConnection(remote: RemoteConfig): Promise<void> {
  if (remote.type === 'none') throw new Error('No remote destination selected')

  if (remote.type === 's3') {
    const client = s3Client(remote)
    await client.send(new HeadBucketCommand({ Bucket: remote.bucket }))
    return
  }

  const sftp = new SftpClient()
  try {
    await sftp.connect(sftpConnectOptions(remote))
  } finally {
    await sftp.end().catch(() => {})
  }
}

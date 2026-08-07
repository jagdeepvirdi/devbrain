import { useState, useEffect } from 'react'
import { settingsApi, type BackupConfig, type RemoteBackupConfigInput } from '../../lib/api'
import { useToast } from '../Toast'

type RemoteType = 'none' | 's3' | 'sftp'

export function ScheduledBackupSection() {
  const { toast } = useToast()
  const [cfg,     setCfg]     = useState<BackupConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [running, setRunning] = useState(false)
  const [testing, setTesting] = useState(false)
  const [path,    setPath]    = useState('')
  const [schedule, setSchedule] = useState<BackupConfig['schedule']>('off')
  const [retentionCount, setRetentionCount] = useState(30)

  const [remoteType, setRemoteType] = useState<RemoteType>('none')
  const [hasSecretAccessKey, setHasSecretAccessKey] = useState(false)
  const [hasPassword,        setHasPassword]        = useState(false)
  const [hasPrivateKey,      setHasPrivateKey]       = useState(false)
  // S3 fields
  const [s3Endpoint, setS3Endpoint] = useState('')
  const [s3Region,   setS3Region]   = useState('')
  const [s3Bucket,   setS3Bucket]   = useState('')
  const [s3Prefix,   setS3Prefix]   = useState('')
  const [s3AccessKeyId, setS3AccessKeyId] = useState('')
  const [s3SecretAccessKey, setS3SecretAccessKey] = useState('')
  const [s3ForcePathStyle, setS3ForcePathStyle] = useState(false)
  // SFTP fields
  const [sftpHost, setSftpHost] = useState('')
  const [sftpPort, setSftpPort] = useState('')
  const [sftpUsername, setSftpUsername] = useState('')
  const [sftpRemotePath, setSftpRemotePath] = useState('')
  const [sftpPassword, setSftpPassword] = useState('')
  const [sftpPrivateKey, setSftpPrivateKey] = useState('')

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 8px', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }
  const lbl: React.CSSProperties = { fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }

  useEffect(() => {
    settingsApi.getBackupConfig()
      .then(c => {
        setCfg(c); setPath(c.path ?? ''); setSchedule(c.schedule); setRetentionCount(c.retention_count)
        setRemoteType(c.remote.type)
        if (c.remote.type === 's3') {
          setS3Endpoint(c.remote.endpoint ?? '')
          setS3Region(c.remote.region ?? '')
          setS3Bucket(c.remote.bucket)
          setS3Prefix(c.remote.prefix ?? '')
          setS3AccessKeyId(c.remote.accessKeyId)
          setS3ForcePathStyle(c.remote.forcePathStyle)
          setHasSecretAccessKey(c.remote.hasSecretAccessKey)
        } else if (c.remote.type === 'sftp') {
          setSftpHost(c.remote.host)
          setSftpPort(c.remote.port != null ? String(c.remote.port) : '')
          setSftpUsername(c.remote.username)
          setSftpRemotePath(c.remote.remotePath)
          setHasPassword(c.remote.hasPassword)
          setHasPrivateKey(c.remote.hasPrivateKey)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function buildRemoteInput(): RemoteBackupConfigInput {
    if (remoteType === 's3') {
      return {
        type: 's3',
        endpoint: s3Endpoint || null,
        region: s3Region || null,
        bucket: s3Bucket,
        prefix: s3Prefix || null,
        accessKeyId: s3AccessKeyId,
        ...(s3SecretAccessKey ? { secretAccessKey: s3SecretAccessKey } : {}),
        forcePathStyle: s3ForcePathStyle,
      }
    }
    if (remoteType === 'sftp') {
      return {
        type: 'sftp',
        host: sftpHost,
        port: sftpPort ? Number(sftpPort) : null,
        username: sftpUsername,
        remotePath: sftpRemotePath,
        ...(sftpPassword ? { password: sftpPassword } : {}),
        ...(sftpPrivateKey ? { privateKey: sftpPrivateKey } : {}),
      }
    }
    return { type: 'none' }
  }

  async function saveConfig() {
    const updated = await settingsApi.saveBackupConfig({ path: path || null, schedule, retention_count: retentionCount, remote: buildRemoteInput() })
    setCfg(updated)
    // Secrets never round-trip — clear the plaintext inputs and rely on the hasX flags from now on.
    setS3SecretAccessKey(''); setSftpPassword(''); setSftpPrivateKey('')
    if (updated.remote.type === 's3') setHasSecretAccessKey(updated.remote.hasSecretAccessKey)
    if (updated.remote.type === 'sftp') { setHasPassword(updated.remote.hasPassword); setHasPrivateKey(updated.remote.hasPrivateKey) }
    return updated
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await saveConfig()
      toast('Backup settings saved')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setSaving(false) }
  }

  async function handleBackupNow() {
    if (!path) return
    setRunning(true)
    try {
      await saveConfig() // ensure backup-now runs against the latest form state
      await settingsApi.backupNow()
      toast('Backup written successfully')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setRunning(false) }
  }

  async function handleTestRemote() {
    setTesting(true)
    try {
      await settingsApi.testBackupRemote(buildRemoteInput())
      toast('Remote connection succeeded')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setTesting(false) }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
      <div>
        <div style={lbl}>Backup path</div>
        <input
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="e.g. C:\Users\you\Backups"
          style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={lbl}>Schedule</div>
          <select value={schedule} onChange={e => setSchedule(e.target.value as BackupConfig['schedule'])} style={{ ...inp, width: '100%' }}>
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </div>
        <div style={{ width: 110 }}>
          <div style={lbl}>Keep last</div>
          <input
            type="number"
            min={1}
            max={365}
            value={retentionCount}
            onChange={e => setRetentionCount(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
            style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: saving ? 0.6 : 1, cursor: 'default', flexShrink: 0 }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={handleBackupNow}
          disabled={running || !path}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: (running || !path) ? 0.5 : 1, cursor: 'default', flexShrink: 0 }}
        >
          {running ? 'Backing up…' : 'Backup now'}
        </button>
      </div>
      {cfg?.last_backup_at && (
        <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          Last backup: <span style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{new Date(cfg.last_backup_at).toLocaleString()}</span>
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--line-2)', marginTop: 4, paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={lbl}>Offsite destination</div>
          <select value={remoteType} onChange={e => setRemoteType(e.target.value as RemoteType)} style={{ ...inp, width: '100%' }}>
            <option value="none">None (local only)</option>
            <option value="s3">S3-compatible bucket</option>
            <option value="sftp">SFTP / rsync-style server</option>
          </select>
        </div>

        {remoteType === 's3' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Bucket</div>
                <input value={s3Bucket} onChange={e => setS3Bucket(e.target.value)} placeholder="my-devbrain-backups" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Region</div>
                <input value={s3Region} onChange={e => setS3Region(e.target.value)} placeholder="us-east-1" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Endpoint (optional — MinIO / R2 / B2)</div>
                <input value={s3Endpoint} onChange={e => setS3Endpoint(e.target.value)} placeholder="https://s3.example.com" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Key prefix (optional)</div>
                <input value={s3Prefix} onChange={e => setS3Prefix(e.target.value)} placeholder="backups/devbrain" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Access key ID</div>
                <input value={s3AccessKeyId} onChange={e => setS3AccessKeyId(e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Secret access key{hasSecretAccessKey ? ' (configured — leave blank to keep)' : ''}</div>
                <input type="password" value={s3SecretAccessKey} onChange={e => setS3SecretAccessKey(e.target.value)} placeholder={hasSecretAccessKey ? '••••••••' : ''} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--fg-2)' }}>
              <input type="checkbox" checked={s3ForcePathStyle} onChange={e => setS3ForcePathStyle(e.target.checked)} />
              Force path-style addressing (needed for most MinIO setups)
            </label>
          </>
        )}

        {remoteType === 'sftp' && (
          <>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Host</div>
                <input value={sftpHost} onChange={e => setSftpHost(e.target.value)} placeholder="backup.example.com" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ width: 90 }}>
                <div style={lbl}>Port</div>
                <input value={sftpPort} onChange={e => setSftpPort(e.target.value)} placeholder="22" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Username</div>
                <input value={sftpUsername} onChange={e => setSftpUsername(e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Remote path</div>
                <input value={sftpRemotePath} onChange={e => setSftpRemotePath(e.target.value)} placeholder="/home/user/backups" style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Password{hasPassword ? ' (configured — leave blank to keep)' : ''}</div>
                <input type="password" value={sftpPassword} onChange={e => setSftpPassword(e.target.value)} placeholder={hasPassword ? '••••••••' : ''} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={lbl}>Private key{hasPrivateKey ? ' (configured — leave blank to keep)' : ''}</div>
                <textarea value={sftpPrivateKey} onChange={e => setSftpPrivateKey(e.target.value)} placeholder={hasPrivateKey ? '(unchanged)' : '-----BEGIN OPENSSH PRIVATE KEY-----'} rows={2} style={{ ...inp, width: '100%', boxSizing: 'border-box', fontFamily: 'var(--font-mono)', resize: 'vertical' }} />
              </div>
            </div>
          </>
        )}

        {remoteType !== 'none' && (
          <div>
            <button
              type="button"
              onClick={handleTestRemote}
              disabled={testing}
              style={{ height: 30, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: testing ? 0.6 : 1, cursor: 'default' }}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        )}

        {cfg?.last_remote_backup_at && (
          <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
            Last remote backup: <span style={{ color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{new Date(cfg.last_remote_backup_at).toLocaleString()}</span>
          </div>
        )}
        {cfg?.last_remote_backup_error && (
          <div style={{ fontSize: 12, color: 'var(--danger, #EF4444)' }}>
            Last remote backup failed: {cfg.last_remote_backup_error}
          </div>
        )}
      </div>
    </form>
  )
}

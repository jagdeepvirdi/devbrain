import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { notifyApi, settingsApi, type Project, type NotificationChannel, type ProjectNotificationPref, type DigestSettings } from '../../lib/api'
import { useToast } from '../Toast'

interface NotificationHubSectionProps {
  projects: Project[]
}

export function NotificationHubSection({ projects }: NotificationHubSectionProps) {
  const { toast } = useToast()
  const navigate = useNavigate()

  // State
  const [channels, setChannels] = useState<NotificationChannel[]>([])
  const [projectPrefs, setProjectPrefs] = useState<ProjectNotificationPref[]>([])
  const [digest, setDigest] = useState<DigestSettings>({ enabled: false, time: '09:00' })
  const [loading, setLoading] = useState(true)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)

  // Add Channel Form State
  const [chanName, setChanName] = useState('')
  const [chanUrl, setChanUrl] = useState('')
  const [chanEnabled, setChanEnabled] = useState(true)

  // Telegram Quick Add State
  const [tgToken, setTgToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')

  // Fetch all data
  const fetchData = async () => {
    try {
      const [chList, prefs, digSettings] = await Promise.all([
        notifyApi.getChannels(),
        notifyApi.getProjectPrefs(),
        settingsApi.getDigestSettings()
      ])
      setChannels(chList)
      setProjectPrefs(prefs)
      setDigest(digSettings)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleAddChannel(e: React.FormEvent) {
    e.preventDefault()
    if (!chanName.trim() || !chanUrl.trim()) return
    try {
      const newChan = await notifyApi.createChannel({
        name: chanName.trim(),
        apprise_url: chanUrl.trim(),
        enabled: chanEnabled
      })
      setChannels(prev => [newChan, ...prev])
      setChanName('')
      setChanUrl('')
      setChanEnabled(true)
      toast('Notification channel added')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleTelegramQuickAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!tgToken.trim() || !tgChatId.trim()) return
    const url = `tgram://${tgToken.trim()}/${tgChatId.trim()}`
    try {
      const newChan = await notifyApi.createChannel({
        name: 'Telegram (Quick)',
        apprise_url: url,
        enabled: true
      })
      setChannels(prev => [newChan, ...prev])
      setTgToken('')
      setTgChatId('')
      toast('Telegram channel configured')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleDeleteChannel(id: string) {
    if (!confirm('Are you sure you want to delete this channel?')) return
    try {
      await notifyApi.deleteChannel(id)
      setChannels(prev => prev.filter(c => c.id !== id))
      toast('Channel deleted')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleToggleChannel(id: string, enabled: boolean) {
    try {
      const updated = await notifyApi.toggleChannel(id, enabled)
      setChannels(prev => prev.map(c => c.id === id ? { ...c, enabled: updated.enabled } : c))
      toast(`Channel ${updated.enabled ? 'enabled' : 'disabled'}`)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handlePrefChange(projectId: string, channelId: string, enabled: boolean) {
    try {
      const updated = await notifyApi.saveProjectPref({ project_id: projectId, channel_id: channelId, enabled })
      setProjectPrefs(prev => {
        const next = prev.filter(p => !(p.project_id === projectId && p.channel_id === channelId))
        next.push(updated)
        return next
      })
      toast('Project preference updated')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleSaveDigest(e: React.FormEvent) {
    e.preventDefault()
    try {
      const updated = await settingsApi.saveDigestSettings(digest)
      setDigest(updated)
      toast('Daily digest settings saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleSendTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await notifyApi.testNotification()
      if (res.success) {
        setTestResult('Success: Test notification delivered successfully.')
        toast('Test notification sent', 'success')
      } else {
        setTestResult('Failed: Failed to deliver.')
        toast('Test notification failed', 'error')
      }
    } catch (err) {
      setTestResult(`Error: ${(err as Error).message}`)
      toast((err as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5,
    padding: '6px 8px', color: 'var(--fg)', fontSize: 12.5, outline: 'none', width: '100%', boxSizing: 'border-box'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 4 }}>
      {/* 1. Apprise Channels List */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Configured Apprise Channels</div>
        {channels.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>No external channels configured. Add one below to enable external delivery.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
            {channels.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg-2)' }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{c.apprise_url}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={(e) => handleToggleChannel(c.id, e.target.checked)}
                    style={{ cursor: 'pointer' }}
                  />
                  <button
                    onClick={() => handleDeleteChannel(c.id)}
                    style={{
                      padding: '2px 6px', borderRadius: 4, fontSize: '11px',
                      background: 'rgba(240,90,90,.08)', border: '1px solid rgba(240,90,90,.25)', color: '#F8A8A8',
                      cursor: 'pointer'
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 2. Add Apprise Channel Form */}
      <form onSubmit={handleAddChannel} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Add Apprise Channel</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Channel Name (e.g. Discord Alert)"
            value={chanName}
            onChange={e => setChanName(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 150 }}
            required
          />
          <input
            type="text"
            placeholder="Apprise URL (e.g. discord://id/token)"
            value={chanUrl}
            onChange={e => setChanUrl(e.target.value)}
            style={{ ...inputStyle, flex: 2, minWidth: 200 }}
            required
          />
        </div>
        <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>
          See <a href="https://github.com/caronc/apprise/wiki" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-2)' }}>Apprise URL Wiki</a> for supported services (Discord, Slack, Email, Pushover, etc.).
        </div>
        <button
          type="submit"
          style={{
            height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)',
            background: 'var(--accent)', color: 'white', fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start'
          }}
        >
          Add Channel
        </button>
      </form>

      {/* 3. Telegram Quick Add */}
      <form onSubmit={handleTelegramQuickAdd} style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)' }}>Telegram Quick-Add</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Bot Token (e.g. 12345:AAAA-ZZZZ)"
            value={tgToken}
            onChange={e => setTgToken(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 180 }}
            required
          />
          <input
            type="text"
            placeholder="Chat ID (e.g. -10012345)"
            value={tgChatId}
            onChange={e => setTgChatId(e.target.value)}
            style={{ ...inputStyle, flex: 1, minWidth: 120 }}
            required
          />
        </div>
        <button
          type="submit"
          style={{
            height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
            background: 'var(--bg-elev-2)', color: 'var(--fg-2)', fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start'
          }}
        >
          Save Telegram
        </button>
      </form>

      {/* 4. Per-project preferences grid */}
      {channels.length > 0 && (
        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)', marginBottom: 8 }}>Project Notifications Grid</div>
          <div style={{ overflowX: 'auto', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elev-2)', borderBottom: '1px solid var(--line)', color: 'var(--fg-3)' }}>
                  <th style={{ padding: '6px 10px' }}>Project</th>
                  {channels.map(c => (
                    <th key={c.id} style={{ padding: '6px 10px', textAlign: 'center' }}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
                    <td style={{ padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: p.color }} />
                      {p.name}
                    </td>
                    {channels.map(c => {
                      const isEnabled = projectPrefs.find(pr => pr.project_id === p.id && pr.channel_id === c.id)?.enabled ?? true
                      return (
                        <td key={c.id} style={{ padding: '8px 10px', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            onChange={(e) => handlePrefChange(p.id, c.id, e.target.checked)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Daily Digest Settings */}
      <form onSubmit={handleSaveDigest} style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>Daily Activity Digest</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="digest-enabled"
            checked={digest.enabled}
            onChange={e => setDigest(p => ({ ...p, enabled: e.target.checked }))}
            style={{ cursor: 'pointer' }}
          />
          <label htmlFor="digest-enabled" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: 'pointer' }}>
            Enable Daily Digest
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>Delivery Time:</span>
          <input
            type="time"
            value={digest.time}
            onChange={e => setDigest(p => ({ ...p, time: e.target.value }))}
            style={{
              padding: '4px 6px', borderRadius: 4, background: 'var(--bg)',
              border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          />
        </div>
        <button
          type="submit"
          style={{
            height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)',
            background: 'var(--accent)', color: 'white', fontSize: 12, cursor: 'pointer', alignSelf: 'flex-start'
          }}
        >
          Save Schedule
        </button>
      </form>

      {/* 6. Test & Log Trigger */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg)' }}>Testing & Logging</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={handleSendTest}
            disabled={testing}
            style={{
              height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
              background: 'var(--bg-elev-2)', color: 'var(--fg-2)', fontSize: 12, cursor: 'pointer', opacity: testing ? 0.6 : 1
            }}
          >
            {testing ? 'Testing...' : 'Send Test Notification'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/notification-log')}
            style={{
              height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
              background: 'var(--bg-elev)', color: 'var(--accent-2)', fontSize: 12, cursor: 'pointer'
            }}
          >
            View Delivery Log
          </button>
        </div>
        {testResult && (
          <div style={{
            fontSize: 11.5, padding: '8px 10px', borderRadius: 4, fontFamily: 'var(--font-mono)',
            background: testResult.startsWith('Success') ? 'rgba(74,222,128,.06)' : 'rgba(239,68,68,.06)',
            border: `1px solid ${testResult.startsWith('Success') ? 'rgba(74,222,128,.2)' : 'rgba(239,68,68,.2)'}`,
            color: testResult.startsWith('Success') ? '#4ADE80' : '#F05A5A'
          }}>
            {testResult}
          </div>
        )}
      </div>
    </div>
  )
}

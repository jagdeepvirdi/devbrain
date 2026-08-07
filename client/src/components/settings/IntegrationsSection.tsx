import { useState, useEffect } from 'react'
import { integrationsApi, type Integration, type Project } from '../../lib/api'
import { useToast } from '../Toast'

export function IntegrationsSection({ projects }: { projects: Project[] }) {
  const { toast } = useToast()
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showAdd,      setShowAdd]      = useState(false)
  const [adding,       setAdding]       = useState(false)
  const [syncingId,    setSyncingId]    = useState<string | null>(null)

  const [newIntegration, setNewIntegration] = useState({
    provider: 'github' as Integration['provider'],
    project_id: '',
    external_project_id: '',
    token: '',
    config: {} as { baseUrl?: string; email?: string }
  })

  useEffect(() => {
    integrationsApi.list().then(setIntegrations).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newIntegration.project_id || !newIntegration.external_project_id) return
    setAdding(true)
    try {
      const it = await integrationsApi.create(newIntegration)
      setIntegrations(prev => [...prev, it])
      setShowAdd(false)
      setNewIntegration({ provider: 'github', project_id: '', external_project_id: '', token: '', config: {} })
      toast(`Integration for ${newIntegration.provider} created`)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove this integration?')) return
    try {
      await integrationsApi.remove(id)
      setIntegrations(prev => prev.filter(x => x.id !== id))
      toast('Integration removed')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleSync(id: string) {
    setSyncingId(id)
    try {
      const res = await integrationsApi.sync(id)
      toast(`Sync complete: ${res.created} created, ${res.skipped} skipped`)
      const updated = await integrationsApi.list()
      setIntegrations(updated)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSyncingId(null)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading integrations…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {integrations.map(it => {
        const p = projects.find(x => x.id === it.project_id)
        return (
          <div key={it.id} style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
              padding: '2px 6px', borderRadius: 4,
              background: it.provider === 'github' ? '#24292e' : it.provider === 'jira' ? '#0052cc' : '#5e6ad2',
              color: 'white', letterSpacing: '0.04em', width: 50, textAlign: 'center'
            }}>
              {it.provider}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{p?.name ?? 'Unknown project'}</div>
              <div style={{ fontSize: 11.5, color: 'var(--fg-4)', marginTop: 2 }}>{it.external_project_id}</div>
            </div>
            {it.last_synced_at && (
              <div style={{ fontSize: 10.5, color: 'var(--fg-4)', textAlign: 'right' }}>
                Synced: {new Date(it.last_synced_at).toLocaleDateString()}
              </div>
            )}
            <button
              onClick={() => handleSync(it.id)}
              disabled={!!syncingId}
              style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'none', color: 'var(--accent-2)', cursor: 'default' }}
            >
              {syncingId === it.id ? 'Syncing...' : 'Sync Now'}
            </button>
            <button onClick={() => handleRemove(it.id)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'none', color: '#EF4444', cursor: 'default' }}>
              Remove
            </button>
          </div>
        )
      })}

      {showAdd ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-2)' }}>Add Integration</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Provider</div>
              <select
                value={newIntegration.provider}
                onChange={e => setNewIntegration(p => ({ ...p, provider: e.target.value as Integration['provider'] }))}
                style={{ ...inp, height: 30 }}
              >
                <option value="github">GitHub</option>
                <option value="jira">Jira</option>
                <option value="linear">Linear</option>
              </select>
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Project</div>
              <select
                value={newIntegration.project_id}
                onChange={e => setNewIntegration(p => ({ ...p, project_id: e.target.value }))}
                style={{ ...inp, height: 30 }}
              >
                <option value="">Select project...</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>
              {newIntegration.provider === 'github' ? 'Repo (owner/repo)' : newIntegration.provider === 'jira' ? 'Project Key' : 'Team Key'}
            </div>
            <input
              value={newIntegration.external_project_id}
              onChange={e => setNewIntegration(p => ({ ...p, external_project_id: e.target.value }))}
              placeholder={newIntegration.provider === 'github' ? 'facebook/react' : 'PROJ'}
              style={inp}
            />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Auth Token (Optional)</div>
            <input
              type="password"
              value={newIntegration.token}
              onChange={e => setNewIntegration(p => ({ ...p, token: e.target.value }))}
              placeholder="API Key or PAT"
              style={inp}
            />
          </div>
          {newIntegration.provider === 'jira' && (
            <div>
              <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Jira Base URL & Email</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={newIntegration.config.baseUrl || ''}
                  onChange={e => setNewIntegration(p => ({ ...p, config: { ...p.config, baseUrl: e.target.value } }))}
                  placeholder="https://yourorg.atlassian.net"
                  style={inp}
                />
                <input
                  value={newIntegration.config.email || ''}
                  onChange={e => setNewIntegration(p => ({ ...p, config: { ...p.config, email: e.target.value } }))}
                  placeholder="your@email.com"
                  style={inp}
                />
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button type="submit" disabled={adding} style={{ fontSize: 12, padding: '5px 15px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', cursor: 'default' }}>
              {adding ? 'Adding...' : 'Add Integration'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', alignSelf: 'flex-start' }}>
          + Add integration
        </button>
      )}
    </div>
  )
}

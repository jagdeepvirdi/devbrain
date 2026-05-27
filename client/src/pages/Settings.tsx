import React, { useState, useEffect, useRef } from 'react'
import { settingsApi, authApi, projectsApi, usersApi, auditApi, integrationsApi, claudeProjectsApi, type SettingsData, type ImportSummary, type BackupConfig, type User, type AuditEvent, type AuthUser, type IntegrationsConfig, type ScanCandidate, type Project } from '../lib/api'
import { useToast } from '../components/Toast'

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{label}</span>
      <span style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 8, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const ROLE_COLOR: Record<string, string> = { admin: '#EF4444', editor: '#6366F1', viewer: '#64748B' }

// ── User Management section ───────────────────────────────────────────────

function UserManagement() {
  const { toast } = useToast()
  const [users,      setUsers]      = useState<User[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [newUser,    setNewUser]    = useState({ username: '', password: '', role: 'editor' as User['role'] })
  const [adding,     setAdding]     = useState(false)
  const [cpwdUserId, setCpwdUserId] = useState<string | null>(null)
  const [newPwd,     setNewPwd]     = useState('')

  useEffect(() => {
    usersApi.list().then(setUsers).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newUser.username || !newUser.password) return
    setAdding(true)
    try {
      const u = await usersApi.create({ ...newUser })
      setUsers(prev => [...prev, u])
      setNewUser({ username: '', password: '', role: 'editor' })
      setShowAdd(false)
      toast(`User "${u.username}" created`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleRoleChange(id: string, role: User['role']) {
    try {
      const u = await usersApi.update(id, { role })
      setUsers(prev => prev.map(x => x.id === id ? u : x))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleDelete(id: string, username: string) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return
    try {
      await usersApi.remove(id)
      setUsers(prev => prev.filter(x => x.id !== id))
      toast(`User "${username}" deleted`)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleResetPassword(id: string) {
    if (!newPwd || newPwd.length < 6) { toast('Password must be at least 6 characters', 'error'); return }
    try {
      await usersApi.update(id, { password: newPwd })
      toast('Password updated')
      setCpwdUserId(null)
      setNewPwd('')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '8px 0' }}>Loading users…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {users.map(u => (
        <div key={u.id} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1 }}>{u.username}</span>
            {u.is_ldap && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--line)', color: 'var(--fg-4)' }}>LDAP</span>}
            <select
              value={u.role}
              onChange={e => handleRoleChange(u.id, e.target.value as User['role'])}
              style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: `1px solid ${ROLE_COLOR[u.role]}40`, background: `${ROLE_COLOR[u.role]}12`, color: ROLE_COLOR[u.role], cursor: 'default' }}
            >
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            {!u.is_ldap && (
              <button onClick={() => { setCpwdUserId(cpwdUserId === u.id ? null : u.id); setNewPwd('') }} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                Reset pwd
              </button>
            )}
            <button onClick={() => handleDelete(u.id, u.username)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)', color: '#EF4444', cursor: 'default' }}>
              Delete
            </button>
          </div>
          {u.email && <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>{u.email}</span>}
          {cpwdUserId === u.id && (
            <div style={{ display: 'flex', gap: 6 }}>
              <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min 6 chars)" style={{ ...inp, flex: 1 }} />
              <button onClick={() => handleResetPassword(u.id)} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default' }}>Save</button>
            </div>
          )}
        </div>
      ))}

      {showAdd ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>New user</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newUser.username} onChange={e => setNewUser(p => ({...p, username: e.target.value}))} placeholder="Username" style={{ ...inp, flex: 1 }} autoFocus />
            <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({...p, password: e.target.value}))} placeholder="Password (min 6)" style={{ ...inp, flex: 1 }} />
            <select value={newUser.role} onChange={e => setNewUser(p => ({...p, role: e.target.value as User['role']}))} style={{ fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'default' }}>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" disabled={adding} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: adding ? 0.6 : 1 }}>{adding ? 'Creating…' : 'Create'}</button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', alignSelf: 'flex-start' }}>
          + Add user
        </button>
      )}
    </div>
  )
}

// ── Audit Log section ─────────────────────────────────────────────────────

function AuditLog() {
  const [events,  setEvents]  = useState<AuditEvent[]>([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [offset,  setOffset]  = useState(0)

  const PAGE = 25

  useEffect(() => {
    setLoading(true)
    auditApi.list({ limit: PAGE, offset })
      .then(r => { setEvents(r.items); setTotal(r.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [offset])

  function fmtDate(s: string) {
    return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const ACTION_COLOR: Record<string, string> = { create: '#22C55E', update: '#6366F1', delete: '#EF4444' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '8px 0' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {events.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '8px 0' }}>No audit events yet.</div>}
      {events.map(e => (
        <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${ACTION_COLOR[e.action]}14`, border: `1px solid ${ACTION_COLOR[e.action]}30`, color: ACTION_COLOR[e.action], fontWeight: 600, flexShrink: 0 }}>
            {e.action}
          </span>
          <span style={{ color: 'var(--fg-3)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.entity_type}</span>
          <span style={{ color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {e.entity_name ?? e.entity_id.slice(0, 8)}
          </span>
          <span style={{ color: 'var(--fg-4)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.username ?? 'system'}</span>
          <span style={{ color: 'var(--fg-4)', flexShrink: 0, fontSize: 11 }}>{fmtDate(e.created_at)}</span>
        </div>
      ))}
      {(offset > 0 || events.length < total) && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', paddingTop: 8 }}>
          {offset > 0 && (
            <button onClick={() => setOffset(o => Math.max(0, o - PAGE))} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>← Newer</button>
          )}
          {events.length < total - offset && (
            <button onClick={() => setOffset(o => o + PAGE)} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>Older →</button>
          )}
        </div>
      )}
      <div style={{ fontSize: 11, color: 'var(--fg-4)', paddingTop: 4 }}>{total} total events</div>
    </div>
  )
}

// ── Integrations section ─────────────────────────────────────────────────

function IntegrationsSection() {
  const { toast } = useToast()
  const [config,      setConfig]      = useState<IntegrationsConfig | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [jiraOpen,    setJiraOpen]    = useState(false)
  const [linearOpen,  setLinearOpen]  = useState(false)
  const [jiraForm,    setJiraForm]    = useState({ baseUrl: '', email: '', apiToken: '' })
  const [linearKey,   setLinearKey]   = useState('')
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    integrationsApi.getConfig()
      .then(setConfig)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function saveJira(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await integrationsApi.saveJira(jiraForm)
      const cfg = await integrationsApi.getConfig()
      setConfig(cfg)
      setJiraOpen(false)
      setJiraForm({ baseUrl: '', email: '', apiToken: '' })
      toast('Jira integration saved', 'success')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setSaving(false) }
  }

  async function saveLinear(e: React.FormEvent) {
    e.preventDefault()
    if (!linearKey.trim()) return
    setSaving(true)
    try {
      await integrationsApi.saveLinear(linearKey)
      const cfg = await integrationsApi.getConfig()
      setConfig(cfg)
      setLinearOpen(false)
      setLinearKey('')
      toast('Linear integration saved', 'success')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setSaving(false) }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Jira */}
      <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>Jira</div>
            {config?.jira
              ? <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>{config.jira.email} · {config.jira.baseUrl}</div>
              : <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Not configured</div>
            }
          </div>
          {config?.jira && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)', color: '#22C55E' }}>Connected</span>}
          <button onClick={() => { setJiraOpen(o => !o); setLinearOpen(false) }} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            {jiraOpen ? 'Cancel' : config?.jira ? 'Update' : 'Configure'}
          </button>
        </div>
        {jiraOpen && (
          <form onSubmit={saveJira} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <input value={jiraForm.baseUrl} onChange={e => setJiraForm(p => ({ ...p, baseUrl: e.target.value }))} placeholder="https://yourorg.atlassian.net" style={inp} />
            <input value={jiraForm.email} onChange={e => setJiraForm(p => ({ ...p, email: e.target.value }))} placeholder="your@email.com" style={inp} />
            <input type="password" value={jiraForm.apiToken} onChange={e => setJiraForm(p => ({ ...p, apiToken: e.target.value }))} placeholder="Jira API token" style={inp} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" disabled={saving || !jiraForm.baseUrl || !jiraForm.email || !jiraForm.apiToken} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Linear */}
      <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>Linear</div>
            {config?.linear
              ? <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>API key saved</div>
              : <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Not configured</div>
            }
          </div>
          {config?.linear && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)', color: '#22C55E' }}>Connected</span>}
          <button onClick={() => { setLinearOpen(o => !o); setJiraOpen(false) }} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            {linearOpen ? 'Cancel' : config?.linear ? 'Update' : 'Configure'}
          </button>
        </div>
        {linearOpen && (
          <form onSubmit={saveLinear} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <input type="password" value={linearKey} onChange={e => setLinearKey(e.target.value)} placeholder="lin_api_xxxx…" style={inp} />
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="submit" disabled={saving || !linearKey.trim()} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Claude Integration section ────────────────────────────────────────────

type LinkAction = 'idle' | 'linking' | 'creating'

interface CandidateRowProps {
  candidate: ScanCandidate
  projects:  Project[]
  onLinked:  (candidatePath: string) => void
}

function CandidateRow({ candidate, projects, onLinked }: CandidateRowProps) {
  const { toast }          = useToast()
  const [action, setAction] = useState<LinkAction>('idle')
  const [ignored, setIgnored] = useState(false)

  if (ignored) return null

  async function linkTo(projectId: string) {
    setAction('linking')
    try {
      await projectsApi.link(projectId, candidate.path)
      toast(`Linked to project`)
      onLinked(candidate.path)
    } catch (err) {
      toast((err as Error).message, 'error')
      setAction('idle')
    }
  }

  async function createAndLink() {
    setAction('creating')
    try {
      const newProject = await projectsApi.create({
        name:       candidate.name,
        short_name: candidate.name.toLowerCase().replace(/\s+/g, '-').slice(0, 20),
        description: '',
        color:      '#6366F1',
        status:     'active',
        tech_stack: [],
        type:       'tool',
        repo_url:   '',
      })
      await projectsApi.link(newProject.id, candidate.path)
      toast(`Created and linked "${candidate.name}"`)
      onLinked(candidate.path)
    } catch (err) {
      toast((err as Error).message, 'error')
      setAction('idle')
    }
  }

  const busy = action !== 'idle'
  const pct  = candidate.overallPct

  return (
    <tr style={{ borderBottom: '1px solid var(--line)' }}>
      {/* Path */}
      <td style={{ padding: '8px 10px', fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={candidate.path}>
        {candidate.path.split(/[\\/]/).slice(-2).join('/')}
      </td>

      {/* Detected name */}
      <td style={{ padding: '8px 10px', fontSize: 12.5, color: 'var(--fg)', fontWeight: 500 }}>
        {candidate.name}
      </td>

      {/* Last session */}
      <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--fg-4)', whiteSpace: 'nowrap' }}>
        {candidate.lastSessionDate
          ? new Date(candidate.lastSessionDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
          : '—'}
      </td>

      {/* Task % */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 48, height: 4, background: 'var(--bg-elev-2)', borderRadius: 2, flexShrink: 0 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${pct}%`,
              background: pct === 100 ? '#22C55E' : pct >= 50 ? '#6366F1' : '#F59E0B',
            }} />
          </div>
          <span style={{ fontSize: 11, color: 'var(--fg-4)', fontVariantNumeric: 'tabular-nums' }}>{pct}%</span>
        </div>
      </td>

      {/* Suggested match */}
      <td style={{ padding: '8px 10px', fontSize: 12, color: candidate.matchedProjectName ? '#818CF8' : 'var(--fg-4)' }}>
        {candidate.matchedProjectName ?? '—'}
      </td>

      {/* Actions */}
      <td style={{ padding: '8px 10px' }}>
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {candidate.matchedProjectId && (
            <button
              disabled={busy}
              onClick={() => linkTo(candidate.matchedProjectId!)}
              style={{ height: 24, padding: '0 9px', borderRadius: 'var(--radius)', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.12)', color: '#818CF8', fontSize: 11.5, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
            >
              {action === 'linking' ? 'Linking…' : `Link to ${candidate.matchedProjectName}`}
            </button>
          )}

          {/* Link to any project */}
          <select
            disabled={busy}
            defaultValue=""
            onChange={e => { if (e.target.value) linkTo(e.target.value) }}
            style={{ height: 24, padding: '0 6px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-4)', fontSize: 11.5, opacity: busy ? 0.5 : 1 }}
          >
            <option value="">Link to…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            disabled={busy}
            onClick={createAndLink}
            style={{ height: 24, padding: '0 9px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11.5, opacity: busy ? 0.5 : 1, cursor: busy ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {action === 'creating' ? 'Creating…' : '+ New project'}
          </button>

          <button
            disabled={busy}
            onClick={() => setIgnored(true)}
            style={{ height: 24, padding: '0 7px', borderRadius: 'var(--radius)', border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', fontSize: 11.5, opacity: busy ? 0.5 : 1 }}
          >
            Ignore
          </button>
        </div>
      </td>
    </tr>
  )
}

function ClaudeIntegrationSection() {
  const { toast }                         = useToast()
  const [scanRoot,     setScanRoot]       = useState('')
  const [savedRoot,    setSavedRoot]      = useState<string | null>(null)
  const [rootLoading,  setRootLoading]    = useState(true)
  const [rootSaving,   setRootSaving]     = useState(false)
  const [scanning,     setScanning]       = useState(false)
  const [candidates,   setCandidates]     = useState<ScanCandidate[] | null>(null)
  const [scanError,    setScanError]      = useState<string | null>(null)
  const [projects,     setProjects]       = useState<Project[]>([])
  const [linked,       setLinked]         = useState<Set<string>>(new Set())

  useEffect(() => {
    settingsApi.getClaudeSettings()
      .then(d => { setScanRoot(d.scan_root ?? ''); setSavedRoot(d.scan_root) })
      .catch(() => {})
      .finally(() => setRootLoading(false))

    projectsApi.list().then(setProjects).catch(() => {})
  }, [])

  async function handleSaveRoot(e: React.FormEvent) {
    e.preventDefault()
    setRootSaving(true)
    try {
      const val = scanRoot.trim() || null
      await settingsApi.saveClaudeSettings(val)
      setSavedRoot(val)
      toast('Scan root saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRootSaving(false)
    }
  }

  async function handleScan() {
    setScanning(true)
    setScanError(null)
    setCandidates(null)
    setLinked(new Set())
    try {
      const result = await claudeProjectsApi.scan()
      setCandidates(result.candidates)
      if (result.candidates.length === 0) {
        toast('Scan complete — no Claude projects found')
      } else {
        toast(`Found ${result.candidates.length} project${result.candidates.length !== 1 ? 's' : ''}`)
      }
    } catch (err) {
      setScanError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  function handleLinked(path: string) {
    setLinked(prev => new Set([...prev, path]))
    // Refresh projects list so actions stay accurate
    projectsApi.list().then(setProjects).catch(() => {})
  }

  const inp: React.CSSProperties = {
    flex: 1, background: 'var(--bg)', border: '1px solid var(--line-2)',
    borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5,
    boxSizing: 'border-box', outline: 'none',
  }

  const visibleCandidates = candidates?.filter(c => !linked.has(c.path)) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Scan root */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', marginBottom: 6 }}>Scan root</div>
        <div style={{ fontSize: 12, color: 'var(--fg-4)', marginBottom: 8 }}>
          Root folder to scan for Claude Code projects. Searches up to 3 levels deep for folders containing <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>CLAUDE.md</code>, <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>TASKS.md</code>, or <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>sessions/</code>.
        </div>
        {rootLoading ? (
          <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Loading…</div>
        ) : (
          <form onSubmit={handleSaveRoot} style={{ display: 'flex', gap: 8 }}>
            <input
              value={scanRoot}
              onChange={e => setScanRoot(e.target.value)}
              placeholder="e.g. C:\Users\you\Projects"
              style={inp}
            />
            <button
              type="submit"
              disabled={rootSaving || scanRoot.trim() === (savedRoot ?? '')}
              style={{ height: 30, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: rootSaving ? 0.6 : 1, whiteSpace: 'nowrap', cursor: 'default' }}
            >
              {rootSaving ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>

      {/* Scan button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={handleScan}
          disabled={scanning || !savedRoot}
          title={!savedRoot ? 'Save a scan root first' : undefined}
          style={{ height: 30, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.12)', color: '#818CF8', fontSize: 12.5, opacity: (scanning || !savedRoot) ? 0.5 : 1, cursor: (scanning || !savedRoot) ? 'default' : 'pointer' }}
        >
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
        {savedRoot && (
          <span style={{ fontSize: 11.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{savedRoot}</span>
        )}
      </div>

      {/* Error */}
      {scanError && (
        <div style={{ fontSize: 12.5, color: '#F8A8A8', padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)' }}>
          {scanError}
        </div>
      )}

      {/* Results */}
      {candidates !== null && visibleCandidates.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '10px 0' }}>
          {candidates.length === 0 ? 'No Claude projects found under the scan root.' : 'All discovered projects have been linked.'}
        </div>
      )}

      {visibleCandidates.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Path', 'Detected name', 'Last session', 'Tasks', 'Suggested match', 'Action'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map(c => (
                <CandidateRow
                  key={c.path}
                  candidate={c}
                  projects={projects}
                  onLinked={handleLinked}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Export section ────────────────────────────────────────────────────────

function ExportSection({ projects }: { projects: Project[] }) {
  const { toast } = useToast()
  const [exportingId,  setExportingId]  = useState<string | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const [selectedId,   setSelectedId]   = useState<string>('')

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }

  async function handleExportProject() {
    if (!selectedId) return
    setExportingId(selectedId)
    try {
      const p = projects.find(x => x.id === selectedId)!
      await settingsApi.exportProject(selectedId, p.short_name)
      toast(`Exported ${p.name}`)
    } catch { toast('Export failed', 'error') }
    finally { setExportingId(null) }
  }

  async function handleExportAll() {
    setExportingAll(true)
    try { await settingsApi.exportAll(); toast('Full export downloaded') }
    catch { toast('Export failed', 'error') }
    finally { setExportingAll(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Project</div>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value="">— select project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button
          onClick={handleExportProject}
          disabled={!selectedId || !!exportingId}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: (!selectedId || !!exportingId) ? 0.5 : 1, cursor: 'default', flexShrink: 0 }}
        >
          {exportingId ? 'Exporting…' : 'Export project'}
        </button>
      </div>
      <div style={{ height: 1, background: 'var(--line)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Export all projects</div>
          <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Downloads a zip with markdown files for every project</div>
        </div>
        <button
          onClick={handleExportAll}
          disabled={exportingAll}
          style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: exportingAll ? 0.6 : 1, cursor: 'default' }}
        >
          {exportingAll ? 'Exporting…' : 'Export all'}
        </button>
      </div>
    </div>
  )
}

// ── Scheduled Backup section ──────────────────────────────────────────────

function ScheduledBackupSection() {
  const { toast } = useToast()
  const [cfg,     setCfg]     = useState<BackupConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [running, setRunning] = useState(false)
  const [path,    setPath]    = useState('')
  const [schedule, setSchedule] = useState<BackupConfig['schedule']>('off')

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 8px', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }

  useEffect(() => {
    settingsApi.getBackupConfig()
      .then(c => { setCfg(c); setPath(c.path ?? ''); setSchedule(c.schedule) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const updated = await settingsApi.saveBackupConfig({ path: path || null, schedule })
      setCfg(updated)
      toast('Backup settings saved')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setSaving(false) }
  }

  async function handleBackupNow() {
    if (!path) return
    // save current form first so backup-now uses latest path
    if (path !== cfg?.path || schedule !== cfg?.schedule) {
      try { const updated = await settingsApi.saveBackupConfig({ path: path || null, schedule }); setCfg(updated) } catch { /* ignore */ }
    }
    setRunning(true)
    try { await settingsApi.backupNow(); toast('Backup written successfully') }
    catch (err) { toast((err as Error).message, 'error') }
    finally { setRunning(false) }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
      <div>
        <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Backup path</div>
        <input
          value={path}
          onChange={e => setPath(e.target.value)}
          placeholder="e.g. C:\Users\you\Backups"
          style={{ ...inp, width: '100%', boxSizing: 'border-box' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Schedule</div>
          <select value={schedule} onChange={e => setSchedule(e.target.value as BackupConfig['schedule'])} style={{ ...inp, width: '100%' }}>
            <option value="off">Off</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
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
    </form>
  )
}

// ── Zip Import section ────────────────────────────────────────────────────

function ZipImportSection() {
  const { toast } = useToast()
  const zipRef = useRef<HTMLInputElement>(null)
  const [zipFile,  setZipFile]  = useState<File | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [result,   setResult]   = useState<ImportSummary | null>(null)
  const [error,    setError]    = useState('')

  async function handleImport(dryRun: boolean) {
    if (!zipFile) return
    setLoading(true); setError(''); setResult(null)
    try {
      const r = await settingsApi.zipImport(zipFile, dryRun)
      setResult(r)
      if (!dryRun) {
        const total = Object.values(r.summary).reduce((s, t) => s + t.created, 0)
        toast(`Zip import complete — ${total} records created`)
      }
    } catch (e) { setError((e as Error).message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
        Import from a DevBrain zip export — restores documents, issues, and commands; skips records that already exist.
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input ref={zipRef} type="file" accept=".zip" style={{ display: 'none' }} onChange={e => { setZipFile(e.target.files?.[0] ?? null); setResult(null); setError(''); e.target.value = '' }} />
        <button onClick={() => zipRef.current?.click()} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, cursor: 'default' }}>
          {zipFile ? zipFile.name : 'Choose zip file'}
        </button>
        {zipFile && (
          <>
            <button onClick={() => handleImport(true)} disabled={loading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: loading ? 0.6 : 1, cursor: 'default' }}>Dry run</button>
            <button onClick={() => handleImport(false)} disabled={loading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: loading ? 0.6 : 1, cursor: 'default' }}>Import</button>
          </>
        )}
      </div>
      {error && <div style={{ fontSize: 12, color: '#EF4444', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)' }}>{error}</div>}
      {result && (
        <div style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', padding: '10px 12px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{result.dry_run ? 'Dry run preview' : 'Import result'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '4px 12px' }}>
            <span style={{ fontSize: 11, color: 'var(--fg-4)' }} /><span style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>to create</span><span style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600 }}>skip</span>
            {Object.entries(result.summary).map(([table, tally]) => (
              <React.Fragment key={table}>
                <span style={{ fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{table}</span>
                <span style={{ fontSize: 12, color: tally.created > 0 ? '#22C55E' : 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.created}</span>
                <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.skipped}</span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────

export function SettingsPage({ onLogout, currentUser }: { onLogout: () => void; currentUser: AuthUser | null }) {
  const { toast } = useToast()
  const [settings,      setSettings]      = useState<SettingsData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [backing,       setBacking]       = useState(false)
  const [reseeding,     setReseeding]     = useState(false)
  const [importFile,    setImportFile]    = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult,  setImportResult]  = useState<ImportSummary | null>(null)
  const [importError,   setImportError]   = useState('')
  const [oldPwd,        setOldPwd]        = useState('')
  const [newPwd,        setNewPwd]        = useState('')
  const [pwdLoading,    setPwdLoading]    = useState(false)
  const [projects,      setProjects]      = useState<Project[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(() => {}).finally(() => setLoading(false))
    projectsApi.list().then(setProjects).catch(() => {})
  }, [])

  async function handleBackup() {
    setBacking(true)
    try { await settingsApi.downloadBackup(); toast('Backup downloaded') }
    catch { toast('Backup failed', 'error') }
    finally { setBacking(false) }
  }

  async function handleSeedReset() {
    if (!confirm('Reset all projects to seed defaults? This will delete ALL projects and their data.')) return
    setReseeding(true)
    try { await projectsApi.seedReset(); toast('Seed reset complete') }
    catch (err) { toast((err as Error).message, 'error') }
    finally { setReseeding(false) }
  }

  async function handleImport(dryRun: boolean) {
    if (!importFile) return
    setImportLoading(true); setImportError(''); setImportResult(null)
    try {
      const text = await importFile.text()
      const data = JSON.parse(text) as unknown
      const result = await settingsApi.importBackup(data, dryRun)
      setImportResult(result)
      if (!dryRun) {
        const total = Object.values(result.summary).reduce((s, t) => s + t.created, 0)
        toast(`Import complete — ${total} records created`)
      }
    } catch (e) { setImportError((e as Error).message) }
    finally { setImportLoading(false) }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!oldPwd || !newPwd) return
    setPwdLoading(true)
    try {
      await authApi.changePassword(oldPwd, newPwd)
      toast('Password changed')
      setOldPwd(''); setNewPwd('')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setPwdLoading(false) }
  }

  function handleLogout() { authApi.logout(); onLogout() }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Settings</h1>
        {currentUser && (
          <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            Signed in as <b style={{ color: 'var(--fg)' }}>{currentUser.username}</b>
            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${ROLE_COLOR[currentUser.role]}18`, border: `1px solid ${ROLE_COLOR[currentUser.role]}30`, color: ROLE_COLOR[currentUser.role] }}>
              {currentUser.role}
            </span>
          </span>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
        {loading ? (
          <div style={{ color: 'var(--fg-3)', fontSize: 12.5 }}>Loading…</div>
        ) : (
          <>
            {/* AI Config */}
            <Section title="AI Backend">
              <Row label="Backend"     value={settings?.ai.backend    ?? '—'} />
              <Row label="Chat model"  value={settings?.ai.chatModel  ?? '—'} mono />
              <Row label="Embed model" value={settings?.ai.embedModel ?? '—'} mono />
              <Row label="Ollama URL"  value={settings?.ai.ollamaUrl  ?? '—'} mono />
            </Section>

            {/* Auth */}
            <Section title="Authentication">
              <Row label="Mode" value={settings?.auth.enabled ? 'Password protected' : 'Dev mode (no auth)'} />
              {settings?.auth.enabled && (
                <>
                  {/* Change own password */}
                  {currentUser?.id !== 'legacy' && currentUser?.id !== 'dev' && (
                    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', marginBottom: 8 }}>Change password</div>
                      <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Current password" style={{ ...inp, flex: 1, minWidth: 140 }} />
                        <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min 6)" style={{ ...inp, flex: 1, minWidth: 140 }} />
                        <button type="submit" disabled={pwdLoading || !oldPwd || !newPwd} style={{ height: 32, padding: '0 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: pwdLoading ? 0.6 : 1, cursor: 'default' }}>
                          {pwdLoading ? 'Saving…' : 'Update'}
                        </button>
                      </form>
                    </div>
                  )}
                  <div style={{ marginTop: 12 }}>
                    <button onClick={handleLogout} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.08)', color: '#F8A8A8', fontSize: 12.5, cursor: 'default' }}>
                      Sign out
                    </button>
                  </div>
                </>
              )}
            </Section>

            {/* User Management (admin only) */}
            {isAdmin && (
              <Section title="User Management">
                <UserManagement />
              </Section>
            )}

            {/* Data */}
            <Section title="Data">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Export backup</div>
                    <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Download all data as JSON (excludes document content and embeddings)</div>
                  </div>
                  <button onClick={handleBackup} disabled={backing} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: backing ? 0.6 : 1, cursor: 'default' }}>
                    {backing ? 'Exporting…' : 'Download'}
                  </button>
                </div>

                <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

                {/* Import backup */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Import backup</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Restore from a JSON backup file — skips records that already exist</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0] ?? null; setImportFile(f); setImportResult(null); setImportError(''); e.target.value = '' }} />
                      <button onClick={() => fileRef.current?.click()} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, whiteSpace: 'nowrap', cursor: 'default' }}>
                        {importFile ? importFile.name : 'Choose file'}
                      </button>
                    </div>
                  </div>
                  {importFile && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => handleImport(true)} disabled={importLoading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: importLoading ? 0.6 : 1, cursor: 'default' }}>Dry Run</button>
                      <button onClick={() => handleImport(false)} disabled={importLoading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: importLoading ? 0.6 : 1, cursor: 'default' }}>Import</button>
                    </div>
                  )}
                  {importError && <div style={{ fontSize: 12, color: '#EF4444', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)' }}>{importError}</div>}
                  {importResult && (
                    <div style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{importResult.dry_run ? 'Dry run preview' : 'Import result'}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '4px 12px', alignItems: 'center' }}>
                        <span style={{ fontSize: 11, color: 'var(--fg-4)' }} /><span style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>to create</span><span style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600 }}>skip</span>
                        {Object.entries(importResult.summary).map(([table, tally]) => (
                          <React.Fragment key={table}>
                            <span style={{ fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{table}</span>
                            <span style={{ fontSize: 12, color: tally.created > 0 ? '#22C55E' : 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.created}</span>
                            <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.skipped}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

                {isAdmin && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Reset to seed data</div>
                      <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Delete all projects and restore the 5 default seed projects</div>
                    </div>
                    <button onClick={handleSeedReset} disabled={reseeding} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.06)', color: '#F8A8A8', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: reseeding ? 0.6 : 1, cursor: 'default' }}>
                      {reseeding ? 'Resetting…' : 'Reset seed'}
                    </button>
                  </div>
                )}
              </div>
            </Section>

            {/* Export (zip) */}
            <Section title="Export">
              <ExportSection projects={projects} />
            </Section>

            {/* Scheduled Backup */}
            <Section title="Scheduled Backup">
              <ScheduledBackupSection />
            </Section>

            {/* Zip Import */}
            <Section title="Import from zip">
              <ZipImportSection />
            </Section>

            {/* Integrations (admin only) */}
            {isAdmin && (
              <Section title="Integrations">
                <IntegrationsSection />
              </Section>
            )}

            {/* Claude Integration */}
            <Section title="Claude Integration">
              <ClaudeIntegrationSection />
            </Section>

            {/* Audit Log (admin only) */}
            {isAdmin && (
              <Section title="Audit Log">
                <AuditLog />
              </Section>
            )}

            {/* About */}
            <Section title="About">
              <Row label="Version"  value="2.0.0" />
              <Row label="Stack"    value="React + Node.js + PostgreSQL + Ollama" />
              <Row label="Auth"     value="Multi-user JWT + optional LDAP" />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

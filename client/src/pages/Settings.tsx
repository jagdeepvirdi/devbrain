import React, { useState, useEffect, useRef } from 'react'
import { settingsApi, authApi, projectsApi, usersApi, auditApi, integrationsApi, claudeProjectsApi, antigravityProjectsApi, notifyApi, templatesApi, apiTokensApi, type SettingsData, type ImportSummary, type BackupConfig, type User, type AuditEvent, type AuthUser, type ScanCandidate, type Project, type NotificationRules, type Invite, type Integration, type LdapSettings, type NotificationChannel, type ProjectNotificationPref, type DigestSettings, type Template, type ApiToken } from '../lib/api'
import { useToast } from '../components/Toast'
import { useNavigate } from 'react-router-dom'

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

const ROLE_COLOR: Record<string, string> = { admin: '#EF4444', member: '#6366F1', viewer: '#64748B' }

// ── User Management section ───────────────────────────────────────────────

function UserManagement() {
  const { toast } = useToast()
  const [users,      setUsers]      = useState<User[]>([])
  const [invites,    setInvites]    = useState<Invite[]>([])
  const [loading,    setLoading]    = useState(true)
  const [showAdd,    setShowAdd]    = useState(false)
  const [showInvite, setShowInvite] = useState(false)
  const [newUser,    setNewUser]    = useState({ username: '', password: '', role: 'member' as User['role'] })
  const [newInvite,  setNewInvite]  = useState({ email: '', role: 'member' as User['role'] })
  const [adding,     setAdding]     = useState(false)
  const [inviting,   setInviting]   = useState(false)
  const [cpwdUserId, setCpwdUserId] = useState<string | null>(null)
  const [newPwd,     setNewPwd]     = useState('')

  useEffect(() => {
    Promise.all([
      usersApi.list(),
      usersApi.listInvites().catch(() => [])
    ]).then(([u, i]) => {
      setUsers(u); setInvites(i)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newUser.username || !newUser.password) return
    setAdding(true)
    try {
      const u = await usersApi.create({ ...newUser, email: null })
      setUsers(prev => [...prev, u])
      setNewUser({ username: '', password: '', role: 'member' })
      setShowAdd(false)
      toast(`User "${u.username}" created`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setAdding(false)
    }
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    if (!newInvite.email) return
    setInviting(true)
    try {
      const inv = await usersApi.createInvite(newInvite)
      setInvites(prev => [inv, ...prev])
      setNewInvite({ email: '', role: 'member' })
      setShowInvite(false)
      toast(`Invite created for ${inv.email}. URL copied to clipboard.`, 'success')
      const inviteUrl = `${window.location.origin}/register?token=${inv.token}`
      navigator.clipboard.writeText(inviteUrl).catch(() => {})
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setInviting(false)
    }
  }

  async function handleStatusToggle(u: User) {
    try {
      const updated = await usersApi.update(u.id, { is_active: !u.is_active })
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: updated.is_active } : x))
      toast(`User ${u.username} ${updated.is_active ? 'reactivated' : 'deactivated'}`)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleRemoveInvite(id: string) {
    try {
      await usersApi.removeInvite(id)
      setInvites(prev => prev.filter(x => x.id !== id))
      toast('Invite removed')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleRoleChange(id: string, role: User['role']) {
    try {
      const u = await usersApi.update(id, { role })
      setUsers(prev => prev.map(x => x.id === id ? { ...x, role: u.role } : x))
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      
      {/* Active Users */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase' }}>Active Users</div>
        {users.map(u => (
          <div key={u.id} style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)', background: u.is_active ? 'var(--bg)' : 'rgba(255,255,255,.02)', opacity: u.is_active ? 1 : 0.6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1 }}>{u.username}</span>
              {u.is_ldap && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid var(--line)', color: 'var(--fg-4)' }}>LDAP</span>}
              <select
                value={u.role}
                onChange={e => handleRoleChange(u.id, e.target.value as User['role'])}
                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: `1px solid ${ROLE_COLOR[u.role]}40`, background: `${ROLE_COLOR[u.role]}12`, color: ROLE_COLOR[u.role], cursor: 'default' }}
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
              
              <button 
                onClick={() => handleStatusToggle(u)} 
                title={u.is_active ? 'Deactivate' : 'Reactivate'}
                style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}
              >
                {u.is_active ? 'Deactivate' : 'Activate'}
              </button>

              {!u.is_ldap && (
                <button onClick={() => { setCpwdUserId(cpwdUserId === u.id ? null : u.id); setNewPwd('') }} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                  Reset pwd
                </button>
              )}
              <button onClick={() => handleDelete(u.id, u.username)} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.06)', color: '#EF4444', cursor: 'default' }}>
                Delete
              </button>
            </div>
            {u.email && <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>{u.email}</div>}
            {cpwdUserId === u.id && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--line-2)' }}>
                <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min 6 chars)" style={{ ...inp, flex: 1 }} />
                <button onClick={() => handleResetPassword(u.id)} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default' }}>Save</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pending Invites */}
      {invites.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase' }}>Pending Invites</div>
          {invites.map(inv => (
            <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)' }}>{inv.email}</div>
                <div style={{ fontSize: 11, color: 'var(--fg-4)', marginTop: 2 }}>Expires {new Date(inv.expires_at).toLocaleDateString()}</div>
              </div>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: `1px solid ${ROLE_COLOR[inv.role]}40`, background: `${ROLE_COLOR[inv.role]}12`, color: ROLE_COLOR[inv.role], fontWeight: 600, textTransform: 'uppercase' }}>
                {inv.role}
              </span>
              <button onClick={() => handleRemoveInvite(inv.id)} style={{ padding: '4px 6px', color: 'var(--fg-4)', fontSize: 14, cursor: 'default' }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {showInvite ? (
        <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Invite by Email</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newInvite.email} onChange={e => setNewInvite(p => ({...p, email: e.target.value}))} placeholder="email@org.com" style={{ ...inp, flex: 1 }} autoFocus />
            <select value={newInvite.role} onChange={e => setNewInvite(p => ({...p, role: e.target.value as User['role']}))} style={{ fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'default' }}>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" disabled={inviting} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: inviting ? 0.6 : 1 }}>{inviting ? 'Inviting…' : 'Generate Link'}</button>
            <button type="button" onClick={() => setShowInvite(false)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>Cancel</button>
          </div>
        </form>
      ) : showAdd ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Create User</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={newUser.username} onChange={e => setNewUser(p => ({...p, username: e.target.value}))} placeholder="Username" style={{ ...inp, flex: 1 }} autoFocus />
            <input type="password" value={newUser.password} onChange={e => setNewUser(p => ({...p, password: e.target.value}))} placeholder="Password (min 6)" style={{ ...inp, flex: 1 }} />
            <select value={newUser.role} onChange={e => setNewUser(p => ({...p, role: e.target.value as User['role']}))} style={{ fontSize: 12, padding: '4px 6px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg)', color: 'var(--fg)', cursor: 'default' }}>
              <option value="member">member</option>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowInvite(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'none', color: 'var(--accent-2)', cursor: 'default' }}>
            + Invite user
          </button>
          <button onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            + Direct add
          </button>
        </div>
      )}
    </div>
  )
}

// ── Audit Log section ─────────────────────────────────────────────────────

function AuditLog() {
  const { toast } = useToast()
  const [events,      setEvents]      = useState<AuditEvent[]>([])
  const [total,       setTotal]       = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [offset,      setOffset]      = useState(0)
  const [entityType,  setEntityType]  = useState('')
  const [userId]                      = useState('')
  const [exporting,   setExporting]   = useState(false)

  const PAGE = 25

  useEffect(() => {
    setLoading(true)
    auditApi.list({ limit: PAGE, offset, entityType, userId })
      .then(r => { setEvents(r.items); setTotal(r.total) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [offset, entityType, userId])

  async function handleExport() {
    setExporting(true)
    try {
      await auditApi.export()
      toast('Audit log exported to CSV')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setExporting(false)
    }
  }

  function fmtDate(s: string) {
    return new Date(s).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  const ACTION_COLOR: Record<string, string> = { create: '#22C55E', update: '#6366F1', delete: '#EF4444' }
  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 4, padding: '3px 6px', color: 'var(--fg)', fontSize: 11.5, outline: 'none' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={entityType} onChange={e => { setEntityType(e.target.value); setOffset(0) }} style={inp}>
          <option value="">All Entities</option>
          <option value="project">Project</option>
          <option value="document">Document</option>
          <option value="issue">Issue</option>
          <option value="command">Command</option>
          <option value="user">User</option>
        </select>
        
        <button 
          onClick={handleExport} 
          disabled={exporting}
          style={{ ...inp, marginLeft: 'auto', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}
        >
          {exporting ? 'Exporting...' : 'Export CSV'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {loading && events.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '20px 0', textAlign: 'center' }}>Loading events…</div>
        ) : events.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '20px 0', textAlign: 'center' }}>No matching events found.</div>
        ) : (
          events.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 12 }}>
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: `${ACTION_COLOR[e.action]}14`, border: `1px solid ${ACTION_COLOR[e.action]}30`, color: ACTION_COLOR[e.action], fontWeight: 600, flexShrink: 0, textTransform: 'uppercase' }}>
                {e.action}
              </span>
              <span style={{ color: 'var(--fg-3)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{e.entity_type}</span>
              <span style={{ color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {e.entity_name ?? e.entity_id.slice(0, 8)}
              </span>
              <span style={{ color: 'var(--fg-4)', flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.username ?? 'system'}</span>
              <span style={{ color: 'var(--fg-4)', flexShrink: 0, fontSize: 11 }}>{fmtDate(e.created_at)}</span>
            </div>
          ))
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8 }}>
        <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{total} total events</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button 
            disabled={loading || offset === 0} 
            onClick={() => setOffset(o => Math.max(0, o - PAGE))} 
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default', opacity: offset === 0 ? 0.5 : 1 }}
          >
            Newer
          </button>
          <button 
            disabled={loading || offset + PAGE >= total} 
            onClick={() => setOffset(o => o + PAGE)} 
            style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default', opacity: offset + PAGE >= total ? 0.5 : 1 }}
          >
            Older
          </button>
        </div>
      </div>
    </div>
  )
}

// ── API Tokens section ────────────────────────────────────────────────────

function ApiTokensSection() {
  const { toast } = useToast()
  const [tokens,   setTokens]   = useState<ApiToken[]>([])
  const [loading,  setLoading]  = useState(true)
  const [showAdd,  setShowAdd]  = useState(false)
  const [creating, setCreating] = useState(false)
  const [form,     setForm]     = useState({ name: '', expiresInDays: '' })
  const [justCreated, setJustCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    apiTokensApi.list().then(setTokens).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) return
    setCreating(true)
    try {
      const days = form.expiresInDays.trim() ? Number(form.expiresInDays) : undefined
      const result = await apiTokensApi.create({ name: form.name.trim(), expiresInDays: days })
      setTokens(prev => [result, ...prev])
      setJustCreated(result.token)
      setCopied(false)
      setForm({ name: '', expiresInDays: '' })
      setShowAdd(false)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string, name: string) {
    if (!confirm(`Revoke token "${name}"? Anything using it will stop working immediately.`)) return
    try {
      await apiTokensApi.revoke(id)
      setTokens(prev => prev.filter(t => t.id !== id))
      toast('Token revoked')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  function copyToken() {
    if (!justCreated) return
    navigator.clipboard.writeText(justCreated).then(() => setCopied(true)).catch(() => {})
  }

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading tokens…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
        Personal access tokens authenticate curl/script requests to the API without a browser session — e.g. <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>Authorization: Bearer dbrn_...</code>. They carry your account's role.
      </div>

      {justCreated && (
        <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Copy this token now — it won't be shown again</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--fg)', background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 4, padding: '5px 8px', overflowX: 'auto', whiteSpace: 'nowrap' }}>
              {justCreated}
            </code>
            <button onClick={copyToken} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--accent)', background: copied ? 'var(--accent)' : 'none', color: copied ? 'white' : 'var(--accent-2)', cursor: 'default', whiteSpace: 'nowrap' }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setJustCreated(null)} style={{ alignSelf: 'flex-start', fontSize: 11, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            Done
          </button>
        </div>
      )}

      {tokens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {tokens.map(t => {
            const expired = t.expires_at ? new Date(t.expires_at) < new Date() : false
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)' }}>{t.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                    {t.token_prefix}… · created {new Date(t.created_at).toLocaleDateString()}
                    {t.last_used_at && <> · last used {new Date(t.last_used_at).toLocaleDateString()}</>}
                    {t.expires_at && <> · {expired ? 'expired' : 'expires'} {new Date(t.expires_at).toLocaleDateString()}</>}
                  </div>
                </div>
                {expired && (
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(239,68,68,.3)', background: 'rgba(239,68,68,.08)', color: '#EF4444', fontWeight: 600, textTransform: 'uppercase' }}>
                    Expired
                  </span>
                )}
                <button onClick={() => handleRevoke(t.id, t.name)} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,.3)', background: 'none', color: '#EF4444', cursor: 'default' }}>
                  Revoke
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd ? (
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px', borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)' }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-2)' }}>Generate Token</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. reembed script" style={{ ...inp, flex: 1 }} autoFocus />
            <input value={form.expiresInDays} onChange={e => setForm(p => ({ ...p, expiresInDays: e.target.value }))} placeholder="Expires in days (optional)" type="number" min={1} style={{ ...inp, width: 190 }} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="submit" disabled={creating || !form.name.trim()} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: creating ? 0.6 : 1 }}>
              {creating ? 'Generating…' : 'Generate'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setShowAdd(true)} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', alignSelf: 'flex-start' }}>
          + Generate token
        </button>
      )}
    </div>
  )
}

// ── Integrations section ─────────────────────────────────────────────────

function IntegrationsSection({ projects }: { projects: Project[] }) {
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
    config: {} as any
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
                onChange={e => setNewIntegration(p => ({ ...p, provider: e.target.value as any }))}
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

// ── LDAP Configuration section ───────────────────────────────────────────

function LdapConfigurationSection() {
  const { toast } = useToast()
  const [cfg,      setCfg]      = useState<LdapSettings | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  
  const [form, setForm] = useState({
    url:          '',
    bindDn:       '',
    bindPassword: '',
    searchBase:   '',
    userAttr:     'uid'
  })

  const [testCreds, setTestCreds] = useState({ username: '', password: '' })
  const [showTest,  setShowTest]  = useState(false)

  useEffect(() => {
    settingsApi.getLdapSettings().then(d => {
      if (d) {
        setCfg(d)
        setForm({ url: d.url, bindDn: d.bindDn, searchBase: d.searchBase, userAttr: d.userAttr, bindPassword: '' })
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await settingsApi.saveLdapSettings(form)
      const updated = await settingsApi.getLdapSettings()
      setCfg(updated)
      setForm(prev => ({ ...prev, bindPassword: '' }))
      toast('LDAP configuration saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleTest(e: React.FormEvent) {
    e.preventDefault()
    if (!testCreds.username || !testCreds.password) return
    setTesting(true)
    try {
      const res = await settingsApi.testLdap({ ...form, ...testCreds })
      toast(`Success! Authenticated as ${(res.user as any).dn}`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: 8 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Server URL</div>
            <input value={form.url} onChange={e => setForm(p => ({...p, url: e.target.value}))} placeholder="ldap://ldap.company.com" style={inp} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>User Attr</div>
            <input value={form.userAttr} onChange={e => setForm(p => ({...p, userAttr: e.target.value}))} placeholder="uid" style={inp} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Bind DN</div>
          <input value={form.bindDn} onChange={e => setForm(p => ({...p, bindDn: e.target.value}))} placeholder="cn=admin,dc=company,dc=com" style={inp} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Bind Password {cfg?.hasPassword && '(already set)'}</div>
          <input type="password" value={form.bindPassword} onChange={e => setForm(p => ({...p, bindPassword: e.target.value}))} placeholder={cfg?.hasPassword ? '••••••••' : 'Password'} style={inp} />
        </div>

        <div>
          <div style={{ fontSize: 11, color: 'var(--fg-4)', marginBottom: 4 }}>Search Base</div>
          <input value={form.searchBase} onChange={e => setForm(p => ({...p, searchBase: e.target.value}))} placeholder="ou=users,dc=company,dc=com" style={inp} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={saving} style={{ height: 30, padding: '0 15px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: saving ? 0.6 : 1, cursor: 'default' }}>
            {saving ? 'Saving…' : 'Save Config'}
          </button>
          <button type="button" onClick={() => setShowTest(!showTest)} style={{ height: 30, padding: '0 12px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', fontSize: 12.5, cursor: 'default' }}>
            {showTest ? 'Hide Test' : 'Test Connection'}
          </button>
        </div>
      </form>

      {showTest && (
        <form onSubmit={handleTest} style={{ padding: 12, borderRadius: 6, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-2)' }}>Test LDAP Authentication</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={testCreds.username} onChange={e => setTestCreds(p => ({...p, username: e.target.value}))} placeholder="LDAP Username" style={inp} />
            <input type="password" value={testCreds.password} onChange={e => setTestCreds(p => ({...p, password: e.target.value}))} placeholder="Password" style={inp} />
          </div>
          <button type="submit" disabled={testing || !testCreds.username || !testCreds.password} style={{ alignSelf: 'flex-end', height: 26, padding: '0 12px', borderRadius: 4, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 11.5, opacity: testing ? 0.6 : 1, cursor: 'default' }}>
            {testing ? 'Testing…' : 'Test Bind'}
          </button>
        </form>
      )}
    </div>
  )
}

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

function AntigravityIntegrationSection() {
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
    settingsApi.getAntigravitySettings()
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
      await settingsApi.saveAntigravitySettings(val)
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
      const result = await antigravityProjectsApi.scan()
      setCandidates(result.candidates)
      if (result.candidates.length === 0) {
        toast('Scan complete — no Antigravity projects found')
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
          Root folder to scan for Gemini/Antigravity projects. Searches up to 3 levels deep for folders containing <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>ANTIGRAVITY.md</code>, <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>TASKS.md</code>, or <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>sessions/</code>.
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
          {candidates.length === 0 ? 'No Antigravity projects found under the scan root.' : 'All discovered projects have been linked.'}
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

// ── Notification Rules section ─────────────────────────────────────────────

function NotificationRulesSection({ isAdmin }: { isAdmin: boolean }) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rules, setRules] = useState<NotificationRules>({
    stale_threshold_days: 14,
    stale_issues_enabled: true,
    sync_alerts_enabled: true,
    ai_task_alerts_enabled: true
  })

  useEffect(() => {
    settingsApi.getNotificationRules()
      .then(r => setRules(r))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!isAdmin) return
    setSaving(true)
    try {
      const updated = await settingsApi.saveNotificationRules(rules)
      setRules(updated)
      toast('Notification rules saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: '4px 0' }}>Loading…</div>

  return (
    <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--fg-3)', marginBottom: 6 }}>
          <span>Stale issue threshold</span>
          <span style={{ fontWeight: 600, color: 'var(--fg-2)' }}>{rules.stale_threshold_days} days</span>
        </div>
        <input
          type="range"
          min="1"
          max="30"
          value={rules.stale_threshold_days}
          disabled={!isAdmin}
          onChange={e => setRules(p => ({ ...p, stale_threshold_days: Number(e.target.value) }))}
          style={{ width: '100%', cursor: isAdmin ? 'pointer' : 'not-allowed' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-stale-issues"
            checked={rules.stale_issues_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, stale_issues_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-stale-issues" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            Stale issues alert
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-sync-events"
            checked={rules.sync_alerts_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, sync_alerts_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-sync-events" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            Sync events alert
          </label>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            id="rule-ai-tasks"
            checked={rules.ai_task_alerts_enabled}
            disabled={!isAdmin}
            onChange={e => setRules(p => ({ ...p, ai_task_alerts_enabled: e.target.checked }))}
            style={{ cursor: isAdmin ? 'pointer' : 'not-allowed' }}
          />
          <label htmlFor="rule-ai-tasks" style={{ fontSize: 13, color: 'var(--fg-2)', cursor: isAdmin ? 'pointer' : 'default' }}>
            AI task completion alert
          </label>
        </div>
      </div>

      {isAdmin && (
        <button
          type="submit"
          disabled={saving}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: saving ? 0.6 : 1, cursor: 'pointer', alignSelf: 'flex-start' }}
        >
          {saving ? 'Saving…' : 'Save Rules'}
        </button>
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

// ── Notification Hub section ─────────────────────────────────────────────

interface NotificationHubSectionProps {
  projects: Project[]
}

function NotificationHubSection({ projects }: NotificationHubSectionProps) {
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

// ── Templates Section ──────────────────────────────────────────────────────

interface TemplatesSectionProps {
  projects: Project[]
}

function TemplatesSection({ projects }: TemplatesSectionProps) {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)
  
  // Form States
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'issue' | 'runbook' | 'document'>('issue')
  const [projectId, setProjectId] = useState<string | null>(null)
  
  // Issue Body
  const [issueTitle, setIssueTitle] = useState('')
  const [issueDescription, setIssueDescription] = useState('')
  const [issueTagsRaw, setIssueTagsRaw] = useState('')
  const [issueSteps, setIssueSteps] = useState<string[]>([])
  const [newIssueStep, setNewIssueStep] = useState('')
  
  // Document Body
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')
  
  // Runbook Body
  const [rbSteps, setRbSteps] = useState<{ instruction: string; command?: string }[]>([])
  const [newRbInstruction, setNewRbInstruction] = useState('')
  const [newRbCommand, setNewRbCommand] = useState('')

  const loadTemplates = async () => {
    try {
      const data = await templatesApi.list()
      setTemplates(data)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const addIssueStep = () => {
    if (!newIssueStep.trim()) return
    setIssueSteps(prev => [...prev, newIssueStep.trim()])
    setNewIssueStep('')
  }
  
  const removeIssueStep = (index: number) => {
    setIssueSteps(prev => prev.filter((_, i) => i !== index))
  }
  
  const moveIssueStep = (index: number, direction: 'up' | 'down') => {
    setIssueSteps(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < next.length) {
        const temp = next[index]
        next[index] = next[target]
        next[target] = temp
      }
      return next
    })
  }

  const addRbStep = () => {
    if (!newRbInstruction.trim()) return
    setRbSteps(prev => [...prev, { instruction: newRbInstruction.trim(), command: newRbCommand.trim() || undefined }])
    setNewRbInstruction('')
    setNewRbCommand('')
  }

  const removeRbStep = (index: number) => {
    setRbSteps(prev => prev.filter((_, i) => i !== index))
  }

  const moveRbStep = (index: number, direction: 'up' | 'down') => {
    setRbSteps(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < next.length) {
        const temp = next[index]
        next[index] = next[target]
        next[target] = temp
      }
      return next
    })
  }

  const openNew = () => {
    setEditingTemplate(null)
    setName('')
    setDescription('')
    setType('issue')
    setProjectId(null)
    setIssueTitle('')
    setIssueDescription('')
    setIssueTagsRaw('')
    setIssueSteps([])
    setDocTitle('')
    setDocContent('')
    setRbSteps([])
    setEditorOpen(true)
  }

  const openEdit = (t: Template) => {
    setEditingTemplate(t)
    setName(t.name)
    setDescription(t.description)
    setType(t.type)
    setProjectId(t.project_id)
    
    if (t.type === 'issue') {
      setIssueTitle(t.body?.title || '')
      setIssueDescription(t.body?.description || '')
      setIssueTagsRaw(Array.isArray(t.body?.tags) ? t.body.tags.join(', ') : '')
      setIssueSteps(Array.isArray(t.body?.steps) ? t.body.steps : [])
    } else if (t.type === 'document') {
      setDocTitle(t.body?.title || '')
      setDocContent(t.body?.content || '')
    } else if (t.type === 'runbook') {
      setRbSteps(Array.isArray(t.body?.steps) ? t.body.steps : [])
    }
    setEditorOpen(true)
  }

  const openDuplicate = (t: Template) => {
    setEditingTemplate(null)
    setName(`${t.name} (Copy)`)
    setDescription(t.description)
    setType(t.type)
    setProjectId(t.project_id)
    
    if (t.type === 'issue') {
      setIssueTitle(t.body?.title || '')
      setIssueDescription(t.body?.description || '')
      setIssueTagsRaw(Array.isArray(t.body?.tags) ? t.body.tags.join(', ') : '')
      setIssueSteps(Array.isArray(t.body?.steps) ? t.body.steps : [])
    } else if (t.type === 'document') {
      setDocTitle(t.body?.title || '')
      setDocContent(t.body?.content || '')
    } else if (t.type === 'runbook') {
      setRbSteps(Array.isArray(t.body?.steps) ? t.body.steps : [])
    }
    setEditorOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return
    try {
      await templatesApi.remove(id)
      toast('Template deleted', 'success')
      loadTemplates()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast('Name is required', 'error')
      return
    }
    
    let body: any = {}
    if (type === 'issue') {
      const tags = issueTagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      body = {
        title: issueTitle.trim(),
        description: issueDescription.trim(),
        tags,
        steps: issueSteps
      }
    } else if (type === 'document') {
      body = {
        title: docTitle.trim(),
        content: docContent.trim()
      }
    } else if (type === 'runbook') {
      body = {
        steps: rbSteps
      }
    }

    try {
      if (editingTemplate) {
        await templatesApi.update(editingTemplate.id, {
          name: name.trim(),
          description: description.trim(),
          project_id: projectId,
          body
        })
        toast('Template updated', 'success')
      } else {
        await templatesApi.create({
          name: name.trim(),
          description: description.trim(),
          type,
          project_id: projectId,
          body
        })
        toast('Template created', 'success')
      }
      setEditorOpen(false)
      loadTemplates()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const formInp: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--line-2)',
    borderRadius: 6,
    padding: '7px 10px',
    color: 'var(--fg)',
    fontSize: '13px',
    boxSizing: 'border-box',
    outline: 'none',
  }

  if (loading) return <div style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>Loading templates…</div>

  if (editorOpen) {
    return (
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
            {editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'New Template'}
          </span>
          <button type="button" onClick={() => setEditorOpen(false)} style={{ fontSize: 12, color: 'var(--fg-3)', background: 'none', border: 'none' }}>✕ Close</button>
        </div>
        
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Template Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frontend Bug Report" style={formInp} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief explanation of this template..." style={formInp} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as any)}
            disabled={!!editingTemplate}
            style={formInp}
          >
            <option value="issue">Issue</option>
            <option value="runbook">Runbook</option>
            <option value="document">Document</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Project Scope</label>
          <select value={projectId || ''} onChange={e => setProjectId(e.target.value || null)} style={formInp}>
            <option value="">Global (All projects)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {type === 'issue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Issue Fields</div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Title</label>
              <input value={issueTitle} onChange={e => setIssueTitle(e.target.value)} placeholder="e.g. Bug: [Component]" style={formInp} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Description (Markdown)</label>
              <textarea value={issueDescription} onChange={e => setIssueDescription(e.target.value)} placeholder="### Steps to reproduce..." rows={4} style={{ ...formInp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Tags (comma-separated)</label>
              <input value={issueTagsRaw} onChange={e => setIssueTagsRaw(e.target.value)} placeholder="e.g. bug, UI" style={formInp} />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block' }}>Investigation Steps</label>
              {issueSteps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-elev-2)', padding: 8, borderRadius: 6, border: '1px solid var(--line-2)' }}>
                  {issueSteps.map((step, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', color: 'var(--fg-2)' }}>
                      <span style={{ color: 'var(--fg-4)', width: 18 }}>{idx + 1}.</span>
                      <span style={{ flex: 1 }}>{step}</span>
                      <button type="button" disabled={idx === 0} onClick={() => moveIssueStep(idx, 'up')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▲</button>
                      <button type="button" disabled={idx === issueSteps.length - 1} onClick={() => moveIssueStep(idx, 'down')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▼</button>
                      <button type="button" onClick={() => removeIssueStep(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: '12px', cursor: 'default', padding: '0 4px' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newIssueStep} onChange={e => setNewIssueStep(e.target.value)} placeholder="Add investigation step..." style={{ ...formInp, flex: 1 }} />
                <button type="button" onClick={addIssueStep} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg)', fontSize: '12px' }}>Add</button>
              </div>
            </div>
          </div>
        )}

        {type === 'document' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Document Fields</div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Title</label>
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="e.g. Postmortem - [Date]" style={formInp} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Content (Markdown)</label>
              <textarea value={docContent} onChange={e => setDocContent(e.target.value)} placeholder="Write template content here..." rows={8} style={{ ...formInp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
          </div>
        )}

        {type === 'runbook' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Runbook Steps</div>
            {rbSteps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-elev-2)', padding: 8, borderRadius: 6, border: '1px solid var(--line-2)' }}>
                {rbSteps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 3, borderBottom: idx < rbSteps.length - 1 ? '1px solid var(--line)' : 'none', paddingBottom: idx < rbSteps.length - 1 ? 6 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', color: 'var(--fg-2)' }}>
                      <span style={{ color: 'var(--fg-4)', width: 18 }}>{idx + 1}.</span>
                      <span style={{ flex: 1, fontWeight: 500 }}>{step.instruction}</span>
                      <button type="button" disabled={idx === 0} onClick={() => moveRbStep(idx, 'up')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▲</button>
                      <button type="button" disabled={idx === rbSteps.length - 1} onClick={() => moveRbStep(idx, 'down')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▼</button>
                      <button type="button" onClick={() => removeRbStep(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: '12px', cursor: 'default', padding: '0 4px' }}>✕</button>
                    </div>
                    {step.command && (
                      <pre style={{ margin: '2px 0 0 24px', padding: '4px 8px', background: '#0d1117', color: '#e6edf3', borderRadius: 4, fontSize: '11px', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>{step.command}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg)', border: '1px dashed var(--line-2)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--fg-3)' }}>Add Step</div>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--fg-4)', display: 'block', marginBottom: 2 }}>Instruction *</label>
                <input value={newRbInstruction} onChange={e => setNewRbInstruction(e.target.value)} placeholder="e.g. Pull latest code" style={formInp} />
              </div>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--fg-4)', display: 'block', marginBottom: 2 }}>Command (Optional)</label>
                <input value={newRbCommand} onChange={e => setNewRbCommand(e.target.value)} placeholder="e.g. git pull" style={{ ...formInp, fontFamily: 'var(--font-mono)' }} />
              </div>
              <button type="button" onClick={addRbStep} style={{ alignSelf: 'flex-end', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg)', fontSize: '12px' }}>Add Step</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={() => setEditorOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>
            Cancel
          </button>
          <button type="submit" style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default' }}>
            Save
          </button>
        </div>
      </form>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}>Manage templates for Issues, Runbooks, and Documents</span>
        <button onClick={openNew} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
          + New Template
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map(t => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>{t.name}</span>
              
              {/* Type Badge */}
              {t.type === 'issue' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#818CF8' }}>
                  Issue
                </span>
              )}
              {t.type === 'runbook' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(236,72,153,.15)', border: '1px solid rgba(236,72,153,.3)', color: '#F472B6' }}>
                  Runbook
                </span>
              )}
              {t.type === 'document' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.3)', color: '#4ADE80' }}>
                  Document
                </span>
              )}

              {/* Built-in Badge */}
              {t.is_builtin ? (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(234,179,8,.15)', border: '1px solid rgba(234,179,8,.3)', color: '#FACC15' }}>
                  Built-in
                </span>
              ) : (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,.05)', border: '1px solid var(--line-2)', color: 'var(--fg-3)' }}>
                  Custom
                </span>
              )}

              {/* Scope Badge */}
              {t.project_name ? (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: `${t.project_color || '#6366F1'}18`, border: `1px solid ${t.project_color || '#6366F1'}40`, color: t.project_color || '#818CF8' }}>
                  {t.project_name}
                </span>
              ) : (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,.05)', border: '1px solid var(--line-2)', color: 'var(--fg-3)' }}>
                  Global
                </span>
              )}
            </div>

            {t.description && (
              <div style={{ fontSize: '12px', color: 'var(--fg-3)' }}>{t.description}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => openDuplicate(t)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>
                Duplicate
              </button>
              {!t.is_builtin && (
                <>
                  <button onClick={() => openEdit(t)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(t.id)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main Settings page ────────────────────────────────────────────────────

type Density = 'compact' | 'normal' | 'comfy' | 'xl'

const FONT_SIZE_OPTIONS: { value: Density; label: string; size: string }[] = [
  { value: 'compact', label: 'Small',  size: '12px' },
  { value: 'normal',  label: 'Medium', size: '13px' },
  { value: 'comfy',   label: 'Large',  size: '15px' },
  { value: 'xl',      label: 'XL',     size: '16px' },
]

export function SettingsPage({ onLogout, currentUser, density, setDensity }: {
  onLogout: () => void
  currentUser: AuthUser | null
  density: Density
  setDensity: (d: Density) => void
}) {
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
  const [tab, setTab] = useState('general')

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

  const NAV: { id: string; label: string; adminOnly?: boolean }[] = [
    { id: 'general',       label: 'General' },
    { id: 'account',       label: 'Account' },
    { id: 'users',         label: 'Users & Auth',   adminOnly: true },
    { id: 'data',          label: 'Data' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'integrations',  label: 'Integrations' },
    { id: 'templates',     label: 'Templates' },
    { id: 'audit',         label: 'Audit Log',      adminOnly: true },
  ]

  const navItems = NAV.filter(n => !n.adminOnly || isAdmin)

  const navBtn = (id: string): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 12px', borderRadius: 6, border: 'none',
    background: tab === id ? 'rgba(99,102,241,.12)' : 'none',
    color: tab === id ? '#818CF8' : 'var(--fg-3)',
    fontSize: 13, fontWeight: tab === id ? 600 : 400,
    cursor: 'pointer',
  })

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
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

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar nav */}
        <div style={{ width: 168, flexShrink: 0, borderRight: '1px solid var(--line)', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={navBtn(n.id)}>
              {n.label}
            </button>
          ))}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
          {loading ? (
            <div style={{ color: 'var(--fg-3)', fontSize: 12.5 }}>Loading…</div>
          ) : (
            <>
              {/* ── General ──────────────────────────────────────────── */}
              {tab === 'general' && (
                <>
                  <Section title="Font Size">
                    <div style={{ paddingTop: 4 }}>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>
                        Adjusts the base text size across the entire interface. Saved automatically.
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {FONT_SIZE_OPTIONS.map(opt => {
                          const active = density === opt.value
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setDensity(opt.value)}
                              style={{
                                flex: 1, padding: '10px 0', borderRadius: 'var(--radius)',
                                border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
                                background: active ? 'var(--accent-dim)' : 'var(--bg-elev)',
                                color: active ? 'var(--accent-2)' : 'var(--fg-3)',
                                cursor: 'pointer', display: 'flex', flexDirection: 'column',
                                alignItems: 'center', gap: 4,
                              }}
                            >
                              <span style={{ fontSize: opt.size, fontWeight: 600, lineHeight: 1 }}>A</span>
                              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                              <span style={{ fontSize: 10, color: active ? 'var(--accent-2)' : 'var(--fg-4)' }}>{opt.size}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </Section>
                  <Section title="AI Backend">
                    <Row label="Provider"    value={settings?.ai.backend    ?? '—'} />
                    <Row label="Chat model"  value={settings?.ai.chatModel  ?? '—'} mono />
                    <Row label="Embed model" value={settings?.ai.embedModel ?? '—'} mono />
                    <Row label="Ollama URL"  value={settings?.ai.ollamaUrl  ?? '—'} mono />
                  </Section>
                  <Section title="About">
                    <Row label="Version" value="1.2.0" />
                    <Row label="Stack"   value="React + Node.js + PostgreSQL + Ollama" />
                    <Row label="Auth"    value="Multi-user JWT + optional LDAP" />
                  </Section>
                </>
              )}

              {/* ── Account ──────────────────────────────────────────── */}
              {tab === 'account' && (
                <Section title="Account">
                  <Row label="Mode" value={settings?.auth.enabled ? 'Password protected' : 'Dev mode (no auth)'} />
                  {settings?.auth.enabled && (
                    <>
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
              )}

              {tab === 'account' && settings?.auth.enabled && currentUser?.id !== 'legacy' && currentUser?.id !== 'dev' && (
                <Section title="API Tokens">
                  <ApiTokensSection />
                </Section>
              )}

              {/* ── Users & Auth ─────────────────────────────────────── */}
              {tab === 'users' && isAdmin && (
                <>
                  <Section title="User Management">
                    <UserManagement />
                  </Section>
                  <Section title="LDAP Configuration">
                    <LdapConfigurationSection />
                  </Section>
                </>
              )}

              {/* ── Data ─────────────────────────────────────────────── */}
              {tab === 'data' && (
                <>
                  <Section title="Backup">
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
                    </div>
                  </Section>

                  <Section title="Scheduled Backup">
                    <ScheduledBackupSection />
                  </Section>

                  <Section title="Export by Project">
                    <ExportSection projects={projects} />
                  </Section>

                  <Section title="Import from Zip">
                    <ZipImportSection />
                  </Section>

                  {isAdmin && (
                    <Section title="Danger Zone">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                        <div>
                          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Reset to seed data</div>
                          <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Delete all projects and restore the 5 default seed projects</div>
                        </div>
                        <button onClick={handleSeedReset} disabled={reseeding} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.06)', color: '#F8A8A8', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: reseeding ? 0.6 : 1, cursor: 'default' }}>
                          {reseeding ? 'Resetting…' : 'Reset seed'}
                        </button>
                      </div>
                    </Section>
                  )}
                </>
              )}

              {/* ── Notifications ─────────────────────────────────────── */}
              {tab === 'notifications' && (
                <>
                  <Section title="Notification Rules">
                    <NotificationRulesSection isAdmin={isAdmin} />
                  </Section>
                  <Section title="Notification Hub">
                    <NotificationHubSection projects={projects} />
                  </Section>
                </>
              )}

              {/* ── Integrations ──────────────────────────────────────── */}
              {tab === 'integrations' && (
                <>
                  {isAdmin && (
                    <Section title="External Issue Sync">
                      <IntegrationsSection projects={projects} />
                    </Section>
                  )}
                  <Section title="Claude Code">
                    <ClaudeIntegrationSection />
                  </Section>
                  <Section title="Antigravity / Gemini CLI">
                    <AntigravityIntegrationSection />
                  </Section>
                </>
              )}

              {/* ── Templates ─────────────────────────────────────────── */}
              {tab === 'templates' && (
                <Section title="Templates">
                  <TemplatesSection projects={projects} />
                </Section>
              )}

              {/* ── Audit Log ─────────────────────────────────────────── */}
              {tab === 'audit' && isAdmin && (
                <Section title="Audit Log">
                  <AuditLog />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

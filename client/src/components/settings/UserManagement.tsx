import { useState, useEffect } from 'react'
import { usersApi, type User, type Invite } from '../../lib/api'
import { useToast } from '../Toast'
import { ROLE_COLOR } from './constants'

export function UserManagement() {
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

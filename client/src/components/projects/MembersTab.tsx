import { useState, useEffect } from 'react'
import { usersApi, type ProjectMember, type User } from '../../lib/api'
import { useToast } from '../Toast'

interface MembersTabProps {
  projectId: string
  isAdmin:   boolean
}

export default function MembersTab({ projectId, isAdmin }: MembersTabProps) {
  const { toast } = useToast()
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setLoadingAdding] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [selectedRole, setSelectedRole]     = useState<'admin' | 'member' | 'viewer'>('member')

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [m, u] = await Promise.all([
          usersApi.listProjectMembers(projectId),
          isAdmin ? usersApi.list().catch(() => []) : Promise.resolve([])
        ])
        setMembers(m)
        setAllUsers(u)
      } catch (err) {
        toast((err as Error).message, 'error')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectId, isAdmin, toast])

  async function handleAdd() {
    if (!selectedUserId) return
    setLoadingAdding(true)
    try {
      const newMember = await usersApi.addProjectMember(projectId, selectedUserId, selectedRole)
      setMembers(prev => [...prev, newMember])
      setSelectedUserId('')
      toast('Member added')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoadingAdding(false)
    }
  }

  async function handleRemove(userId: string) {
    if (!confirm('Remove this member from the project?')) return
    try {
      await usersApi.removeProjectMember(projectId, userId)
      setMembers(prev => prev.filter(m => m.id !== userId))
      toast('Member removed')
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleUpdateRole(userId: string, role: string) {
    try {
      const updated = await usersApi.updateProjectMember(projectId, userId, role)
      setMembers(prev => prev.map(m => m.id === userId ? { ...m, member_role: updated.member_role } : m))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  if (loading) return <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: 20, textAlign: 'center' }}>Loading members...</div>

  const nonMembers = allUsers.filter(u => !members.find(m => m.id === u.id))
  const ROLE_COLOR: Record<string, string> = { admin: '#EF4444', member: '#6366F1', viewer: '#64748B' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {isAdmin && nonMembers.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 12, background: 'var(--bg-elev-2)', borderRadius: 8, border: '1px solid var(--line)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase' }}>Add Member</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <select 
              value={selectedUserId} 
              onChange={e => setSelectedUserId(e.target.value)}
              style={{ flex: 1, fontSize: 12.5, background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 8px', color: 'var(--fg)' }}
            >
              <option value="">Select user...</option>
              {nonMembers.map(u => <option key={u.id} value={u.id}>{u.username}</option>)}
            </select>
            <select 
              value={selectedRole} 
              onChange={e => setSelectedRole(e.target.value as 'admin' | 'member' | 'viewer')}
              style={{ fontSize: 12.5, background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '4px 8px', color: 'var(--fg)' }}
            >
              <option value="viewer">Viewer</option>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button 
              onClick={handleAdd} 
              disabled={!selectedUserId || adding}
              style={{ height: 28, padding: '0 12px', borderRadius: 5, border: 'none', background: 'var(--accent)', color: 'white', fontSize: 12, cursor: 'default', opacity: (!selectedUserId || adding) ? 0.6 : 1 }}
            >
              {adding ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {members.map(m => (
          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--line-2)' }}>
            <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--bg-elev-3)', display: 'grid', placeItems: 'center', fontSize: 10, fontWeight: 600, color: 'var(--fg-3)', border: '1px solid var(--line)' }}>
              {m.username.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)' }}>{m.username}</div>
              {m.email && <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{m.email}</div>}
            </div>
            {isAdmin ? (
              <select
                value={m.member_role}
                onChange={e => handleUpdateRole(m.id, e.target.value)}
                style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: `1px solid ${ROLE_COLOR[m.member_role]}40`, background: `${ROLE_COLOR[m.member_role]}12`, color: ROLE_COLOR[m.member_role], cursor: 'default' }}
              >
                <option value="admin">admin</option>
                <option value="member">member</option>
                <option value="viewer">viewer</option>
              </select>
            ) : (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: `1px solid ${ROLE_COLOR[m.member_role]}30`, color: ROLE_COLOR[m.member_role], textTransform: 'uppercase', fontWeight: 600 }}>
                {m.member_role}
              </span>
            )}
            {isAdmin && (
              <button onClick={() => handleRemove(m.id)} style={{ padding: '4px 6px', borderRadius: 4, border: 'none', background: 'none', color: 'var(--fg-4)', fontSize: 14, cursor: 'default' }}>✕</button>
            )}
          </div>
        ))}
        {members.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-4)', fontSize: 12 }}>
            No members found.
          </div>
        )}
      </div>
    </div>
  )
}

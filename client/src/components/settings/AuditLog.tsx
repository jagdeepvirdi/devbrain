import { useState, useEffect } from 'react'
import { auditApi, type AuditEvent } from '../../lib/api'
import { useToast } from '../Toast'

export function AuditLog() {
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

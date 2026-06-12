import { useState, useEffect, Fragment } from 'react'
import { useProjectStore } from '../store/projectStore'
import { notifyApi, type Notification } from '../lib/api'
import { useToast } from '../components/Toast'

export function NotificationLogPage() {
  const { projects } = useProjectStore()
  const { toast } = useToast()

  // Logs state
  const [items, setItems] = useState<Notification[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Pagination
  const [page, setPage] = useState(1)
  const limit = 20

  // Filters
  const [filterProject, setFilterProject] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [filterChannel, setFilterChannel] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterDateFrom, setFilterDateFrom] = useState('')
  const [filterDateTo, setFilterDateTo] = useState('')

  // Fetch log
  const fetchLogs = async () => {
    setLoading(true)
    try {
      const offset = (page - 1) * limit
      const res = await notifyApi.getLog({
        limit,
        offset,
        project: filterProject || undefined,
        level: filterLevel || undefined,
        channel: filterChannel || undefined,
        status: filterStatus || undefined,
        dateFrom: filterDateFrom || undefined,
        dateTo: filterDateTo || undefined,
      })
      setItems(res.items)
      setTotal(res.total)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Reload logs on filter change or page change
  useEffect(() => {
    fetchLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterProject, filterLevel, filterChannel, filterStatus, filterDateFrom, filterDateTo])

  // Handle retry
  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      toast('Retrying delivery...', 'info')
      const res = await notifyApi.retryNotification(id)
      if (res.success) {
        toast('Notification delivered successfully!', 'success')
        fetchLogs()
      } else {
        toast('Retry delivery failed.', 'error')
      }
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  // Toggle expand row
  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    setExpandedIds(next)
  }

  const clearFilters = () => {
    setFilterProject('')
    setFilterLevel('')
    setFilterChannel('')
    setFilterStatus('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(total / limit))

  const levelColor = (levelType: string) => {
    const cleanLevel = levelType.replace('external_', '')
    switch (cleanLevel) {
      case 'success': return { bg: 'rgba(74, 222, 128, 0.15)', fg: '#4ADE80' }
      case 'warning': return { bg: 'rgba(230, 195, 65, 0.15)', fg: '#E6C341' }
      case 'error':   return { bg: 'rgba(240, 90, 90, 0.15)', fg: '#F05A5A' }
      default:        return { bg: 'rgba(96, 165, 250, 0.15)', fg: '#60A5FA' }
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--fg)' }}>Notification Delivery Log</h1>
          <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--fg-4)' }}>Track and debug external notifications sent via Apprise</p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          style={{
            padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: '12.5px',
            background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
            color: 'var(--fg-2)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6
          }}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Filter Bar */}
      <div style={{ padding: '16px 24px', background: 'var(--panel)', borderBottom: '1px solid var(--line)', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
        {/* Project Filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Project</label>
          <select
            value={filterProject}
            onChange={e => { setFilterProject(e.target.value); setPage(1) }}
            style={{
              height: 28, minWidth: 140, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          >
            <option value="">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Level Filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Level</label>
          <select
            value={filterLevel}
            onChange={e => { setFilterLevel(e.target.value); setPage(1) }}
            style={{
              height: 28, minWidth: 100, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          >
            <option value="">All Levels</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        {/* Channel Filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Channel</label>
          <input
            type="text"
            placeholder="e.g. telegram"
            value={filterChannel}
            onChange={e => { setFilterChannel(e.target.value); setPage(1) }}
            style={{
              height: 28, maxWidth: 120, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          />
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Status</label>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
            style={{
              height: 28, minWidth: 100, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          >
            <option value="">All Statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        {/* Date range filters */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>From</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => { setFilterDateFrom(e.target.value); setPage(1) }}
            style={{
              height: 28, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.05em' }}>To</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => { setFilterDateTo(e.target.value); setPage(1) }}
            style={{
              height: 28, padding: '0 8px', borderRadius: 'var(--radius)',
              background: 'var(--bg)', border: '1px solid var(--line-2)', color: 'var(--fg)', fontSize: '12.5px'
            }}
          />
        </div>

        <button
          onClick={clearFilters}
          style={{
            alignSelf: 'flex-end', height: 28, padding: '0 12px', borderRadius: 'var(--radius)',
            border: '1px solid var(--line)', background: 'transparent', color: 'var(--fg-3)',
            fontSize: '12.5px', cursor: 'pointer', marginTop: 15
          }}
        >
          Reset
        </button>
      </div>

      {/* Table Area */}
      <div style={{ flex: 1, overflowY: 'auto', background: 'var(--bg)' }}>
        {items.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--fg-4)' }}>
            <span style={{ fontSize: '24px' }}>📭</span>
            <p style={{ margin: 0, fontSize: '13px' }}>No notifications found matching selected filters.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontWeight: 500 }}>
                <th style={{ width: '40px', padding: '10px 16px' }} />
                <th style={{ padding: '10px 16px' }}>Notification</th>
                <th style={{ padding: '10px 16px', width: '150px' }}>Project</th>
                <th style={{ padding: '10px 16px', width: '100px' }}>Level</th>
                <th style={{ padding: '10px 16px', width: '120px' }}>Channel</th>
                <th style={{ padding: '10px 16px', width: '100px' }}>Status</th>
                <th style={{ padding: '10px 16px', width: '160px' }}>Sent Time</th>
                <th style={{ padding: '10px 16px', width: '90px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isExpanded = expandedIds.has(item.id)
                const lvl = levelColor(item.type)
                const isFailed = item.delivery_status === 'failed'

                return (
                  <Fragment key={item.id}>
                    <tr
                      onClick={() => toggleExpand(item.id)}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: isExpanded ? 'var(--bg-elev)' : 'transparent',
                        cursor: 'pointer',
                        transition: 'background .15s'
                      }}
                      onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--bg-elev-2)' }}
                      onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '12px 16px', color: 'var(--fg-4)', fontSize: '11px', textAlign: 'center' }}>
                        {isExpanded ? '▼' : '▶'}
                      </td>
                      <td style={{ padding: '12px 16px', fontWeight: 500, color: 'var(--fg)' }}>
                        {item.title}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        {item.entity_type === 'project' && item.project_name ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11.5px', color: 'var(--fg-2)' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: item.project_color || '#ccc' }} />
                            {item.project_name}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--fg-4)', fontSize: '11.5px' }}>Global</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: '4px',
                          fontSize: '11px', fontWeight: 500,
                          background: lvl.bg, color: lvl.fg, textTransform: 'capitalize'
                        }}>
                          {item.type.replace('external_', '')}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', fontSize: '11.5px' }}>
                        {item.channel}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '12px' }}>
                          <span style={{ width: 7, height: 7, borderRadius: '50%', background: isFailed ? '#F05A5A' : '#4ADE80' }} />
                          <span style={{ color: isFailed ? '#F05A5A' : 'var(--fg-2)', textTransform: 'capitalize' }}>
                            {item.delivery_status}
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: 'var(--fg-3)', fontSize: '12px' }}>
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {isFailed && (
                          <button
                            onClick={(e) => handleRetry(item.id, e)}
                            style={{
                              padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                              background: 'var(--accent)', color: 'white', border: 'none',
                              cursor: 'pointer', transition: 'opacity .1s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = '0.9'}
                            onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                          >
                            Retry
                          </button>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)' }}>
                        <td />
                        <td colSpan={7} style={{ padding: '12px 16px 20px 16px' }}>
                          <div style={{
                            padding: '12px 16px', borderRadius: '6px',
                            background: 'var(--bg)', border: '1px solid var(--line-2)',
                            color: 'var(--fg-2)', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)',
                            fontSize: '12px', lineHeight: '1.6'
                          }}>
                            {item.body}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 24px', borderTop: '1px solid var(--line)', background: 'var(--panel)', flexShrink: 0 }}>
        <span style={{ fontSize: '12px', color: 'var(--fg-4)' }}>
          Showing {total === 0 ? 0 : (page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total} notifications
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: '12px',
              background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
              color: page === 1 ? 'var(--fg-4)' : 'var(--fg-2)', cursor: page === 1 ? 'not-allowed' : 'pointer'
            }}
          >
            Previous
          </button>
          <span style={{ display: 'inline-flex', alignItems: 'center', padding: '0 8px', fontSize: '12.5px', color: 'var(--fg-3)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{
              padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: '12px',
              background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
              color: page === totalPages ? 'var(--fg-4)' : 'var(--fg-2)', cursor: page === totalPages ? 'not-allowed' : 'pointer'
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  )
}

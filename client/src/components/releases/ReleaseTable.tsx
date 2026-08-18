import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { type Release } from '../../lib/api'
import { typeStyle, fmtDate, issueLabel } from './shared'

// ── ReleaseTable — sortable tabular view, alternative to the timeline ────────

type SortKey = 'version' | 'date' | 'type' | 'component'

export function ReleaseTable({ releases, showProject, onEdit, onDelete }: {
  releases: Release[]
  showProject: boolean
  onEdit: (r: Release) => void
  onDelete: (id: string) => void
}) {
  const navigate = useNavigate()
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = [...releases].sort((a, b) => {
    const cmp = sortKey === 'date'
      ? a.date.localeCompare(b.date)
      : String(a[sortKey] ?? '').localeCompare(String(b[sortKey] ?? ''))
    return sortDir === 'asc' ? cmp : -cmp
  })

  const thStyle: React.CSSProperties = { padding: '9px 12px', cursor: 'default', userSelect: 'none', whiteSpace: 'nowrap' }

  function SortableTh({ sortKeyName, label, width }: { sortKeyName: SortKey; label: string; width?: number }) {
    return (
      <th onClick={() => toggleSort(sortKeyName)} style={{ ...thStyle, width }}>
        {label} {sortKey === sortKeyName ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </th>
    )
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px', textAlign: 'left' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontWeight: 500 }}>
            <SortableTh sortKeyName="version" label="Version" width={190} />
            <SortableTh sortKeyName="date" label="Date" width={100} />
            <SortableTh sortKeyName="type" label="Type" width={80} />
            <SortableTh sortKeyName="component" label="Component" width={160} />
            {showProject && <th style={{ ...thStyle, width: 140 }}>Project</th>}
            <th style={{ ...thStyle, width: 160 }}>Case / Issue</th>
            <th style={thStyle}>Summary</th>
            <th style={{ ...thStyle, width: 110, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(r => {
            const ts = typeStyle(r.type)
            const summary = [
              r.features.length ? `${r.features.length} feature${r.features.length !== 1 ? 's' : ''}` : '',
              r.fixes.length ? `${r.fixes.length} fix${r.fixes.length !== 1 ? 'es' : ''}` : '',
              r.breaking_changes.length ? `${r.breaking_changes.length} breaking` : '',
            ].filter(Boolean).join(' · ') || r.notes || '—'
            return (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--line)' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--fg)' }}>{r.version}</td>
                <td style={{ padding: '8px 12px', color: 'var(--fg-3)', whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: 10, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}`, fontWeight: 600 }}>
                    {r.type}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--fg-2)' }}>{r.component ?? '—'}</td>
                {showProject && (
                  <td style={{ padding: '8px 12px' }}>
                    {r.project_name && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11px', color: 'var(--fg-3)' }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.project_color }} />
                        {r.project_name}
                      </span>
                    )}
                  </td>
                )}
                <td style={{ padding: '8px 12px' }}>
                  {r.linked_issues.length > 0 && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {r.linked_issues.map(id => {
                        const label = issueLabel(id, r.linked_issue_details)
                        return (
                          <button
                            key={id}
                            onClick={() => navigate('/issues?open=' + id)}
                            title={`Open issue ${id}${label !== `#${id.slice(0, 8)}` ? ` — ${label}` : ''}`}
                            style={{ fontSize: '10.5px', padding: '1px 6px', borderRadius: 4, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default' }}
                          >
                            {label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--fg-3)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={summary}>
                  {summary}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button onClick={() => onEdit(r)} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', marginRight: 4 }}>
                    Edit
                  </button>
                  {confirmId === r.id
                    ? <button onClick={() => { onDelete(r.id); setConfirmId(null) }} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>
                        Confirm
                      </button>
                    : <button onClick={() => setConfirmId(r.id)} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>
                        Delete
                      </button>
                  }
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

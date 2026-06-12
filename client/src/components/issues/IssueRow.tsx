import type { Issue } from '../../lib/api'
import { PRIORITY_META, STATUS_META } from './issueConstants'

export function IssueRow({ issue, onClick, selected, onToggleSelect, hasSelection }: {
  issue: Issue & { is_stale?: boolean }
  onClick: () => void
  selected?: boolean
  onToggleSelect?: (id: string) => void
  hasSelection?: boolean
}) {
  const pm = PRIORITY_META[issue.priority]
  const sm = STATUS_META[issue.status]
  const doneSteps = issue.investigation_steps.filter(s => s.done).length
  const total     = issue.investigation_steps.length

  return (
    <a
      href={`/issues?open=${issue.id}`}
      onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); onClick() } }}
      tabIndex={0}
      aria-label={`Open issue: ${issue.title}`}
      className={`bulk-select-row ${selected ? 'bulk-select-row-selected' : ''} ${hasSelection ? 'bulk-select-has-selection' : ''}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', cursor: 'default',
        borderBottom: '1px solid var(--line)',
        background: selected ? 'var(--accent-dim)' : 'transparent',
        transition: 'background .1s',
        textDecoration: 'none', color: 'inherit',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {onToggleSelect && (
        <input
          type="checkbox"
          className="bulk-select-checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect(issue.id)}
          onClick={e => e.stopPropagation()}
          style={{ flexShrink: 0, cursor: 'default', accentColor: 'var(--accent)', width: 14, height: 14 }}
        />
      )}

      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        minWidth: 82, fontSize: '11.5px', fontWeight: 500,
        color: pm.color, background: `${pm.color}18`,
        border: `1px solid ${pm.color}40`,
        borderRadius: 5, padding: '2px 7px',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: pm.color, flexShrink: 0 }} />
        {pm.label}
      </span>

      <span style={{ flex: 1, fontSize: '13px', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
        {issue.source !== 'devbrain' && (
          <span style={{ 
            fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', 
            padding: '1px 4px', borderRadius: 3, 
            background: issue.source === 'github' ? '#24292e' : issue.source === 'jira' ? '#0052cc' : '#5e6ad2',
            color: 'white', letterSpacing: '0.02em'
          }}>
            {issue.source}
          </span>
        )}
        {issue.title}
      </span>

      {total > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {doneSteps}/{total}
        </span>
      )}

      {issue.is_stale && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          fontSize: '11px', fontWeight: 600, color: 'var(--orange)',
          background: 'rgba(255,157,77,0.1)', border: '1px solid rgba(255,157,77,0.3)',
          borderRadius: 4, padding: '1px 5px', flexShrink: 0
        }}>
          Stale
        </span>
      )}

      <span style={{
        fontSize: '11.5px', color: sm.color,
        background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
        borderRadius: 5, padding: '2px 8px', flexShrink: 0,
      }}>
        {sm.label}
      </span>

      {issue.project_name && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: '11px', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: issue.project_color ?? 'var(--fg-4)' }} />
          {issue.project_name}
        </span>
      )}

      <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
        {new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </span>
    </a>
  )
}

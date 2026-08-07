import type { Command } from '../../lib/api'
import { LangBadge } from './CodeBlock'

export function CommandCard({ cmd, selected, onClick, onFavToggle, isChecked, onToggleSelect, hasSelection }: {
  cmd: Command
  selected: boolean
  onClick: () => void
  onFavToggle: (e: React.MouseEvent) => void
  isChecked: boolean
  onToggleSelect: (id: string) => void
  hasSelection: boolean
}) {
  const firstLine = cmd.command.split('\n')[0]

  return (
    <a
      href={`/commands?open=${cmd.id}`}
      onClick={e => { if (!e.ctrlKey && !e.metaKey) { e.preventDefault(); onClick() } }}
      className={`bulk-select-row ${isChecked ? 'bulk-select-row-selected' : ''} ${hasSelection ? 'bulk-select-has-selection' : ''}`}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        padding: '9px 10px', borderRadius: 6, cursor: 'default',
        background: selected ? 'var(--bg-elev-2)' : 'transparent',
        border: `1px solid ${selected ? 'var(--line-2)' : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
        <input
          type="checkbox"
          className="bulk-select-checkbox"
          checked={isChecked}
          onChange={e => {
            e.stopPropagation()
            onToggleSelect(cmd.id)
          }}
          onClick={e => e.stopPropagation()}
          style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14, flexShrink: 0, marginRight: 2 }}
        />
        <LangBadge lang={cmd.language} />
        <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {cmd.title}
        </span>
        {cmd.namespace === 'personal' && (
          <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: 'var(--accent-2)', flexShrink: 0, letterSpacing: '.03em' }}>
            personal
          </span>
        )}
        <button
          onClick={onFavToggle}
          aria-label={cmd.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={cmd.is_favorite}
          style={{
            fontSize: 13, flexShrink: 0,
            color: cmd.is_favorite ? '#F59E0B' : 'var(--fg-4)',
            background: 'none', border: 'none', padding: 0, lineHeight: 1,
          }}
        >
          {cmd.is_favorite ? '★' : '☆'}
        </button>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: cmd.description ? 3 : 0 }}>
        {firstLine}
      </div>
      {cmd.description && (
        <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cmd.description}
        </div>
      )}
      {cmd.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          {cmd.tags.slice(0, 5).map(t => (
            <span key={t} style={{ fontSize: '10px', padding: '0 5px', borderRadius: 3, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </a>
  )
}

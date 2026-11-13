import type { ReactNode } from 'react'

export function AnalyticsWidget({
  title, onRefresh, children,
}: { title: string; onRefresh?: () => void; children: ReactNode }) {
  return (
    <div style={{
      background: 'var(--bg-elev)', border: '1px solid var(--line)',
      borderRadius: 8, overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '11px 14px 10px', borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          {title}
        </span>
        {onRefresh && (
          <button
            onClick={onRefresh}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-4)', fontSize: 13, lineHeight: 1, padding: 2 }}
            title="Refresh"
          >↻</button>
        )}
      </div>
      <div style={{ padding: '14px' }}>{children}</div>
    </div>
  )
}

export function WidgetEmpty({ text }: { text: string }) {
  return (
    <div style={{ padding: '12px 0', textAlign: 'center', fontSize: '12px', color: 'var(--fg-4)' }}>
      {text}
    </div>
  )
}

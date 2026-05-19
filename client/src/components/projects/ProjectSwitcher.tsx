import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useProjectStore } from '../../store/projectStore'

type Props = { onNavigate: (page: string) => void }

export function ProjectSwitcher({ onNavigate }: Props) {
  const { projects, selectedId, setSelectedId } = useProjectStore()
  const selected = projects.find(p => p.id === selectedId) ?? null
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // Close on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  function pick(id: string | null) {
    setSelectedId(id)
    // Keep current path, update ?project= param
    const params = new URLSearchParams(location.search)
    // Strip page-specific params (open=) when switching project
    params.delete('open')
    if (id) params.set('project', id)
    else params.delete('project')
    navigate(`${location.pathname}?${params}`, { replace: true })
    setOpen(false)
  }

  const statusColors: Record<string, string> = {
    active:   'var(--green)',
    paused:   'var(--yellow)',
    planning: 'var(--fg-4)',
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          height: '26px', padding: '0 8px 0 10px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--line-2)',
          background: open ? 'var(--bg-hover)' : 'var(--bg-elev-2)',
          minWidth: '190px', maxWidth: '240px',
          cursor: 'default',
        }}
      >
        {selected ? (
          <>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: selected.color, flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--fg)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.name}
            </span>
          </>
        ) : (
          <>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--fg-4)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: '12.5px', color: 'var(--fg-3)', textAlign: 'left' }}>All Projects</span>
          </>
        )}
        <span style={{ color: 'var(--fg-4)', fontSize: '10px', flexShrink: 0 }}>▾</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: '6px',
          background: 'var(--bg-elev)',
          border: '1px solid var(--line-3)',
          borderRadius: '8px',
          boxShadow: '0 16px 40px rgba(0,0,0,.55)',
          zIndex: 50,
          minWidth: '260px',
          padding: '4px',
        }}>
          {/* All Projects */}
          <button
            onClick={() => pick(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '5px',
              width: '100%', textAlign: 'left',
              background: selectedId === null ? 'var(--bg-elev-2)' : 'transparent',
              fontSize: '12.5px', color: selectedId === null ? 'var(--fg)' : 'var(--fg-2)',
              cursor: 'default',
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--fg-4)' }} />
            <span style={{ flex: 1 }}>All Projects</span>
            {selectedId === null && <span style={{ color: 'var(--accent-2)', fontSize: '11px' }}>✓</span>}
          </button>

          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => pick(p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                padding: '8px 10px', borderRadius: '5px',
                width: '100%', textAlign: 'left',
                background: selectedId === p.id ? 'var(--bg-elev-2)' : 'transparent',
                fontSize: '12.5px', color: selectedId === p.id ? 'var(--fg)' : 'var(--fg-2)',
                cursor: 'default',
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: statusColors[p.status] }} />
                <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{p.short_name}</span>
              </span>
            </button>
          ))}

          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />

          <button
            onClick={() => { setOpen(false); onNavigate('projects') }}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 10px', borderRadius: '5px',
              width: '100%', textAlign: 'left',
              fontSize: '12px', color: 'var(--accent-2)',
              cursor: 'default',
            }}
          >
            <span>＋</span>
            <span>Manage projects</span>
          </button>
        </div>
      )}
    </div>
  )
}

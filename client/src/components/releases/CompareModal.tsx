import { useState, useEffect } from 'react'
import { releasesApi, type Release } from '../../lib/api'

// ── CompareModal ─────────────────────────────────────────────────────────────

export function CompareModal({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const [id1,     setId1]     = useState('')
  const [id2,     setId2]     = useState('')
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none', cursor: 'default' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function compare() {
    if (!id1 || !id2 || id1 === id2) return
    setLoading(true); setError(''); setSummary('')
    try {
      const { summary: s } = await releasesApi.compare(id1, id2)
      setSummary(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const canCompare = !!id1 && !!id2 && id1 !== id2 && !loading

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 560, maxHeight: '80vh', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-2)' }}>◆</span> Compare Releases
          </span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Selects */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Release A</label>
              <select value={id1} onChange={e => setId1(e.target.value)} style={inp}>
                <option value="">Select release…</option>
                {releases.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.version} · {r.type}{r.project_name ? ` · ${r.project_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Release B</label>
              <select value={id2} onChange={e => setId2(e.target.value)} style={inp}>
                <option value="">Select release…</option>
                {releases.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.version} · {r.type}{r.project_name ? ` · ${r.project_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {id1 && id2 && id1 === id2 && (
            <span style={{ fontSize: '12px', color: '#F59E0B' }}>Select two different releases to compare.</span>
          )}
          {error && <span style={{ fontSize: '12px', color: '#EF4444' }}>{error}</span>}

          <button
            onClick={compare}
            disabled={!canCompare}
            style={{
              alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 6,
              border: `1px solid ${canCompare ? 'var(--accent)' : 'var(--line)'}`,
              background: canCompare ? 'var(--accent)' : 'var(--bg-elev)',
              color: canCompare ? 'white' : 'var(--fg-4)',
              fontSize: '13px', cursor: canCompare ? 'default' : 'not-allowed',
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
              opacity: loading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 9 }}>◆</span>
            {loading ? 'Comparing…' : 'Compare'}
          </button>

          {summary && (
            <div style={{
              padding: '12px 14px', borderRadius: 7,
              border: '1px solid var(--line)', background: 'var(--bg)',
              fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.65, whiteSpace: 'pre-wrap',
            }}>
              {summary}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

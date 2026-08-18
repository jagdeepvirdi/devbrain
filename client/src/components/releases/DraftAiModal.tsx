import { useState } from 'react'
import { releasesApi, type ReleaseInput } from '../../lib/api'
import { today } from './shared'

// ── DraftAiModal ─────────────────────────────────────────────────────────────

export function DraftAiModal({ projectId, onClose, onDraft }: {
  projectId: string
  onClose: () => void
  onDraft: (draft: Partial<ReleaseInput>) => void
}) {
  const [from,      setFrom]      = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0]
  })
  const [to,        setTo]        = useState(today)
  const [drafting,  setDrafting]  = useState(false)
  const [error,     setError]     = useState('')

  async function handleDraft() {
    setDrafting(true)
    setError('')
    try {
      const draft = await releasesApi.draft({ projectId, from, to })
      onDraft(draft)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setDrafting(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 440, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>

        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-2)' }}>✦</span> Draft Release Notes with AI
          </span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--fg-3)', lineHeight: 1.5 }}>
            AI will look at resolved issues in the date range and draft release notes automatically.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                style={{ width: '100%', padding: '6px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box' }} />
            </div>
          </div>

          {error && <span style={{ fontSize: '12px', color: '#EF4444' }}>{error}</span>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
            <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>
              Cancel
            </button>
            <button
              onClick={handleDraft}
              disabled={drafting || !from || !to}
              style={{ padding: '6px 16px', borderRadius: 6, background: drafting ? 'var(--bg-elev-2)' : 'var(--accent)', color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'default', opacity: (drafting || !from || !to) ? .7 : 1 }}
            >
              {drafting ? 'Drafting…' : '✦ Draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

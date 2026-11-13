import { useState, useEffect, useCallback } from 'react'
import { activityApi } from '../../lib/api'
import type { ActivityDigest } from '../../lib/api'
import { AnalyticsWidget, WidgetEmpty } from './AnalyticsWidget'
import { addDays, mondayOf, shiftWeek, lastCompletedWeek } from '../../lib/weeks'

function fmtRange(week: string): string {
  const fmt = (iso: string) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${fmt(week)} – ${fmt(addDays(week, 6))}`   // Monday – Sunday
}

// ── UI ───────────────────────────────────────────────────────────────────────

const SECTIONS: { key: 'highlights' | 'features' | 'fixes' | 'risks'; label: string; color: string }[] = [
  { key: 'highlights', label: 'Highlights', color: '#818CF8' },
  { key: 'features',   label: 'Features',   color: '#22C55E' },
  { key: 'fixes',      label: 'Fixes',      color: '#60A5FA' },
  { key: 'risks',      label: 'Risks',      color: '#F59E0B' },
]

const navBtn = (disabled: boolean) => ({
  background: 'none', border: '1px solid var(--line)', borderRadius: 4, padding: '1px 8px',
  color: disabled ? 'var(--fg-4)' : 'var(--fg-2)', cursor: disabled ? 'default' : 'pointer',
  fontSize: 13, lineHeight: 1.4, opacity: disabled ? 0.5 : 1,
}) as const

function DigestRow({ d, open, onToggle, canToggle }: {
  d: ActivityDigest; open: boolean; onToggle: () => void; canToggle: boolean
}) {
  const { stats, summary } = d
  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <button
        onClick={onToggle}
        disabled={!canToggle}
        aria-expanded={open}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', background: 'none', border: 'none',
          padding: 0, textAlign: 'left', cursor: canToggle ? 'pointer' : 'default', color: 'var(--fg)',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: '12.5px', fontWeight: 600 }}>{d.project_name}</span>
        <span style={{ fontSize: '11px', color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
          {d.commit_count} commit{d.commit_count === 1 ? '' : 's'}
        </span>
        <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)' }}>
          <span style={{ color: '#22C55E' }}>+{stats.insertions}</span>{' '}
          <span style={{ color: '#EF4444' }}>-{stats.deletions}</span>
        </span>
      </button>

      {summary.summary && (
        <p style={{ margin: '6px 0 0 16px', fontSize: '12px', color: 'var(--fg-3)', lineHeight: 1.5 }}>{summary.summary}</p>
      )}

      {open && (
        <div style={{ margin: '8px 0 0 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {SECTIONS.filter(s => summary[s.key].length > 0).map(s => (
            <div key={s.key}>
              <div style={{ fontSize: '10.5px', fontWeight: 700, color: s.color, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {s.label}
              </div>
              <ul style={{ margin: '3px 0 0', paddingLeft: 16, fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.5 }}>
                {summary[s.key].map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          ))}
          <div style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
            {stats.files_changed} file{stats.files_changed === 1 ? '' : 's'} changed
            {d.branches.length > 0 && <> · branches: {d.branches.join(', ')}</>}
            {d.model && <> · {d.model}</>}
          </div>
        </div>
      )}
    </div>
  )
}

type Loaded = { key: string; rows: ActivityDigest[] } | { key: string; error: string }

export function WeeklyGitDigest({ projectId }: { projectId?: string | null }) {
  const currentWeek = mondayOf(new Date().toISOString().slice(0, 10))
  const [week, setWeek]         = useState(() => lastCompletedWeek())
  const [reload, setReload]     = useState(0)
  const [loaded, setLoaded]     = useState<Loaded | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [generating, setGenerating] = useState(false)
  const [genNote, setGenNote]   = useState<{ kind: 'error' | 'info'; text: string } | null>(null)

  // Result is tagged with the request it answers, so "loading" is derived (no synchronous
  // setState in the effect, and a stale response can never overwrite a newer week).
  const key = `${week}|${projectId ?? ''}|${reload}`
  useEffect(() => {
    let cancelled = false
    activityApi.digest(week, projectId)
      .then(rows => { if (!cancelled) setLoaded({ key, rows }) })
      .catch(e => { if (!cancelled) setLoaded({ key, error: (e as Error).message }) })
    return () => { cancelled = true }
  }, [week, projectId, key])

  const loading = loaded?.key !== key

  const generate = useCallback(async () => {
    setGenerating(true)
    setGenNote(null)
    try {
      const res = await activityApi.generateDigest(week, projectId)
      if (res.errors.length) {
        setGenNote({ kind: 'error', text: res.errors.map(e => `${e.project}: ${e.error}`).join(' · ') })
      } else if (res.digests.length === 0) {
        setGenNote({ kind: 'info', text: 'No projects with a linked folder — use Projects → Link folder.' })
      }
      setReload(n => n + 1)
    } catch (e) {
      setGenNote({ kind: 'error', text: (e as Error).message })
    } finally {
      setGenerating(false)
    }
  }, [week, projectId])

  const rows = loaded && 'rows' in loaded && !loading ? loaded.rows : []
  const totalCommits = rows.reduce((n, r) => n + r.commit_count, 0)
  const toggle = (id: string) =>
    setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })

  return (
    <AnalyticsWidget title="Weekly Git Digest">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <button aria-label="Previous week" style={navBtn(false)} onClick={() => setWeek(w => shiftWeek(w, -1))}>‹</button>
        <span style={{ fontSize: '12px', color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', minWidth: 110, textAlign: 'center' }}>
          {fmtRange(week)}
        </span>
        <button
          aria-label="Next week" style={navBtn(week >= currentWeek)} disabled={week >= currentWeek}
          onClick={() => setWeek(w => shiftWeek(w, 1))}
        >›</button>
        <span style={{ flex: 1 }} />
        <button
          onClick={generate} disabled={generating}
          style={{
            fontSize: '10.5px', padding: '2px 9px', borderRadius: 4, cursor: generating ? 'default' : 'pointer',
            background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)',
          }}
        >
          {generating ? 'Generating…' : rows.length ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {genNote && (
        <div role="status" style={{ fontSize: '11.5px', marginBottom: 8, color: genNote.kind === 'error' ? '#EF4444' : 'var(--fg-3)' }}>
          {genNote.text}
        </div>
      )}

      {loading ? (
        <WidgetEmpty text="Loading…" />
      ) : loaded && 'error' in loaded ? (
        <WidgetEmpty text={loaded.error} />
      ) : rows.length === 0 ? (
        <WidgetEmpty text="No digest for this week yet — generate one, or the weekly job will create it." />
      ) : (
        <>
          {!projectId && (
            <div style={{ fontSize: '11px', color: 'var(--fg-4)', marginBottom: 2 }}>
              {totalCommits} commit{totalCommits === 1 ? '' : 's'} across {rows.length} project{rows.length === 1 ? '' : 's'}
            </div>
          )}
          {rows.map(d => (
            <DigestRow
              key={d.id} d={d}
              open={Boolean(projectId) || expanded.has(d.id)}
              canToggle={!projectId}
              onToggle={() => toggle(d.id)}
            />
          ))}
        </>
      )}
    </AnalyticsWidget>
  )
}

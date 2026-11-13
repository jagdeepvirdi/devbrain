import { useState, useEffect, useCallback } from 'react'
import { timeApi } from '../../lib/api'
import type { TimeReport, TimeReportRow, TimeSource, TimeImportResult } from '../../lib/api'
import { fmtDuration } from '../../lib/duration'
import { addDays } from '../../lib/weeks'
import { AnalyticsWidget, WidgetEmpty } from './AnalyticsWidget'
import { TimeMappingRules } from './TimeMappingRules'

const SOURCE_LABEL: Record<TimeSource, string> = {
  'activitywatch': 'ActivityWatch', 'claude-session': 'Sessions', 'git-estimate': 'Git estimate',
}
const UNASSIGNED_COLOR = '#64748B'

function localToday(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function summarizeImport(r: TimeImportResult): { kind: 'error' | 'info'; text: string } {
  const parts: string[] = []
  let failed = false
  if (r.activitywatch) {
    if ('error' in r.activitywatch) { failed = true; parts.push(r.activitywatch.error) }
    else parts.push(`ActivityWatch: ${r.activitywatch.entries} entr${r.activitywatch.entries === 1 ? 'y' : 'ies'}`)
  }
  for (const key of ['claude-session', 'git-estimate'] as const) {
    const list = r[key]
    if (!list) continue
    const errs = list.filter(p => p.error)
    if (errs.length) { failed = true; parts.push(errs.map(e => `${e.project}: ${e.error}`).join(' · ')) }
    const hours = list.reduce((n, p) => n + (p.hours ?? 0), 0)
    parts.push(`${SOURCE_LABEL[key]}: ${hours}h`)
  }
  return { kind: failed ? 'error' : 'info', text: parts.join(' · ') }
}

type Loaded = { key: string; report: TimeReport } | { key: string; error: string }

export function TimeTracked({ projectId, projects }: {
  projectId?: string | null
  projects: { id: string; name: string }[]
}) {
  const [days, setDays]       = useState(7)
  const [reload, setReload]   = useState(0)
  const [loaded, setLoaded]   = useState<Loaded | null>(null)
  const [importing, setImporting] = useState(false)
  const [note, setNote]       = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [showRules, setShowRules] = useState(false)

  const key = `${days}|${projectId ?? ''}|${reload}`
  useEffect(() => {
    let cancelled = false
    const to = localToday()
    timeApi.report(addDays(to, -(days - 1)), to, projectId)
      .then(report => { if (!cancelled) setLoaded({ key, report }) })
      .catch(e => { if (!cancelled) setLoaded({ key, error: (e as Error).message }) })
    return () => { cancelled = true }
  }, [days, projectId, key])

  const loading = loaded?.key !== key
  const refresh = useCallback(() => setReload(n => n + 1), [])

  async function runImport() {
    setImporting(true)
    setNote(null)
    try { setNote(summarizeImport(await timeApi.import())); refresh() }
    catch (e) { setNote({ kind: 'error', text: (e as Error).message }) }
    finally { setImporting(false) }
  }

  const report = loaded && 'report' in loaded && !loading ? loaded.report : null
  const rows: TimeReportRow[] = report?.rows ?? []
  const total = rows.reduce((n, r) => n + r.seconds, 0)

  // All-projects view: one bar per project (summed over the range). Project view: one bar per day.
  const bars = projectId
    ? rows.map(r => ({ id: r.period, label: r.period.slice(5), color: r.color ?? 'var(--accent)', seconds: r.seconds, sources: r.sources }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [...rows.reduce((m, r) => {
        const id = r.project_id ?? '__unassigned'
        const cur = m.get(id) ?? { id, label: r.project_name ?? 'Unassigned', color: r.color ?? UNASSIGNED_COLOR, seconds: 0, sources: new Set<TimeSource>() }
        cur.seconds += r.seconds
        r.sources.forEach(s => cur.sources.add(s))
        return m.set(id, cur)
      }, new Map<string, { id: string; label: string; color: string; seconds: number; sources: Set<TimeSource> }>()).values()]
        .map(b => ({ ...b, sources: [...b.sources] }))
        .sort((a, b) => b.seconds - a.seconds)
  const max = Math.max(...bars.map(b => b.seconds), 1)

  return (
    <AnalyticsWidget title="Time Tracked">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {[7, 30].map(n => (
          <button key={n} onClick={() => setDays(n)} aria-pressed={days === n}
            style={{
              fontSize: '11px', padding: '1px 8px', borderRadius: 4, cursor: 'pointer',
              background: days === n ? 'rgba(99,102,241,0.15)' : 'none',
              color: days === n ? 'var(--accent)' : 'var(--fg-3)', border: '1px solid var(--line)',
            }}>{n}d</button>
        ))}
        <span style={{ flex: 1, fontSize: '11px', color: 'var(--fg-4)', textAlign: 'right' }}>
          {report && `${fmtDuration(total)} total`}
        </span>
        <button onClick={() => setShowRules(s => !s)} aria-expanded={showRules}
          style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: 4, cursor: 'pointer', background: 'none', color: 'var(--fg-3)', border: '1px solid var(--line)' }}>
          Rules
        </button>
        <button onClick={runImport} disabled={importing}
          style={{
            fontSize: '10.5px', padding: '2px 9px', borderRadius: 4, cursor: importing ? 'default' : 'pointer',
            background: 'rgba(99,102,241,0.1)', color: 'var(--accent)', border: '1px solid rgba(99,102,241,0.3)',
          }}>{importing ? 'Importing…' : 'Import'}</button>
      </div>

      {note && (
        <div role="status" style={{ fontSize: '11.5px', marginBottom: 8, color: note.kind === 'error' ? '#EF4444' : 'var(--fg-3)' }}>
          {note.text}
        </div>
      )}

      {loading ? <WidgetEmpty text="Loading…" />
        : loaded && 'error' in loaded ? <WidgetEmpty text={loaded.error} />
        : bars.length === 0 ? <WidgetEmpty text="No time recorded yet — click Import (git history and sessions work without ActivityWatch)." />
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bars.map(b => (
              <div key={b.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: '12px' }}>
                  <span style={{ flex: 1, color: 'var(--fg)' }}>{b.label}</span>
                  <span style={{ color: 'var(--fg-4)', fontSize: '10.5px' }}>
                    {b.sources.map(s => SOURCE_LABEL[s]).join(' · ')}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-2)' }}>{fmtDuration(b.seconds)}</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--bg)', marginTop: 3 }}>
                  <div style={{ width: `${(b.seconds / max) * 100}%`, height: '100%', borderRadius: 3, background: b.color }} />
                </div>
              </div>
            ))}
          </div>
        )}

      {report && report.by_source.length > 0 && (
        <div style={{ fontSize: '10.5px', color: 'var(--fg-4)', marginTop: 10 }}>
          Each project-day uses its best source. Raw: {report.by_source.map(s => `${SOURCE_LABEL[s.source]} ${fmtDuration(s.seconds)}`).join(' · ')}
        </div>
      )}

      {showRules && <TimeMappingRules projects={projects} onChanged={refresh} />}
    </AnalyticsWidget>
  )
}

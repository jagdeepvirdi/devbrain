import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { claudeProjectsApi, type SessionDetailData, type SessionStatus, type SessionSummaryData } from '../../lib/api'

interface Props {
  projectId: string
}

// ── Markdown renderer (sections-aware, no deps) ───────────────────────────────

function MarkdownView({ raw }: { raw: string }) {
  // Strip YAML frontmatter
  const body = raw.replace(/^---[\s\S]*?---\n?/, '').trim()

  const nodes: React.ReactNode[] = []
  let listItems: string[] = []
  let inList = false

  function flushList(key: string) {
    if (listItems.length === 0) return
    nodes.push(
      <ul key={`ul-${key}`} style={{ margin: '4px 0 8px 16px', padding: 0, listStyle: 'disc' }}>
        {listItems.map((t, i) => (
          <li key={i} style={{ fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>{t}</li>
        ))}
      </ul>
    )
    listItems = []
    inList = false
  }

  body.split('\n').forEach((line, i) => {
    const key = String(i)

    if (/^# /.test(line)) {
      flushList(key)
      nodes.push(
        <p key={key} style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--fg)' }}>
          {line.slice(2)}
        </p>
      )
      return
    }

    if (/^## /.test(line)) {
      flushList(key)
      const name = line.slice(3)
      if (/Session Ended/i.test(name)) return
      nodes.push(
        <p key={key} style={{ margin: '10px 0 4px', fontSize: 11, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {name}
        </p>
      )
      return
    }

    if (/^ended:/.test(line)) return

    if (/^[-*]\s/.test(line)) {
      inList = true
      listItems.push(line.slice(2).trim())
      return
    }

    if (inList) flushList(key)

    if (line.trim() === '') {
      nodes.push(<div key={key} style={{ height: 4 }} />)
      return
    }

    nodes.push(
      <p key={key} style={{ margin: '2px 0', fontSize: 12, color: 'var(--fg-3)', lineHeight: 1.6 }}>
        {line}
      </p>
    )
  })
  flushList('end')

  return <div>{nodes}</div>
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function weekLabel(dateStr: string): string {
  if (!dateStr) return 'Unknown week'
  const d = new Date(dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return 'Unknown week'
  // Find Monday of the week
  const day = d.getDay() // 0=Sun
  const monday = new Date(d)
  monday.setDate(d.getDate() - ((day + 6) % 7))
  return `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function groupByWeek(sessions: SessionSummaryData[]): { label: string; items: SessionSummaryData[] }[] {
  const map = new Map<string, SessionSummaryData[]>()
  for (const s of sessions) {
    const label = weekLabel(s.date)
    if (!map.has(label)) map.set(label, [])
    map.get(label)!.push(s)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00')
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

// ── Session card ──────────────────────────────────────────────────────────────

interface CardProps {
  session:        SessionSummaryData
  projectId:      string
  expanded:       boolean
  onToggle:       () => void
}

function SessionCard({ session, projectId, expanded, onToggle }: CardProps) {
  const [detail, setDetail]   = useState<SessionDetailData | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!expanded || detail) return
    setLoading(true)
    claudeProjectsApi.getSession(projectId, session.sessionId)
      .then(d  => { setDetail(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [expanded, projectId, session.sessionId, detail])

  const isActive = session.status === 'active'

  return (
    <div style={{
      border: `1px solid ${expanded ? 'rgba(99,102,241,.35)' : 'var(--line)'}`,
      borderRadius: 8,
      background: expanded ? 'rgba(99,102,241,.04)' : 'var(--bg-elev)',
      overflow: 'hidden',
      transition: 'border-color 0.15s',
    }}>
      {/* Header row */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, color: 'var(--fg-4)', flexShrink: 0 }}>
          {expanded ? '▾' : '▸'}
        </span>

        {/* Date + time */}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg)', flexShrink: 0 }}>
          {fmtDate(session.date)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0 }}>
          {fmtTime(session.started)}
        </span>

        {/* Status badge */}
        <span style={{
          display: 'inline-flex', alignItems: 'center', height: 16, padding: '0 6px',
          borderRadius: 3, fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em',
          color:       isActive ? '#86EFAC' : 'var(--fg-4)',
          background:  isActive ? 'rgba(74,222,128,.1)' : 'var(--bg-elev-2)',
          border:      `1px solid ${isActive ? 'rgba(74,222,128,.25)' : 'var(--line)'}`,
          flexShrink: 0,
        }}>
          {isActive ? 'ACTIVE' : 'DONE'}
        </span>

        {/* Goals preview */}
        {session.goals.length > 0 && (
          <span style={{ flex: 1, fontSize: 11.5, color: 'var(--fg-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.goals[0]}{session.goals.length > 1 ? ` +${session.goals.length - 1}` : ''}
          </span>
        )}

        {/* Work done count */}
        {session.workDoneCount > 0 && (
          <span style={{ fontSize: 11, color: 'var(--fg-4)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
            {session.workDoneCount} done
          </span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--line)' }}>
          {loading && (
            <p style={{ fontSize: 12, color: 'var(--fg-4)', padding: '10px 0' }}>Loading…</p>
          )}
          {!loading && detail && (
            <div style={{ paddingTop: 10 }}>
              <MarkdownView raw={detail.rawMarkdown} />
            </div>
          )}
          {!loading && !detail && (
            <p style={{ fontSize: 12, color: '#F8A8A8', paddingTop: 10 }}>Failed to load session detail.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SessionsTab({ projectId }: Props) {
  const [sessions, setSessions] = useState<SessionSummaryData[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<'all' | SessionStatus>('all')
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const searchRef               = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    claudeProjectsApi.getSessions(projectId)
      .then(page => { setSessions(page.sessions); setLoading(false) })
      .catch(err  => { setError((err as Error).message); setLoading(false) })
  }, [projectId])

  const filtered = useMemo(() => {
    let list = sessions
    if (filter !== 'all') list = list.filter(s => s.status === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(s =>
        s.goals.some(g => g.toLowerCase().includes(q)) ||
        s.workDone.some(w => w.toLowerCase().includes(q)) ||
        s.decisions.some(d => d.toLowerCase().includes(q)) ||
        s.openItems.some(o => o.toLowerCase().includes(q)) ||
        s.folderName.toLowerCase().includes(q)
      )
    }
    return list
  }, [sessions, filter, search])

  const weeks = useMemo(() => groupByWeek(filtered), [filtered])

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 0' }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>Loading sessions…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ borderRadius: 6, background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', padding: '12px 14px', fontSize: 12.5, color: '#F8A8A8' }}>
        {error}
      </div>
    )
  }

  if (sessions.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 0', gap: 8, color: 'var(--fg-4)' }}>
        <span style={{ fontSize: 24 }}>🗂</span>
        <p style={{ margin: 0, fontSize: 12.5 }}>No sessions found in the linked project folder.</p>
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-4)', opacity: 0.6 }}>
          Sessions are created by the Claude Code hooks in <code>sessions/</code>.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Filter tabs */}
        {(['all', 'active', 'completed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              height: 24, padding: '0 10px', borderRadius: 'var(--radius)',
              border:     `1px solid ${filter === f ? 'rgba(99,102,241,.4)' : 'var(--line)'}`,
              background: filter === f ? 'rgba(99,102,241,.15)' : 'var(--bg-elev)',
              color:      filter === f ? '#818CF8' : 'var(--fg-3)',
              fontSize: 11.5, cursor: 'pointer',
            }}
          >
            {f === 'all' ? `All (${sessions.length})` : f === 'active' ? 'Active' : 'Completed'}
          </button>
        ))}

        {/* Search */}
        <input
          ref={searchRef}
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sessions…"
          style={{
            flex: 1, height: 24, padding: '0 8px', borderRadius: 'var(--radius)',
            border: '1px solid var(--line)', background: 'var(--bg-elev)',
            color: 'var(--fg)', fontSize: 11.5, outline: 'none',
          }}
        />
      </div>

      {/* No results */}
      {filtered.length === 0 && (
        <p style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '16px 0', textAlign: 'center' }}>
          No sessions match.
        </p>
      )}

      {/* Week groups */}
      {weeks.map(week => (
        <div key={week.label}>
          <p style={{ margin: '8px 0 6px', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {week.label}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {week.items.map(s => (
              <SessionCard
                key={s.sessionId}
                session={s}
                projectId={projectId}
                expanded={expanded.has(s.sessionId)}
                onToggle={() => toggleExpand(s.sessionId)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

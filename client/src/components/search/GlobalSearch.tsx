import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { searchApi, commandsApi } from '../../lib/api'
import type { SearchResult, SearchResults, SearchSuggestion } from '../../lib/api'
import { useProjectStore } from '../../store/projectStore'
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed'

type RouteId = 'dashboard' | 'docs' | 'chat' | 'issues' | 'tasks' | 'commands' | 'releases' | 'runbooks' | 'projects' | 'aitask' | 'settings'

interface Props {
  onNavigate: (route: RouteId) => void
  open: boolean
  onClose: () => void
}

const TYPE_META: Record<string, { icon: string; label: string; route: RouteId; color: string }> = {
  doc:     { icon: '📄', label: 'Documents', route: 'docs',     color: '#60A5FA' },
  issue:   { icon: '⚠',  label: 'Issues',    route: 'issues',   color: '#FF9D4D' },
  command: { icon: '>',  label: 'Commands',  route: 'commands', color: '#2ECC71' },
  release: { icon: '🏷', label: 'Releases',  route: 'releases', color: '#818CF8' },
  runbook: { icon: '▶',  label: 'Runbooks',  route: 'runbooks', color: '#F59E0B' },
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: '#F05A5A', high: '#FF9D4D', medium: '#E6C341', low: '#60A5FA',
}

const LANG_COLOR: Record<string, string> = {
  bash: '#2ECC71', powershell: '#8B5CF6', python: '#3B82F6',
  typescript: '#818CF8', javascript: '#FBBF24', dart: '#06B6D4',
  sql: '#F59E0B', yaml: '#EC4899', plaintext: '#64748B',
}

const RECENT_ROUTE: Record<string, string> = {
  issue: 'issues', command: 'commands', document: 'docs', runbook: 'runbooks',
}

export function GlobalSearch({ onNavigate, open, onClose }: Props) {
  const { projects, selectedProject } = useProjectStore()
  const currProject = selectedProject()
  const navigate = useNavigate()
  const { getRecent } = useRecentlyViewed()

  const [query,        setQuery]        = useState('')
  const [results,      setResults]      = useState<SearchResults | null>(null)
  const [loading,      setLoading]      = useState(false)
  const [selIdx,       setSelIdx]       = useState(0)
  const [copiedId,     setCopiedId]     = useState<string | null>(null)
  const [scopeProject, setScopeProject] = useState<string | null>(null)
  const [limit,        setLimit]        = useState(10)
  const [suggestions,  setSuggestions]  = useState<SearchSuggestion[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef  = useRef<HTMLDivElement>(null)

  const recentItems = open && !query ? getRecent() : []

  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(null)
      setSelIdx(0)
      setCopiedId(null)
      setScopeProject(currProject?.id ?? null)
      setLimit(10)
      setSuggestions([])
      setTimeout(() => inputRef.current?.focus(), 30)
      // Load suggestions on open
      searchApi.suggestions(currProject?.id ?? null)
        .then(setSuggestions)
        .catch(() => {})
    }
  }, [open, currProject?.id])

  const doSearch = useCallback(async (q: string, pid: string | null, lim: number) => {
    setLoading(true)
    try {
      const data = await searchApi.search(q, pid, lim)
      setResults(data)
      setSelIdx(0)
    } catch {
      setResults(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => doSearch(query, scopeProject, limit), query ? 250 : 0)
    return () => clearTimeout(t)
  }, [query, scopeProject, limit, open, doSearch])

  // Flatten for keyboard nav (groups: docs, issues, commands, releases, runbooks)
  const groups: { type: string; items: SearchResult[] }[] = results
    ? [
        { type: 'doc',     items: results.docs     },
        { type: 'issue',   items: results.issues   },
        { type: 'command', items: results.commands  },
        { type: 'release', items: results.releases  },
        { type: 'runbook', items: results.runbooks  },
      ].filter(g => g.items.length > 0)
    : []

  // Pre-compute start indices for each group
  let counter = 0
  const groupsWithStart = groups.map(g => {
    const start = counter
    counter += g.items.length
    return { ...g, start }
  })
  const flat = groupsWithStart.flatMap(g => g.items)
  const totalCount = flat.length

  function handleSelect(result: SearchResult) {
    if (result.type === 'command') {
      navigator.clipboard.writeText(result.body ?? result.title).then(() => {
        commandsApi.use(result.id).catch(() => {})
        setCopiedId(result.id)
        setTimeout(() => { setCopiedId(null); onClose() }, 900)
      })
      return
    }
    onNavigate(TYPE_META[result.type].route)
    onClose()
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx(i => Math.min(i + 1, totalCount - 1)) }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelIdx(i => Math.max(i - 1, 0)) }
    if (e.key === 'Enter' && flat[selIdx]) { e.preventDefault(); handleSelect(flat[selIdx]) }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${selIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  if (!open) return null

  return (
    <div
      className="modal-overlay"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '12vh', zIndex: 200, backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        className="modal-panel"
        onClick={e => e.stopPropagation()}
        style={{ width: 620, background: 'var(--panel)', border: '1px solid var(--line-2)', borderRadius: 10, boxShadow: '0 32px 80px rgba(0,0,0,.7)', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '72vh' }}
      >
        {/* Search input */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ fontSize: 14, color: 'var(--fg-3)', flexShrink: 0 }}>⌘</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search across docs, issues, commands, releases, runbooks…"
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--fg)', fontSize: '14px', outline: 'none' }}
          />
          {loading && <span style={{ fontSize: '12px', color: 'var(--fg-4)' }}>…</span>}
          <kbd style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', padding: '1px 5px', border: '1px solid var(--line-2)', borderBottomWidth: 2, borderRadius: 4, background: 'var(--bg)' }}>
            Esc
          </kbd>
        </div>

        {/* Scope chips */}
        <div style={{ padding: '6px 12px', display: 'flex', gap: 5, alignItems: 'center', borderBottom: '1px solid var(--line)', flexShrink: 0, overflowX: 'auto' }}>
          <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', flexShrink: 0 }}>Scope:</span>
          <button
            onClick={() => setScopeProject(null)}
            aria-pressed={!scopeProject}
            style={{
              fontSize: '10.5px', padding: '2px 8px', borderRadius: 10, flexShrink: 0,
              border: `1px solid ${!scopeProject ? 'var(--accent)' : 'var(--line)'}`,
              background: !scopeProject ? 'var(--accent-dim)' : 'transparent',
              color: !scopeProject ? 'var(--accent-2)' : 'var(--fg-3)',
            }}
          >
            All
          </button>
          {projects.map(p => (
            <button
              key={p.id}
              onClick={() => setScopeProject(scopeProject === p.id ? null : p.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: '10.5px', padding: '2px 8px', borderRadius: 10, cursor: 'default', flexShrink: 0,
                border: `1px solid ${scopeProject === p.id ? p.color + '80' : 'var(--line)'}`,
                background: scopeProject === p.id ? p.color + '20' : 'transparent',
                color: scopeProject === p.id ? p.color : 'var(--fg-3)',
              }}
            >
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
              {p.name}
            </button>
          ))}
        </div>

        {/* Results */}
        <div ref={listRef} data-search-results role="listbox" style={{ overflowY: 'auto', flex: 1 }}>
          {results === null && !loading && recentItems.length === 0 && suggestions.length === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center', fontSize: '13px', color: 'var(--fg-4)' }}>
              Start typing to search
            </div>
          )}

          {results === null && !loading && !query && suggestions.length > 0 && recentItems.length === 0 && (
            <div>
              <div style={{ padding: '8px 14px 3px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--accent-2)' }}>
                  ✦ Suggestions
                </span>
              </div>
              {suggestions.map(s => (
                <div
                  key={`${s.type}-${s.id}`}
                  onClick={() => {
                    navigate(`/${s.type === 'issue' ? 'issues' : 'docs'}?open=${s.id}`)
                    onClose()
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', cursor: 'default' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev-2)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ width: 20, textAlign: 'center', fontSize: '11px', color: s.type === 'issue' ? '#FF9D4D' : '#60A5FA', flexShrink: 0 }}>
                    {s.type === 'issue' ? '⚠' : '📄'}
                  </span>
                  {s.project_color && <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.project_color, flexShrink: 0 }} />}
                  <span style={{ flex: 1, fontSize: '13px', color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </span>
                  {s.project_name && <span style={{ fontSize: '11px', color: 'var(--fg-4)', flexShrink: 0 }}>{s.project_name}</span>}
                </div>
              ))}
            </div>
          )}

          {results === null && !loading && recentItems.length > 0 && (
            <div>
              <div style={{ padding: '8px 14px 3px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--fg-4)' }}>
                  Recently Viewed
                </span>
              </div>
              {recentItems.map(item => {
                const typeColor = TYPE_META[item.type === 'document' ? 'doc' : item.type]?.color ?? 'var(--fg-4)'
                const typeIcon  = TYPE_META[item.type === 'document' ? 'doc' : item.type]?.icon ?? '·'
                return (
                  <div
                    key={`${item.type}-${item.id}`}
                    onClick={() => {
                      navigate(`/${RECENT_ROUTE[item.type] ?? ''}?open=${item.id}`)
                      onClose()
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 14px', cursor: 'default',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elev-2)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <span style={{ width: 20, textAlign: 'center', fontSize: '11px', color: typeColor, flexShrink: 0 }}>{typeIcon}</span>
                    {item.projectColor && <span style={{ width: 5, height: 5, borderRadius: '50%', background: item.projectColor, flexShrink: 0 }} />}
                    <span style={{ flex: 1, fontSize: '13px', color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    {item.projectName && <span style={{ fontSize: '11px', color: 'var(--fg-4)', flexShrink: 0 }}>{item.projectName}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {results !== null && totalCount === 0 && (
            <div style={{ padding: '36px 20px', textAlign: 'center', fontSize: '13px', color: 'var(--fg-4)' }}>
              No results for <em>"{query}"</em>
            </div>
          )}

          {groupsWithStart.map(({ type, items, start }) => {
            const meta = TYPE_META[type]
            return (
              <div key={type}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '8px 14px 3px',
                  borderTop: start > 0 ? '1px solid var(--line)' : 'none',
                }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: meta.color }}>
                    {meta.label}
                  </span>
                  <span style={{ fontSize: '10px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                    {items.length}
                  </span>
                </div>

                {items.map((result, localI) => {
                  const idx = start + localI
                  const isSelected = idx === selIdx

                  return (
                    <div
                      key={result.id}
                      data-idx={idx}
                      onClick={() => { setSelIdx(idx); handleSelect(result) }}
                      onMouseEnter={() => setSelIdx(idx)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 14px', cursor: 'default',
                        background: isSelected ? 'var(--bg-elev-2)' : 'transparent',
                      }}
                    >
                      {/* Type icon */}
                      <span style={{ width: 20, textAlign: 'center', fontSize: '11px', color: meta.color, flexShrink: 0 }}>
                        {meta.icon}
                      </span>

                      {/* Content */}
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {result.title}
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginTop: 1 }}>
                          {result.subtype && type === 'issue' && (
                            <span style={{ fontSize: '10.5px', color: PRIORITY_COLOR[result.subtype] ?? 'var(--fg-4)' }}>
                              {result.subtype}
                            </span>
                          )}
                          {result.subtype && type === 'command' && (
                            <span style={{ fontSize: '10.5px', color: LANG_COLOR[result.subtype] ?? 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                              {result.subtype}
                            </span>
                          )}
                          {result.subtype && (type === 'doc' || type === 'release') && (
                            <span style={{ fontSize: '10.5px', color: 'var(--fg-4)' }}>
                              {result.subtype}
                            </span>
                          )}
                          {type === 'command' && result.body && (
                            <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {result.body.split('\n')[0]}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Project dot */}
                      {result.project_name && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--fg-4)', flexShrink: 0 }}>
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: result.project_color ?? 'var(--fg-4)' }} />
                          {result.project_name}
                        </span>
                      )}

                      {/* Action hint */}
                      <span style={{ fontSize: '11px', color: copiedId === result.id ? '#22C55E' : 'var(--fg-4)', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>
                        {copiedId === result.id
                          ? '✓ Copied'
                          : isSelected
                            ? type === 'command' ? '↵ copy' : '↵ go'
                            : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '7px 14px', borderTop: '1px solid var(--line)', display: 'flex', gap: 16, fontSize: '10.5px', color: 'var(--fg-4)', flexShrink: 0, alignItems: 'center' }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
          {totalCount > 0 && (
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              {totalCount} result{totalCount !== 1 ? 's' : ''}
              {totalCount >= limit && (
                <button
                  onClick={() => setLimit(l => Math.min(l + 10, 50))}
                  disabled={loading || limit >= 50}
                  style={{ fontSize: '10.5px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: 'var(--accent-2)', cursor: 'default', opacity: loading || limit >= 50 ? 0.5 : 1 }}
                >
                  {limit >= 50 ? 'Max reached' : 'Show more'}
                </button>
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

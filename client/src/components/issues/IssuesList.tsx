import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { issuesApi, integrationsApi } from '../../lib/api'
import type { Issue } from '../../lib/api'
import { SkeletonRow } from '../Skeleton'
import { useToast } from '../Toast'
import { IssueRow } from './IssueRow'
import { FilterBar, initialFilterState } from '../FilterBar'
import type { FilterState } from '../FilterBar'

const ISSUE_PAGE = 25

export function IssuesList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { selectedProject } = useProjectStore()
  const { toast } = useToast()
  const project = selectedProject()

  const [issues,      setIssues]      = useState<Issue[]>([])
  const [total,       setTotal]       = useState(0)
  const [nextOffset,  setNextOffset]  = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search,      setSearch]      = useState('')
  const [filters,     setFilters]     = useState<FilterState>(initialFilterState)
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set())
  const [confirmBulkDel,  setConfirmBulkDel]  = useState(false)
  const [bulkWorking,     setBulkWorking]     = useState(false)
  const [importOpen,      setImportOpen]      = useState(false)
  const [importSource,    setImportSource]    = useState<'jira' | 'linear'>('jira')
  const [importJql,       setImportJql]       = useState('order by created DESC')
  const [importTeamKey,   setImportTeamKey]   = useState('')
  const [importMax,       setImportMax]       = useState(50)
  const [importing,       setImporting]       = useState(false)
  const [importResult,    setImportResult]    = useState<{ created: number; skipped: number; total: number } | null>(null)
  const [tab,             setTab]             = useState<'all' | 'triage'>('all')
  const loadAbortRef = useRef<AbortController | null>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) {
      loadAbortRef.current?.abort()
      loadAbortRef.current = new AbortController()
      setLoading(true)
      setSelectedIds(new Set())
    } else {
      setLoadingMore(true)
    }
    const signal = !append ? loadAbortRef.current?.signal : undefined
    try {
      if (tab === 'triage') {
        const result = await issuesApi.triage(project?.id === 'global' ? 'global' : project?.id)
        setTotal(result.length)
        setIssues(result)
        setNextOffset(0)
        setLoading(false)
        setLoadingMore(false)
      } else {
        const result = await issuesApi.list({
          projectId:  project?.id,
          projectIds: project?.id ? undefined : (filters.projectIds.length > 0 ? filters.projectIds : undefined),
          status:     filters.status.length > 0 ? filters.status : undefined,
          priority:   filters.priority.length > 0 ? filters.priority : undefined,
          tags:       filters.tags.length > 0 ? filters.tags : undefined,
          dateFrom:   filters.dateFrom || undefined,
          dateTo:     filters.dateTo || undefined,
          q:          search.trim() || undefined,
          limit:      ISSUE_PAGE,
          offset,
          signal,
        })
        setTotal(result.total)
        setIssues(prev => append ? [...prev, ...result.items] : result.items)
        setNextOffset(offset + result.items.length)
        setLoading(false)
        setLoadingMore(false)
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setLoading(false)
      setLoadingMore(false)
    }
  }, [project, filters, search, tab])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => prev.size === issues.length ? new Set() : new Set(issues.map(i => i.id)))
  }, [issues])

  async function handleBulkStatus(status: Issue['status']) {
    setBulkWorking(true)
    try {
      await issuesApi.bulk([...selectedIds], 'status', status)
      setIssues(prev => prev.map(i => selectedIds.has(i.id) ? { ...i, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null } : i))
      toast(`Updated ${selectedIds.size} issue${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    try {
      await issuesApi.bulk([...selectedIds], 'delete')
      const count = selectedIds.size
      setIssues(prev => prev.filter(i => !selectedIds.has(i.id)))
      setTotal(t => t - count)
      toast(`Deleted ${count} issue${count !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk delete failed', 'error')
    } finally {
      setBulkWorking(false)
      setConfirmBulkDel(false)
    }
  }

  async function handleBulkTag(tag: string) {
    if (!tag.trim()) return
    setBulkWorking(true)
    try {
      await issuesApi.bulk([...selectedIds], 'tag', tag.trim())
      setIssues(prev => prev.map(i => {
        if (selectedIds.has(i.id)) {
          const newTags = i.tags.includes(tag.trim()) ? i.tags : [...i.tags, tag.trim()]
          return { ...i, tags: newTags }
        }
        return i
      }))
      toast(`Tagged ${selectedIds.size} issue${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk tagging failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < issues.length
    }
  }, [selectedIds, issues])

  async function handleImport() {
    setImporting(true); setImportResult(null)
    try {
      let result: { created: number; skipped: number; total: number }
      if (importSource === 'jira') {
        result = await integrationsApi.jiraImport({ project_id: project?.id, jql: importJql, max_results: importMax })
      } else {
        if (!importTeamKey.trim()) { toast('Team key is required', 'error'); return }
        result = await integrationsApi.linearImport({ project_id: project?.id, team_key: importTeamKey, max_results: importMax })
      }
      setImportResult(result)
      toast(`Imported ${result.created} issues (${result.skipped} skipped)`, 'success')
      load(0, false)
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setImporting(false) }
  }

  useEffect(() => {
    const timer = setTimeout(() => load(0, false), 150)
    return () => clearTimeout(timer)
  }, [load, search, filters])

  const open = useMemo(
    () => issues.filter(i => i.status !== 'resolved' && i.status !== 'wont-fix').length,
    [issues]
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)', display: 'inline-block' }}>Issues</h1>
          {!loading && (
            <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', marginTop: 2 }}>
              {tab === 'triage' ? `${issues.length} to triage` : `${open} open · ${total} total`}{project ? ` · ${project.name}` : ''}
            </div>
          )}
        </div>

        {/* Premium tabs container */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 20, background: 'var(--bg-elev-2)', padding: 2, borderRadius: 6, border: '1px solid var(--line)' }}>
          <button
            onClick={() => setTab('all')}
            style={{
              padding: '4px 12px', borderRadius: 4, fontSize: '12px', fontWeight: 500,
              background: tab === 'all' ? 'var(--bg-hover)' : 'transparent',
              color: tab === 'all' ? 'var(--fg)' : 'var(--fg-3)',
              transition: 'all 0.15s',
            }}
          >
            All Issues
          </button>
          <button
            onClick={() => setTab('triage')}
            style={{
              padding: '4px 12px', borderRadius: 4, fontSize: '12px', fontWeight: 500,
              background: tab === 'triage' ? 'var(--bg-hover)' : 'transparent',
              color: tab === 'triage' ? 'var(--fg)' : 'var(--fg-3)',
              transition: 'all 0.15s',
            }}
          >
            Triage
          </button>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {tab !== 'triage' && (
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search issues..."
              style={{
                padding: '5px 10px', borderRadius: 6, width: 200,
                border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)',
                color: 'var(--fg)', fontSize: '12.5px', outline: 'none',
              }}
            />
          )}

          <button
            onClick={() => { setImportOpen(true); setImportResult(null) }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 10px', borderRadius: 6,
              border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
              color: 'var(--fg-3)', fontSize: '12.5px', cursor: 'default',
            }}
          >
            ↓ Import
          </button>

          <button
            onClick={onNew}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '6px 12px', borderRadius: 6,
              background: 'var(--accent)', color: 'white',
              fontSize: '12.5px', fontWeight: 500, cursor: 'default',
            }}
          >
            + New issue
          </button>
        </div>
      </div>

      {tab !== 'triage' && <FilterBar entityType="issues" filters={filters} onChange={setFilters} />}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loading && issues.length > 0 && (
          <div style={{ padding: '6px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)' }}>
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              checked={issues.length > 0 && selectedIds.size === issues.length}
              onChange={toggleSelectAll}
              style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
            />
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Select all
            </span>
          </div>
        )}

        {loading
          ? [1,2,3,4,5].map(i => <SkeletonRow key={i} cols={[14, 82, 240, 60, 80, 60]} />)
          : issues.length === 0
            ? (
              <div style={{ padding: '48px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: 20, color: 'var(--fg-4)' }}>⚠</div>
                <div style={{ fontSize: '13px', color: 'var(--fg-3)' }}>
                  {tab === 'triage' ? 'No issues require triage.' : (search || filters.status.length > 0 || filters.priority.length > 0 || filters.projectIds.length > 0 || filters.tags.length > 0 || filters.dateFrom || filters.dateTo ? 'No issues match your filters.' : 'No issues yet.')}
                </div>
                {tab !== 'triage' && !search && filters.status.length === 0 && filters.priority.length === 0 && filters.projectIds.length === 0 && filters.tags.length === 0 && !filters.dateFrom && !filters.dateTo && (
                  <button onClick={onNew} style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-2)' }}>
                    + Create your first issue
                  </button>
                )}
              </div>
            )
            : issues.map(issue => (
              <IssueRow
                key={issue.id}
                issue={issue}
                onClick={() => onOpen(issue.id)}
                selected={selectedIds.has(issue.id)}
                onToggleSelect={toggleSelect}
                hasSelection={selectedIds.size > 0}
              />
            ))
        }

        {tab !== 'triage' && !loading && issues.length < total && (
          <div style={{ padding: '12px 20px', textAlign: 'center' }}>
            <button
              onClick={() => load(nextOffset, true)}
              disabled={loadingMore}
              style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: loadingMore ? 0.6 : 1 }}
            >
              {loadingMore ? 'Loading...' : `Load more (${total - issues.length} remaining)`}
            </button>
          </div>
        )}
      </div>

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--accent-line)',
          borderRadius: 10,
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 100,
          animation: 'modal-in 0.15s ease',
        }}>
          <span style={{ fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: 500, marginRight: 6 }}>
            {selectedIds.size} selected
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            {/* Tag Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                placeholder="Add tag..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleBulkTag(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 85, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            {/* Status Dropdown */}
            <select
              onChange={e => {
                if (e.target.value) {
                  handleBulkStatus(e.target.value as any)
                  e.target.value = ''
                }
              }}
              style={{
                fontSize: '11.5px',
                padding: '4px 8px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: 'var(--fg)',
                outline: 'none',
              }}
            >
              <option value="">Change Status...</option>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="wont-fix">Won't Fix</option>
            </select>

            {/* Delete button with confirmation */}
            {!confirmBulkDel ? (
              <button
                onClick={() => setConfirmBulkDel(true)}
                disabled={bulkWorking}
                style={{
                  fontSize: '11.5px',
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(239,68,68,.4)',
                  background: 'rgba(239,68,68,.08)',
                  color: '#EF4444',
                  transition: 'all 0.15s',
                }}
              >
                Delete
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#EF4444',
                    color: 'white',
                    fontWeight: 500,
                  }}
                >
                  {bulkWorking ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmBulkDel(false)}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-elev)',
                    color: 'var(--fg-3)',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div style={{ width: '1px', height: 16, background: 'var(--line-2)', margin: '0 4px' }} />

          <button
            onClick={() => setSelectedIds(new Set())}
            style={{
              fontSize: '12px',
              color: 'var(--fg-3)',
              background: 'none',
              border: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
          >
            Deselect all
          </button>
        </div>
      )}

      {/* Import modal */}
      {importOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setImportOpen(false)}>
          <div style={{ width: 400, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 10, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Import Issues</span>
              <button onClick={() => setImportOpen(false)} style={{ color: 'var(--fg-4)', fontSize: 18, cursor: 'default' }}>×</button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {(['jira', 'linear'] as const).map(src => (
                <button key={src} onClick={() => setImportSource(src)} style={{ padding: '4px 12px', borderRadius: 5, fontSize: 12.5, cursor: 'default', border: `1px solid ${importSource === src ? 'var(--accent)' : 'var(--line)'}`, background: importSource === src ? 'var(--accent-dim)' : 'none', color: importSource === src ? 'var(--accent-2)' : 'var(--fg-3)' }}>
                  {src.charAt(0).toUpperCase() + src.slice(1)}
                </button>
              ))}
            </div>

            {importSource === 'jira' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>JQL filter</label>
                <input value={importJql} onChange={e => setImportJql(e.target.value)} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }} />
              </div>
            )}

            {importSource === 'linear' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Team key (e.g. ENG)</label>
                <input value={importTeamKey} onChange={e => setImportTeamKey(e.target.value)} placeholder="ENG" style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }} />
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12, color: 'var(--fg-3)' }}>Max results (1-100)</label>
              <input type="number" min={1} max={100} value={importMax} onChange={e => setImportMax(Math.min(100, Math.max(1, Number(e.target.value))))} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: 12.5, outline: 'none', width: 80 }} />
            </div>

            {importResult && (
              <div style={{ fontSize: 12.5, padding: '8px 10px', borderRadius: 6, background: 'rgba(34,197,94,.07)', border: '1px solid rgba(34,197,94,.2)', color: '#4ADE80' }}>
                Created {importResult.created} · Skipped {importResult.skipped} · Total {importResult.total}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setImportOpen(false)} style={{ padding: '6px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', fontSize: 12.5, cursor: 'default' }}>Close</button>
              <button onClick={handleImport} disabled={importing} style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, cursor: importing ? 'not-allowed' : 'default', opacity: importing ? 0.6 : 1 }}>
                {importing ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

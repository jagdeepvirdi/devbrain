import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { issuesApi, integrationsApi } from '../../lib/api'
import type { Issue } from '../../lib/api'
import { SkeletonRow } from '../Skeleton'
import { useToast } from '../Toast'
import { PRIORITY_META, STATUS_META } from './issueConstants'
import type { Priority, Status } from './issueConstants'
import { IssueRow } from './IssueRow'

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
  const [filterStatus,   setFilterStatus]   = useState('')
  const [filterPriority, setFilterPriority] = useState('')
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
  const loadAbortRef = useRef<AbortController | null>(null)

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
      const result = await issuesApi.list({
        projectId: project?.id,
        status:    filterStatus   || undefined,
        priority:  filterPriority || undefined,
        search:    search.trim()  || undefined,
        limit:     ISSUE_PAGE,
        offset,
        signal,
      })
      setTotal(result.total)
      setIssues(prev => append ? [...prev, ...result.items] : result.items)
      setNextOffset(offset + result.items.length)
      setLoading(false)
      setLoadingMore(false)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setLoading(false)
      setLoadingMore(false)
    }
  }, [project, filterStatus, filterPriority, search])

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
      await Promise.all([...selectedIds].map(id => issuesApi.update(id, { status })))
      setIssues(prev => prev.map(i => selectedIds.has(i.id) ? { ...i, status } : i))
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
      await Promise.all([...selectedIds].map(id => issuesApi.remove(id)))
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
    const timer = setTimeout(() => load(0, false), search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  const open = useMemo(
    () => issues.filter(i => i.status !== 'resolved' && i.status !== 'wont-fix').length,
    [issues]
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>Issues</h1>
          {!loading && (
            <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', marginTop: 2 }}>
              {open} open · {total} total{project ? ` · ${project.name}` : ''}
            </div>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
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

          <select
            value={filterStatus}
            onChange={e => setFilterStatus(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: filterStatus ? 'var(--fg)' : 'var(--fg-3)', fontSize: '12.5px' }}
          >
            <option value="">All statuses</option>
            {(Object.entries(STATUS_META) as [Status, typeof STATUS_META[Status]][]).map(([k, s]) => (
              <option key={k} value={k}>{s.label}</option>
            ))}
          </select>

          <select
            value={filterPriority}
            onChange={e => setFilterPriority(e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: filterPriority ? 'var(--fg)' : 'var(--fg-3)', fontSize: '12.5px' }}
          >
            <option value="">All priorities</option>
            {(Object.entries(PRIORITY_META) as [Priority, typeof PRIORITY_META[Priority]][]).map(([k, p]) => (
              <option key={k} value={k}>{p.label}</option>
            ))}
          </select>

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

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div style={{ padding: '6px 20px', background: 'var(--bg-elev)', borderBottom: '1px solid var(--accent-line)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <input type="checkbox" checked={selectedIds.size === issues.length} onChange={toggleSelectAll} style={{ accentColor: 'var(--accent)', cursor: 'default' }} />
          <span style={{ fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: 500 }}>
            {selectedIds.size} selected
          </span>
          <button
            onClick={() => handleBulkStatus('resolved')}
            disabled={bulkWorking}
            style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(74,222,128,.4)', background: 'rgba(74,222,128,.1)', color: '#4ADE80', cursor: 'default', opacity: bulkWorking ? 0.5 : 1 }}
          >
            Mark Resolved
          </button>
          <button
            onClick={() => handleBulkStatus('wont-fix')}
            disabled={bulkWorking}
            style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', opacity: bulkWorking ? 0.5 : 1 }}
          >
            Won't Fix
          </button>
          {!confirmBulkDel
            ? <button
                onClick={() => setConfirmBulkDel(true)}
                disabled={bulkWorking}
                style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: '#EF4444', cursor: 'default', opacity: bulkWorking ? 0.5 : 1 }}
              >
                Delete
              </button>
            : <>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.15)', color: '#EF4444', cursor: 'default' }}
                >
                  {bulkWorking ? 'Deleting...' : `Confirm delete ${selectedIds.size}`}
                </button>
                <button onClick={() => setConfirmBulkDel(false)} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                  Cancel
                </button>
              </>
          }
          <button onClick={() => setSelectedIds(new Set())} style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'default' }}>
            Clear selection
          </button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!loading && issues.length > 0 && (
          <div style={{ padding: '6px 20px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elev)' }}>
            <input
              type="checkbox"
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
                  {search || filterStatus || filterPriority ? 'No issues match your filters.' : 'No issues yet.'}
                </div>
                {!search && !filterStatus && !filterPriority && (
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
              />
            ))
        }

        {!loading && issues.length < total && (
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

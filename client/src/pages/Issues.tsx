import { useState, useEffect, useRef, useCallback } from 'react'
import { useProjectStore } from '../store/projectStore'
import { issuesApi, runbooksApi } from '../lib/api'
import type { Issue, IssueStep, IssueNote, Runbook, RelatedIssue, RelatedDoc, RelatedCommand } from '../lib/api'
import { SkeletonRow } from '../components/Skeleton'
import { useToast } from '../components/Toast'
// ── Constants ─────────────────────────────────────────────────────────────

const PRIORITY_META = {
  critical: { label: 'Critical', color: '#F05A5A' },
  high:     { label: 'High',     color: '#FF9D4D' },
  medium:   { label: 'Medium',   color: '#E6C341' },
  low:      { label: 'Low',      color: '#60A5FA' },
} as const

const STATUS_META = {
  open:          { label: 'Open',          color: 'var(--fg-3)' },
  investigating: { label: 'Investigating', color: '#FF9D4D' },
  resolved:      { label: 'Resolved',      color: '#4ADE80' },
  'wont-fix':    { label: "Won't Fix",     color: 'var(--fg-4)' },
} as const

type Status   = keyof typeof STATUS_META
type Priority = keyof typeof PRIORITY_META
type View     = 'list' | 'detail' | 'new'

// ── Helper: render step text with `code` spans ────────────────────────────

function StepText({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  const re = /`([^`]+)`/g
  let last = 0, m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <code key={m.index} style={{
        fontFamily: 'var(--font-mono)', fontSize: 11.5,
        background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
        padding: '1px 5px', borderRadius: 4,
      }}>{m[1]}</code>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

// ── Issue list row ────────────────────────────────────────────────────────

function IssueRow({ issue, onClick, selected, onToggleSelect }: {
  issue: Issue
  onClick: () => void
  selected?: boolean
  onToggleSelect?: (id: string) => void
}) {
  const pm = PRIORITY_META[issue.priority]
  const sm = STATUS_META[issue.status]
  const doneSteps = issue.investigation_steps.filter(s => s.done).length
  const total     = issue.investigation_steps.length

  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 20px', cursor: 'default',
        borderBottom: '1px solid var(--line)',
        background: selected ? 'var(--accent-dim)' : 'transparent',
        transition: 'background .1s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-hover)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      {/* Checkbox */}
      {onToggleSelect && (
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect(issue.id)}
          onClick={e => e.stopPropagation()}
          style={{ flexShrink: 0, cursor: 'default', accentColor: 'var(--accent)', width: 14, height: 14 }}
        />
      )}

      {/* Priority badge */}
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        minWidth: 82, fontSize: '11.5px', fontWeight: 500,
        color: pm.color,
        background: `${pm.color}18`,
        border: `1px solid ${pm.color}40`,
        borderRadius: 5, padding: '2px 7px',
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: pm.color, flexShrink: 0 }} />
        {pm.label}
      </span>

      {/* Title */}
      <span style={{ flex: 1, fontSize: '13px', color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {issue.title}
      </span>

      {/* Steps progress */}
      {total > 0 && (
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
          {doneSteps}/{total}
        </span>
      )}

      {/* Status */}
      <span style={{
        fontSize: '11.5px', color: sm.color,
        background: 'var(--bg-elev-2)', border: '1px solid var(--line)',
        borderRadius: 5, padding: '2px 8px', flexShrink: 0,
      }}>
        {sm.label}
      </span>

      {/* Project pill */}
      {issue.project_name && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          fontSize: '11px', color: 'var(--fg-3)',
          fontFamily: 'var(--font-mono)', flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: issue.project_color ?? 'var(--fg-4)' }} />
          {issue.project_name}
        </span>
      )}

      {/* Date */}
      <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 60, textAlign: 'right' }}>
        {new Date(issue.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}

// ── New Issue modal ───────────────────────────────────────────────────────

function NewIssueModal({ onClose, onCreate }: { onClose: () => void; onCreate: (issue: Issue) => void }) {
  const { projects, selectedProject } = useProjectStore()
  const project = selectedProject()

  const [title,      setTitle]      = useState('')
  const [desc,       setDesc]       = useState('')
  const [priority,   setPriority]   = useState<Priority>('medium')
  const [projectId,  setProjectId]  = useState<string | null>(project?.id ?? null)
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')
  const [runbooks,   setRunbooks]   = useState<Runbook[]>([])
  const [runbookId,  setRunbookId]  = useState<string>('')
  const [related,    setRelated]    = useState<RelatedIssue[]>([])
  const relatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    runbooksApi.list().then(setRunbooks).catch(() => {})
  }, [])

  // Debounced related-issue lookup
  useEffect(() => {
    if (relatedTimer.current) clearTimeout(relatedTimer.current)
    if (title.trim().length < 3) { setRelated([]); return }
    relatedTimer.current = setTimeout(() => {
      issuesApi.related(title.trim()).then(setRelated).catch(() => {})
    }, 400)
    return () => { if (relatedTimer.current) clearTimeout(relatedTimer.current) }
  }, [title])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function save() {
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      const selectedRunbook = runbooks.find(r => r.id === runbookId)
      const investigation_steps: IssueStep[] = selectedRunbook
        ? selectedRunbook.steps.map((s, i) => ({
            id: globalThis.crypto.randomUUID(),
            order: i,
            instruction: s.instruction,
            done: false,
          }))
        : []
      const issue = await issuesApi.create({
        title: title.trim(),
        description: desc.trim(),
        status: 'open',
        priority,
        project_id: projectId,
        tags: [],
        investigation_steps,
      })
      onCreate(issue)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 100,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: 'var(--bg-elev)', border: '1px solid var(--line-2)',
        borderRadius: 10, width: 520, padding: '20px',
        display: 'flex', flexDirection: 'column', gap: 14,
        boxShadow: '0 20px 60px rgba(0,0,0,.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>New Issue</h2>
          <button onClick={onClose} style={{ fontSize: 18, color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
        </div>

        {error && <p style={{ margin: 0, fontSize: '12px', color: '#F05A5A' }}>{error}</p>}

        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Issue title"
          autoFocus
          style={{
            padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--line-2)', background: 'var(--bg)',
            color: 'var(--fg)', fontSize: '13px', outline: 'none',
          }}
        />

        {/* Related issues */}
        {related.length > 0 && (
          <div style={{ background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>Similar issues</div>
            {related.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                {r.project_color && <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.project_color, flexShrink: 0 }} />}
                <span style={{ flex: 1, color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                <span style={{ fontSize: 11, color: PRIORITY_META[r.priority as Priority]?.color ?? 'var(--fg-4)' }}>{r.priority}</span>
                <span style={{ fontSize: 11, color: 'var(--fg-4)' }}>{r.status}</span>
              </div>
            ))}
          </div>
        )}

        <textarea
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
          style={{
            padding: '8px 10px', borderRadius: 6,
            border: '1px solid var(--line-2)', background: 'var(--bg)',
            color: 'var(--fg)', fontSize: '13px', outline: 'none', resize: 'vertical',
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          {/* Priority */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5 }}>Priority</label>
            <select
              value={priority}
              onChange={e => setPriority(e.target.value as Priority)}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' }}
            >
              {(Object.keys(PRIORITY_META) as Priority[]).map(p => (
                <option key={p} value={p}>{PRIORITY_META[p].label}</option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5 }}>Project</label>
            <select
              value={projectId ?? ''}
              onChange={e => setProjectId(e.target.value || null)}
              style={{ width: '100%', padding: '7px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '13px' }}
            >
              <option value="">No project</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Load from Runbook */}
        <div>
          <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5 }}>
            Start from Runbook
            <span style={{ color: 'var(--fg-4)', fontWeight: 400, marginLeft: 6 }}>— pre-fills investigation steps</span>
          </label>
          <select
            value={runbookId}
            onChange={e => setRunbookId(e.target.value)}
            style={{ width: '100%', padding: '7px 8px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg)', color: runbookId ? 'var(--fg)' : 'var(--fg-3)', fontSize: '13px' }}
          >
            <option value="">None (blank steps)</option>
            {runbooks.map(r => (
              <option key={r.id} value={r.id}>
                {r.title}{r.project_name ? ` · ${r.project_name}` : ''} ({r.steps.length} steps)
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} style={{
            padding: '7px 16px', borderRadius: 6,
            background: saving ? 'var(--bg-elev-2)' : 'var(--accent)',
            color: 'white', fontSize: '13px', cursor: saving ? 'not-allowed' : 'default', fontWeight: 500,
          }}>
            {saving ? 'Creating…' : 'Create issue'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Issue Detail view ─────────────────────────────────────────────────────

function IssueDetail({ issueId, onBack, onDeleted }: { issueId: string; onBack: () => void; onDeleted: () => void }) {
  const [issue,          setIssue]          = useState<Issue | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [saving,         setSaving]         = useState(false)
  const [noteInput,      setNoteInput]      = useState('')
  const [summary,        setSummary]        = useState('')
  const [summarizing,    setSummarizing]    = useState(false)
  const [newStepText,    setNewStepText]    = useState('')
  const [openPrio,       setOpenPrio]       = useState(false)
  const [openStatus,     setOpenStatus]     = useState(false)
  const dragIdx = useRef<number | null>(null)
  const [dropIdx,        setDropIdx]        = useState<number | null>(null)
  // AI Intelligence drawer
  const [aiOpen,         setAiOpen]         = useState(false)
  const [relatedDocs,    setRelatedDocs]    = useState<RelatedDoc[]>([])
  const [loadingDocs,    setLoadingDocs]    = useState(false)
  const [similarIssues,  setSimilarIssues]  = useState<RelatedIssue[]>([])
  const [loadingSimilar, setLoadingSimilar] = useState(false)
  const [suggestingSteps,setSuggestingSteps]= useState(false)
  const [suggestMsg,     setSuggestMsg]     = useState('')
  const [relatedCmds,    setRelatedCmds]    = useState<RelatedCommand[]>([])
  const [loadingCmds,    setLoadingCmds]    = useState(false)
  const [savingRunbook,  setSavingRunbook]  = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    issuesApi.get(issueId).then(i => { setIssue(i); setLoading(false) }).catch(() => setLoading(false))
  }, [issueId])

  // Close dropdowns on outside click
  useEffect(() => {
    const h = () => { setOpenPrio(false); setOpenStatus(false) }
    window.addEventListener('click', h)
    return () => window.removeEventListener('click', h)
  }, [])

  async function patch(updates: Parameters<typeof issuesApi.update>[1]) {
    if (!issue) return
    setSaving(true)
    try {
      const updated = await issuesApi.update(issue.id, updates)
      setIssue(updated)
    } finally {
      setSaving(false)
    }
  }

  async function addNote() {
    if (!issue || !noteInput.trim()) return
    const updated = await issuesApi.addNote(issue.id, noteInput.trim())
    setIssue(updated)
    setNoteInput('')
  }

  async function deleteNote(noteId: string) {
    if (!issue) return
    const updated = await issuesApi.deleteNote(issue.id, noteId)
    setIssue(updated)
  }

  function toggleStep(id: string) {
    if (!issue) return
    const steps = issue.investigation_steps.map(s => s.id === id ? { ...s, done: !s.done } : s)
    setIssue({ ...issue, investigation_steps: steps })
    patch({ investigation_steps: steps })
  }

  function addStep() {
    if (!issue || !newStepText.trim()) return
    const steps: IssueStep[] = [
      ...issue.investigation_steps,
      { id: globalThis.crypto.randomUUID(), order: issue.investigation_steps.length, instruction: newStepText.trim(), done: false },
    ]
    setIssue({ ...issue, investigation_steps: steps })
    patch({ investigation_steps: steps })
    setNewStepText('')
  }

  function deleteStep(id: string) {
    if (!issue) return
    const steps = issue.investigation_steps.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i }))
    setIssue({ ...issue, investigation_steps: steps })
    patch({ investigation_steps: steps })
  }

  function onDrop(toIdx: number) {
    if (!issue) return
    const fromIdx = dragIdx.current
    if (fromIdx == null || fromIdx === toIdx) { setDropIdx(null); dragIdx.current = null; return }
    const arr = [...issue.investigation_steps]
    const [moved] = arr.splice(fromIdx, 1)
    arr.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved)
    const steps = arr.map((s, i) => ({ ...s, order: i }))
    setIssue({ ...issue, investigation_steps: steps })
    patch({ investigation_steps: steps })
    setDropIdx(null); dragIdx.current = null
  }

  async function doSummarize() {
    if (!issue) return
    setSummarizing(true)
    try {
      const { summary: s } = await issuesApi.summarize(issue.id)
      setSummary(s)
    } finally {
      setSummarizing(false)
    }
  }

  async function doSuggestSteps() {
    if (!issue) return
    setSuggestingSteps(true)
    setSuggestMsg('')
    try {
      const { steps } = await issuesApi.suggestSteps(issue.id)
      if (!steps.length) return
      const newSteps: IssueStep[] = steps.map((instruction, i) => ({
        id: globalThis.crypto.randomUUID(),
        order: issue.investigation_steps.length + i,
        instruction,
        done: false,
      }))
      const merged = [...issue.investigation_steps, ...newSteps]
      setIssue({ ...issue, investigation_steps: merged })
      patch({ investigation_steps: merged })
      setSuggestMsg(`+${newSteps.length} steps added`)
      setTimeout(() => setSuggestMsg(''), 3000)
    } finally {
      setSuggestingSteps(false)
    }
  }

  // Load AI drawer data whenever it opens
  useEffect(() => {
    if (!aiOpen || !issue) return
    setLoadingSimilar(true)
    issuesApi.related(issue.title)
      .then(r => setSimilarIssues(r.filter(s => s.id !== issue.id)))
      .catch(() => {})
      .finally(() => setLoadingSimilar(false))
    setLoadingDocs(true)
    issuesApi.relatedDocs(issue.id)
      .then(setRelatedDocs)
      .catch(() => {})
      .finally(() => setLoadingDocs(false))
    setLoadingCmds(true)
    issuesApi.relatedCommands(issue.id)
      .then(setRelatedCmds)
      .catch(() => {})
      .finally(() => setLoadingCmds(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiOpen, issue?.id])

  async function doDelete() {
    if (!issue) return
    if (!confirm(`Delete "${issue.title}"? This cannot be undone.`)) return
    await issuesApi.remove(issue.id)
    onDeleted()
  }

  async function doSaveAsRunbook() {
    if (!issue || !issue.investigation_steps.length) return
    setSavingRunbook(true)
    try {
      await runbooksApi.create({
        title:      `Runbook: ${issue.title}`,
        project_id: issue.project_id ?? null,
        tags:       issue.tags,
        steps:      issue.investigation_steps.map((s, i) => ({
          id:          globalThis.crypto.randomUUID(),
          order:       i,
          instruction: s.instruction,
        })),
      })
      toast('Saved as runbook')
    } catch {
      toast('Failed to save runbook', 'error')
    } finally {
      setSavingRunbook(false)
    }
  }

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-4)' }}>Loading…</div>
  if (!issue)  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-4)' }}>Issue not found.</div>

  const pm = PRIORITY_META[issue.priority]
  const sm = STATUS_META[issue.status]
  const doneSteps = issue.investigation_steps.filter(s => s.done).length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0, background: 'var(--bg-elev)' }}>
        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: '12px', color: 'var(--fg-3)' }}>
          <button onClick={onBack} style={{ color: 'var(--accent-2)', cursor: 'default', fontSize: '12px' }}>← Issues</button>
          <span>/</span>
          {issue.project_name && (
            <>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: issue.project_color ?? 'var(--fg-4)' }} />
                {issue.project_name}
              </span>
              <span>/</span>
            </>
          )}
          <span style={{ color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
            {new Date(issue.created_at).toLocaleDateString()}
          </span>
          <button onClick={doDelete} style={{ marginLeft: 'auto', fontSize: '11.5px', color: '#F05A5A', cursor: 'default', padding: '2px 8px', borderRadius: 4, border: '1px solid #F05A5A40' }}>
            Delete
          </button>
        </div>

        {/* Title */}
        <h2 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4 }}>
          {issue.title}
        </h2>

        {/* Tag row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Priority dropdown */}
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setOpenPrio(v => !v); setOpenStatus(false) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: '11.5px', fontWeight: 500, padding: '3px 8px', borderRadius: 5,
                color: pm.color, background: `${pm.color}18`, border: `1px solid ${pm.color}40`,
                cursor: 'default',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: pm.color }} />
              {pm.label} ▾
            </button>
            {openPrio && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
                background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
                borderRadius: 7, padding: 4, minWidth: 150,
                boxShadow: '0 8px 24px rgba(0,0,0,.4)',
              }}>
                {(Object.entries(PRIORITY_META) as [Priority, typeof PRIORITY_META[Priority]][]).map(([k, p]) => (
                  <div key={k} onClick={() => { patch({ priority: k }); setOpenPrio(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 5, cursor: 'default',
                      background: issue.priority === k ? 'var(--bg-hover)' : 'transparent',
                      fontSize: '12.5px', color: 'var(--fg-2)',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.color }} />
                    {p.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Status dropdown */}
          <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button
              onClick={() => { setOpenStatus(v => !v); setOpenPrio(false) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                fontSize: '11.5px', padding: '3px 8px', borderRadius: 5,
                color: sm.color, background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
                cursor: 'default',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: sm.color }} />
              {sm.label} ▾
            </button>
            {openStatus && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 20,
                background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
                borderRadius: 7, padding: 4, minWidth: 160,
                boxShadow: '0 8px 24px rgba(0,0,0,.4)',
              }}>
                {(Object.entries(STATUS_META) as [Status, typeof STATUS_META[Status]][]).map(([k, s]) => (
                  <div key={k} onClick={() => { patch({ status: k }); setOpenStatus(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 10px', borderRadius: 5, cursor: 'default',
                      background: issue.status === k ? 'var(--bg-hover)' : 'transparent',
                      fontSize: '12.5px', color: 'var(--fg-2)',
                    }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                    {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right-side buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {issue.status === 'resolved' && issue.investigation_steps.length > 0 && (
              <button
                onClick={doSaveAsRunbook}
                disabled={savingRunbook}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '3px 10px', borderRadius: 5,
                  border: '1px solid var(--line-2)', background: 'transparent',
                  color: 'var(--fg-3)', fontSize: '11.5px',
                  cursor: savingRunbook ? 'not-allowed' : 'default',
                  opacity: savingRunbook ? 0.6 : 1,
                }}
              >
                {savingRunbook ? 'Saving…' : '↗ Save as Runbook'}
              </button>
            )}
            <button
              onClick={() => setAiOpen(v => !v)}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 5,
                border: `1px solid ${aiOpen ? 'var(--accent)' : 'var(--line-2)'}`,
                background: aiOpen ? 'var(--accent-dim)' : 'transparent',
                color: aiOpen ? 'var(--accent-2)' : 'var(--fg-3)',
                fontSize: '11.5px', cursor: 'default', fontWeight: aiOpen ? 600 : 400,
              }}
            >
              <span>◆</span> AI
            </button>
          </div>

          {/* Steps + notes count */}
          <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {doneSteps}/{issue.investigation_steps.length} steps · {issue.notes.length} notes
            {saving && <span style={{ marginLeft: 8, color: 'var(--accent-2)' }}>saving…</span>}
          </span>
        </div>

        {/* Description */}
        {issue.description && (
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
            {issue.description}
          </p>
        )}
      </div>

      {/* Body — main 2-col + optional AI drawer */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

        {/* LEFT — Investigation steps */}
        <div style={{ borderRight: '1px solid var(--line)', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Investigation
            </span>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
              {doneSteps}/{issue.investigation_steps.length}
            </span>
            <button
              onClick={doSuggestSteps}
              disabled={suggestingSteps}
              title="AI: Generate investigation steps"
              style={{
                marginLeft: 'auto',
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 8px', borderRadius: 5,
                border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
                color: 'var(--accent-2)', fontSize: '11px',
                cursor: suggestingSteps ? 'not-allowed' : 'default',
                opacity: suggestingSteps ? 0.6 : 1,
              }}
            >
              <span>◆</span> {suggestingSteps ? 'Generating…' : 'Suggest'}
            </button>
            {suggestMsg && (
              <span style={{ fontSize: '11px', color: '#4ADE80' }}>{suggestMsg}</span>
            )}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {issue.investigation_steps.map((step, i) => (
              <div
                key={step.id}
                draggable
                onDragStart={() => { dragIdx.current = i }}
                onDragOver={e => { e.preventDefault(); setDropIdx(i) }}
                onDrop={e => { e.preventDefault(); onDrop(i) }}
                onDragEnd={() => { setDropIdx(null); dragIdx.current = null }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '7px 10px', borderRadius: 6,
                  background: dropIdx === i ? 'var(--bg-elev-2)' : 'transparent',
                  border: dropIdx === i ? '1px solid var(--accent)' : '1px solid transparent',
                  transition: 'background .1s',
                }}
              >
                {/* Drag handle */}
                <span style={{ color: 'var(--fg-4)', cursor: 'grab', fontSize: '10px', marginTop: 2, flexShrink: 0 }}>⠿</span>
                {/* Order */}
                <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                {/* Checkbox */}
                <button
                  onClick={() => toggleStep(step.id)}
                  style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                    border: `1.5px solid ${step.done ? 'var(--accent)' : 'var(--line-3)'}`,
                    background: step.done ? 'var(--accent)' : 'transparent',
                    display: 'grid', placeItems: 'center', cursor: 'default',
                  }}
                >
                  {step.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M5 12l4 4 10-10"/></svg>}
                </button>
                {/* Text */}
                <span style={{
                  flex: 1, fontSize: '13px', color: step.done ? 'var(--fg-4)' : 'var(--fg-2)',
                  textDecoration: step.done ? 'line-through' : 'none', lineHeight: 1.5,
                }}>
                  <StepText text={step.instruction} />
                </span>
                {/* Delete */}
                <button onClick={() => deleteStep(step.id)} style={{ color: 'var(--fg-4)', fontSize: '13px', flexShrink: 0, opacity: 0.5, cursor: 'default' }}>×</button>
              </div>
            ))}

            {/* Add step input */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 10px' }}>
              <span style={{ color: 'var(--fg-4)', fontSize: '10px', width: 10, flexShrink: 0 }}>⠿</span>
              <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, width: 16 }}>
                {issue.investigation_steps.length + 1}.
              </span>
              <input
                value={newStepText}
                onChange={e => setNewStepText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStep() } }}
                placeholder="Add investigation step…"
                style={{
                  flex: 1, background: 'transparent', border: 'none', outline: 'none',
                  fontSize: '13px', color: 'var(--fg-3)', fontFamily: 'inherit',
                }}
              />
            </div>
          </div>

          {/* Resolution */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Resolution
            </div>
            <textarea
              value={issue.resolution}
              onChange={e => setIssue({ ...issue, resolution: e.target.value })}
              onBlur={e => patch({ resolution: e.target.value })}
              placeholder="Once you've shipped a fix, summarize what worked here. This becomes searchable in chat."
              rows={4}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid var(--line-2)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: '13px', outline: 'none',
                resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6,
                boxSizing: 'border-box',
              }}
            />
          </div>

        </div>

        {/* RIGHT — Notes */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Notes
            </span>
            <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
              {issue.notes.length}
            </span>
          </div>

          {issue.notes.length === 0 && (
            <p style={{ fontSize: '12.5px', color: 'var(--fg-4)', margin: 0 }}>No notes yet. Add one below.</p>
          )}

          {[...issue.notes].reverse().map((note: IssueNote) => (
            <div key={note.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: '10.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 3 }}>
                {new Date(note.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6,
                  padding: '8px 10px', borderRadius: 6,
                  background: 'var(--bg-elev)', border: '1px solid var(--line)',
                  whiteSpace: 'pre-wrap',
                }}>
                  {note.content}
                </div>
              </div>
              <button onClick={() => deleteNote(note.id)} style={{ color: 'var(--fg-4)', fontSize: '13px', flexShrink: 0, cursor: 'default', opacity: 0.5, marginTop: 6 }}>×</button>
            </div>
          ))}

          {/* Note input */}
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            border: '1px solid var(--line-2)', borderRadius: 7,
            background: 'var(--bg)', padding: '8px 10px',
          }}>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() } }}
              placeholder="Add a note… (Enter to save, Shift+Enter for newline)"
              rows={2}
              style={{
                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                fontSize: '13px', color: 'var(--fg)', fontFamily: 'inherit', resize: 'none', lineHeight: 1.55,
              }}
            />
            <button
              onClick={addNote}
              disabled={!noteInput.trim()}
              style={{
                width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                background: noteInput.trim() ? 'var(--accent)' : 'var(--bg-elev-2)',
                color: noteInput.trim() ? 'white' : 'var(--fg-4)',
                display: 'grid', placeItems: 'center', cursor: noteInput.trim() ? 'default' : 'not-allowed',
              }}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* ── AI Intelligence drawer ── */}
      {aiOpen && (
        <div style={{
          width: 284, flexShrink: 0,
          borderLeft: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          background: 'var(--bg-elev)',
        }}>

          {/* Summary */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Summary
            </div>
            <button
              onClick={doSummarize}
              disabled={summarizing}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 6, width: '100%',
                border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
                color: 'var(--accent-2)', fontSize: '12px',
                cursor: summarizing ? 'not-allowed' : 'default', opacity: summarizing ? 0.7 : 1,
              }}
            >
              <span>◆</span> {summarizing ? 'Summarizing…' : 'Generate Summary'}
            </button>
            {summary && (
              <div style={{
                marginTop: 10, padding: '10px 12px', borderRadius: 7,
                border: '1px solid var(--line)', background: 'var(--bg)',
                fontSize: '12px', color: 'var(--fg-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
              }}>
                {summary}
              </div>
            )}
          </div>

          {/* Similar Issues */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Similar Issues
            </div>
            {loadingSimilar
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching…</div>
              : similarIssues.length === 0
                ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>No similar issues found.</div>
                : similarIssues.map(r => (
                    <div key={r.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start' }}>
                      {r.project_color && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.project_color, flexShrink: 0, marginTop: 4 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '12px', color: 'var(--fg-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: 2, display: 'flex', gap: 6 }}>
                          <span style={{ color: PRIORITY_META[r.priority as Priority]?.color }}>{r.priority}</span>
                          <span>{r.status}</span>
                          {r.project_name && <span>{r.project_name}</span>}
                        </div>
                      </div>
                    </div>
                  ))
            }
          </div>

          {/* Related Docs */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Related Docs
            </div>
            {loadingDocs
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching…</div>
              : relatedDocs.length === 0
                ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>No related documents found.</div>
                : relatedDocs.map(d => (
                    <div key={d.doc_id} style={{
                      marginBottom: 10, padding: '8px 10px', borderRadius: 6,
                      border: '1px solid var(--line)', background: 'var(--bg)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        {d.project_color && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.project_color, flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {d.doc_title}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                          {d.file_type}
                        </span>
                      </div>
                      <div style={{ fontSize: '11.5px', color: 'var(--fg-3)', lineHeight: 1.5, overflow: 'hidden', maxHeight: 48 }}>
                        {d.excerpt}
                      </div>
                      {d.project_name && (
                        <div style={{ fontSize: '10.5px', color: 'var(--fg-4)', marginTop: 4 }}>{d.project_name}</div>
                      )}
                    </div>
                  ))
            }
          </div>

          {/* Related Commands */}
          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Related Commands
            </div>
            {loadingCmds
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching…</div>
              : relatedCmds.length === 0
                ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>No related commands found.</div>
                : relatedCmds.map(c => (
                    <div key={c.id} style={{
                      marginBottom: 8, padding: '8px 10px', borderRadius: 6,
                      border: '1px solid var(--line)', background: 'var(--bg)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        {c.project_color && (
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: c.project_color, flexShrink: 0 }} />
                        )}
                        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.title}
                        </span>
                        <span style={{
                          fontSize: '10px', color: 'var(--accent-2)', fontFamily: 'var(--font-mono)',
                          flexShrink: 0, background: 'var(--accent-dim)', padding: '1px 5px', borderRadius: 3,
                        }}>
                          {c.language}
                        </span>
                      </div>
                      <code style={{
                        display: 'block', fontSize: '11px', color: 'var(--fg-3)',
                        fontFamily: 'var(--font-mono)', lineHeight: 1.5,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {c.command.slice(0, 80)}
                      </code>
                    </div>
                  ))
            }
          </div>

        </div>
      )}

      </div>{/* end body flex row */}
    </div>
  )
}

// ── Issues list view ──────────────────────────────────────────────────────

const ISSUE_PAGE = 25

function IssuesList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
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

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) { setLoading(true); setSelectedIds(new Set()) }
    else setLoadingMore(true)
    try {
      const result = await issuesApi.list({
        projectId: project?.id,
        status:    filterStatus   || undefined,
        priority:  filterPriority || undefined,
        search:    search.trim()  || undefined,
        limit:     ISSUE_PAGE,
        offset,
      })
      setTotal(result.total)
      setIssues(prev => append ? [...prev, ...result.items] : result.items)
      setNextOffset(offset + result.items.length)
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [project, filterStatus, filterPriority, search])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds(prev => prev.size === issues.length ? new Set() : new Set(issues.map(i => i.id)))
  }

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

  useEffect(() => {
    const timer = setTimeout(() => load(0, false), search ? 300 : 0)
    return () => clearTimeout(timer)
  }, [load, search])

  const open = issues.filter(i => i.status !== 'resolved' && i.status !== 'wont-fix').length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Page header */}
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
          {/* Search */}
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search issues…"
            style={{
              padding: '5px 10px', borderRadius: 6, width: 200,
              border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)',
              color: 'var(--fg)', fontSize: '12.5px', outline: 'none',
            }}
          />

          {/* Status filter */}
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

          {/* Priority filter */}
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
                  {bulkWorking ? 'Deleting…' : `Confirm delete ${selectedIds.size}`}
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

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Select-all header row */}
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
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--fg-4)', fontSize: '13px' }}>
                {search || filterStatus || filterPriority ? 'No issues match your filters.' : 'No issues yet. Create one to get started.'}
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

        {/* Load more */}
        {!loading && issues.length < total && (
          <div style={{ padding: '12px 20px', textAlign: 'center' }}>
            <button
              onClick={() => load(nextOffset, true)}
              disabled={loadingMore}
              style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: loadingMore ? 0.6 : 1 }}
            >
              {loadingMore ? 'Loading…' : `Load more (${total - issues.length} remaining)`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Page root ─────────────────────────────────────────────────────────────

export function IssuesPage() {
  const [view,       setView]       = useState<View>('list')
  const [activeId,   setActiveId]   = useState<string | null>(null)
  const [showNew,    setShowNew]    = useState(false)
  const [listKey,    setListKey]    = useState(0) // force re-fetch list

  function openIssue(id: string) { setActiveId(id); setView('detail') }
  function backToList() { setView('list'); setActiveId(null) }

  // Open a specific issue when navigated here from another page (e.g. Releases)
  useEffect(() => {
    function onOpenIssue(e: Event) { openIssue((e as CustomEvent<string>).detail) }
    window.addEventListener('devbrain:open-issue', onOpenIssue)
    return () => window.removeEventListener('devbrain:open-issue', onOpenIssue)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {view === 'list' && (
        <IssuesList
          key={listKey}
          onOpen={openIssue}
          onNew={() => setShowNew(true)}
        />
      )}
      {view === 'detail' && activeId && (
        <IssueDetail
          issueId={activeId}
          onBack={backToList}
          onDeleted={() => { setListKey(k => k + 1); backToList() }}
        />
      )}
      {showNew && (
        <NewIssueModal
          onClose={() => setShowNew(false)}
          onCreate={issue => { setShowNew(false); setListKey(k => k + 1); openIssue(issue.id) }}
        />
      )}
    </div>
  )
}

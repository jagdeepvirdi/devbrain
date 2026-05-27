import { useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../../store/projectStore'
import { issuesApi, runbooksApi } from '../../lib/api'
import type { Issue, IssueStep, Runbook, RelatedIssue } from '../../lib/api'
import { PRIORITY_META } from './issueConstants'
import type { Priority } from './issueConstants'

export function NewIssueModal({ onClose, onCreate }: { onClose: () => void; onCreate: (issue: Issue) => void }) {
  const { projects, selectedProject } = useProjectStore()
  const project = selectedProject()

  const [title,         setTitle]         = useState('')
  const [desc,          setDesc]          = useState('')
  const [priority,      setPriority]      = useState<Priority>('medium')
  const [projectId,     setProjectId]     = useState<string | null>(project?.id ?? null)
  const [saving,        setSaving]        = useState(false)
  const [error,         setError]         = useState('')
  const [runbooks,      setRunbooks]      = useState<Runbook[]>([])
  const [runbookId,     setRunbookId]     = useState<string>('')
  const [related,       setRelated]       = useState<RelatedIssue[]>([])
  const [tags,          setTags]          = useState<string[]>([])
  const [tagInput,      setTagInput]      = useState('')
  const [suggestedTags, setSuggestedTags] = useState<string[]>([])
  const relatedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    runbooksApi.list().then(setRunbooks).catch(() => {})
  }, [])

  useEffect(() => {
    if (relatedTimer.current) clearTimeout(relatedTimer.current)
    if (title.trim().length < 3) { setRelated([]); return }
    relatedTimer.current = setTimeout(() => {
      issuesApi.related(title.trim()).then(setRelated).catch(() => {})
    }, 400)
    return () => { if (relatedTimer.current) clearTimeout(relatedTimer.current) }
  }, [title])

  useEffect(() => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current)
    if (title.trim().length < 5) { setSuggestedTags([]); return }
    suggestTimer.current = setTimeout(() => {
      issuesApi.suggestTags(title.trim(), desc.trim() || undefined)
        .then(({ tags: suggested }) => setSuggestedTags(suggested.filter(t => !tags.includes(t))))
        .catch(() => {})
    }, 800)
    return () => { if (suggestTimer.current) clearTimeout(suggestTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, desc])

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
        tags,
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
    <div
      className="modal-overlay"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-issue-dialog-title"
        className="modal-panel"
        style={{
          background: 'var(--bg-elev)', border: '1px solid var(--line-2)',
          borderRadius: 10, width: 520, padding: '20px',
          display: 'flex', flexDirection: 'column', gap: 14,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2 id="new-issue-dialog-title" style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>New Issue</h2>
          <button onClick={onClose} aria-label="Close dialog" style={{ fontSize: 18, color: 'var(--fg-3)', lineHeight: 1 }}>×</button>
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

        {/* Tags + AI suggestions */}
        <div>
          {tags.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
              {tags.map(t => (
                <span key={t} style={{ fontSize: '11px', padding: '1px 7px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  {t}
                  <button onClick={() => setTags(prev => prev.filter(x => x !== t))} style={{ color: 'var(--accent-2)', fontSize: 9, background: 'none', border: 'none', cursor: 'default', padding: 0, lineHeight: 1 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={tagInput}
              onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault()
                  const t = tagInput.trim().replace(/,/g, '')
                  if (t && !tags.includes(t)) setTags(prev => [...prev, t])
                  setTagInput('')
                }
              }}
              placeholder="Tags (Enter or comma)"
              style={{ flex: 1, padding: '5px 10px', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 6, fontSize: '12px', color: 'var(--fg)', outline: 'none' }}
            />
          </div>
          {suggestedTags.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6, alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--fg-3)' }}>✦ Suggested:</span>
              {suggestedTags.map(t => (
                <button
                  key={t}
                  onClick={() => { setTags(prev => prev.includes(t) ? prev : [...prev, t]); setSuggestedTags(prev => prev.filter(x => x !== t)) }}
                  style={{ fontSize: '11px', padding: '1px 8px', borderRadius: 10, background: 'rgba(99,102,241,.12)', border: '1px dashed var(--accent-line)', color: 'var(--accent-2)', cursor: 'default' }}
                >
                  + {t}
                </button>
              ))}
              <button onClick={() => setSuggestedTags([])} style={{ fontSize: '10px', color: 'var(--fg-3)', background: 'none', border: 'none', cursor: 'default' }}>✕</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
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

        <div>
          <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 5 }}>
            Start from Runbook
            <span style={{ color: 'var(--fg-4)', fontWeight: 400, marginLeft: 6 }}>-- pre-fills investigation steps</span>
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
          <button onClick={onClose} style={{ padding: '7px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'transparent', color: 'var(--fg-2)', fontSize: '13px' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} style={{
            padding: '7px 16px', borderRadius: 6,
            background: saving ? 'var(--bg-elev-2)' : 'var(--accent)',
            color: 'white', fontSize: '13px', fontWeight: 500,
          }}>
            {saving ? 'Creating...' : 'Create issue'}
          </button>
        </div>
      </div>
    </div>
  )
}

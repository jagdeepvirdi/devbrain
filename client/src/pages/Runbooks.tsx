import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { runbooksApi, templatesApi, type Runbook, type RunbookStep, type RunbookInput, type Template } from '../lib/api'
import { useProjectStore } from '../store/projectStore'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(s: string | null) {
  if (!s) return 'never'
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function newStep(order: number): RunbookStep {
  return { id: globalThis.crypto.randomUUID(), order, instruction: '' }
}

// ── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }
  return (
    <button onClick={copy} style={{
      fontSize: '10.5px', padding: '2px 8px', borderRadius: 4, cursor: 'default',
      background: copied ? 'rgba(34,197,94,.15)' : 'rgba(0,0,0,.35)',
      border: `1px solid ${copied ? 'rgba(34,197,94,.4)' : 'rgba(255,255,255,.1)'}`,
      color: copied ? '#22C55E' : '#94A3B8',
      transition: 'all .15s', backdropFilter: 'blur(4px)', flexShrink: 0,
    }}>
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

// ── StepRow (edit mode) ──────────────────────────────────────────────────────

function StepRow({ step, index, onUpdate, onDelete, onDragStart, onDragOver, onDrop }: {
  step: RunbookStep
  index: number
  onUpdate: (s: RunbookStep) => void
  onDelete: () => void
  onDragStart: () => void
  onDragOver:  (e: React.DragEvent) => void
  onDrop:      () => void
}) {
  const [showCmd,  setShowCmd]  = useState(!!step.command)
  const [showNote, setShowNote] = useState(!!step.note)

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={e => { e.preventDefault(); onDragOver(e) }}
      onDrop={e => { e.preventDefault(); onDrop() }}
      style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line)' }}
    >
      {/* Drag handle */}
      <span style={{ color: 'var(--fg-4)', cursor: 'grab', fontSize: 14, paddingTop: 6, flexShrink: 0, userSelect: 'none' }}>⠿</span>

      {/* Step number */}
      <span style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
        display: 'grid', placeItems: 'center',
        fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', marginTop: 4,
      }}>
        {index + 1}
      </span>

      {/* Fields */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <input
          value={step.instruction}
          onChange={e => onUpdate({ ...step, instruction: e.target.value })}
          placeholder="Step instruction…"
          style={{ background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 5, padding: '5px 9px', color: 'var(--fg)', fontSize: '13px', outline: 'none', width: '100%', boxSizing: 'border-box' }}
        />

        {showCmd && (
          <textarea
            value={step.command ?? ''}
            onChange={e => onUpdate({ ...step, command: e.target.value || undefined })}
            placeholder="Command to run…"
            rows={2}
            style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: '#0d1117', color: '#e6edf3', border: '1px solid rgba(255,255,255,.08)', borderRadius: 5, padding: '6px 10px', resize: 'vertical', outline: 'none', width: '100%', boxSizing: 'border-box', lineHeight: 1.6 }}
          />
        )}

        {showNote && (
          <input
            value={step.note ?? ''}
            onChange={e => onUpdate({ ...step, note: e.target.value || undefined })}
            placeholder="Note or context…"
            style={{ background: 'transparent', border: '1px dashed var(--line)', borderRadius: 5, padding: '4px 9px', color: 'var(--fg-3)', fontSize: '12px', fontStyle: 'italic', outline: 'none', width: '100%', boxSizing: 'border-box' }}
          />
        )}

        <div style={{ display: 'flex', gap: 6 }}>
          {!showCmd  && <button onClick={() => setShowCmd(true)}  style={{ fontSize: '10.5px', padding: '1px 7px', borderRadius: 3, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>+ command</button>}
          {!showNote && <button onClick={() => setShowNote(true)} style={{ fontSize: '10.5px', padding: '1px 7px', borderRadius: 3, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>+ note</button>}
        </div>
      </div>

      {/* Delete */}
      <button onClick={onDelete} style={{ fontSize: 13, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'default', padding: '4px 2px', marginTop: 2, flexShrink: 0 }}>✕</button>
    </div>
  )
}

// ── RunbookCard (left list) ──────────────────────────────────────────────────

function RunbookCard({ rb, selected, onClick, onMarkUsed }: {
  rb: Runbook
  selected: boolean
  onClick: () => void
  onMarkUsed: (updated: Runbook) => void
}) {
  const [marking, setMarking] = useState(false)

  async function handleMarkUsed(e: React.MouseEvent) {
    e.stopPropagation()
    setMarking(true)
    try {
      const updated = await runbooksApi.use(rb.id)
      onMarkUsed(updated)
    } finally {
      setMarking(false)
    }
  }

  return (
    <div
      onClick={onClick}
      tabIndex={0}
      role="button"
      aria-label={`Open runbook: ${rb.title}`}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
      style={{
        padding: '10px 12px', borderRadius: 6, cursor: 'default',
        background: selected ? 'var(--bg-elev-2)' : 'transparent',
        border: `1px solid ${selected ? 'var(--line-2)' : 'transparent'}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 3 }}>
        <span style={{ flex: 1, fontSize: '13px', fontWeight: 500, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {rb.title}
        </span>
        <button
          onClick={handleMarkUsed}
          aria-label="Mark runbook as used"
          disabled={marking}
          style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(34,197,94,.4)', background: 'rgba(34,197,94,.08)', color: '#22C55E', flexShrink: 0, opacity: marking ? 0.5 : 1 }}
        >
          ✓
        </button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '11px', color: 'var(--fg-4)' }}>
        <span>{rb.steps.length} step{rb.steps.length !== 1 ? 's' : ''}</span>
        {rb.project_name && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: rb.project_color ?? 'var(--fg-3)' }} />
            {rb.project_name}
          </span>
        )}
        <span style={{ marginLeft: 'auto' }}>used: {fmtDate(rb.last_used_at)}</span>
      </div>
      {rb.tags.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
          {rb.tags.map(t => (
            <span key={t} style={{ fontSize: '10px', padding: '0 5px', borderRadius: 3, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── RunbookDetail ────────────────────────────────────────────────────────────

function RunbookDetail({ rb, onUpdate, onDelete, onUsed }: {
  rb: Runbook
  onUpdate: (id: string, body: Partial<RunbookInput>) => Promise<Runbook>
  onDelete: (id: string) => void
  onUsed:   (updated: Runbook) => void
}) {
  const [title,      setTitle]      = useState(rb.title)
  const [steps,      setSteps]      = useState<RunbookStep[]>(rb.steps)
  const [editMode,   setEditMode]   = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)
  const [saving,     setSaving]     = useState(false)
  const dragIdx = useRef<number | null>(null)

  useEffect(() => {
    setTitle(rb.title)
    setSteps(rb.steps)
    setEditMode(false)
    setHasChanges(false)
    setConfirmDel(false)
  }, [rb.id])

  function updateSteps(next: RunbookStep[]) {
    setSteps(next)
    setHasChanges(true)
  }

  function addStep() {
    updateSteps([...steps, newStep(steps.length)])
  }

  function updateStep(i: number, s: RunbookStep) {
    const next = [...steps]; next[i] = s
    updateSteps(next)
  }

  function deleteStep(i: number) {
    updateSteps(steps.filter((_, j) => j !== i).map((s, j) => ({ ...s, order: j })))
  }

  function onDrop(targetIdx: number) {
    if (dragIdx.current === null || dragIdx.current === targetIdx) return
    const next = [...steps]
    const [moved] = next.splice(dragIdx.current, 1)
    next.splice(targetIdx, 0, moved)
    updateSteps(next.map((s, j) => ({ ...s, order: j })))
    dragIdx.current = null
  }

  async function save() {
    setSaving(true)
    try {
      await onUpdate(rb.id, { title: title.trim() || rb.title, steps })
      setHasChanges(false)
    } finally {
      setSaving(false)
    }
  }

  async function markUsed() {
    const updated = await runbooksApi.use(rb.id)
    onUsed(updated)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Detail header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            value={title}
            onChange={e => { setTitle(e.target.value); setHasChanges(true) }}
            style={{ flex: 1, background: 'none', border: 'none', color: 'var(--fg)', fontSize: '17px', fontWeight: 600, padding: 0, outline: 'none' }}
          />
          {!confirmDel
            ? <button onClick={() => setConfirmDel(true)} style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>Delete</button>
            : <>
                <button onClick={() => onDelete(rb.id)} style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>Confirm</button>
                <button onClick={() => setConfirmDel(false)} style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>Cancel</button>
              </>
          }
        </div>

        {/* Meta + actions row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {rb.project_name && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: rb.project_color ?? 'var(--fg-3)' }} />
              {rb.project_name}
            </span>
          )}
          {rb.tags.map(t => (
            <span key={t} style={{ fontSize: '11px', padding: '1px 7px', borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', color: 'var(--fg-3)' }}>{t}</span>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--fg-4)' }}>Last used: {fmtDate(rb.last_used_at)}</span>
          <button
            onClick={() => window.open(`${window.location.pathname}?open=${rb.id}&print=1`, '_blank')}
            aria-label="Open print view"
            style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)' }}
          >
            ⎙ Print
          </button>
          <button onClick={markUsed} aria-label="Mark runbook as used" style={{ fontSize: '11.5px', padding: '4px 12px', borderRadius: 5, border: '1px solid #22C55E', background: 'rgba(34,197,94,.1)', color: '#22C55E' }}>
            ✓ Mark as Used
          </button>
          <button onClick={() => setEditMode(v => !v)} style={{ fontSize: '11.5px', padding: '4px 10px', borderRadius: 5, border: `1px solid ${editMode ? 'var(--accent)' : 'var(--line)'}`, background: editMode ? 'var(--accent-dim)' : 'none', color: editMode ? 'var(--accent-2)' : 'var(--fg-3)' }}>
            {editMode ? 'View' : 'Edit'}
          </button>
        </div>
      </div>

      {/* Steps area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em' }}>
            {steps.length} Step{steps.length !== 1 ? 's' : ''}
          </span>
          {editMode && (
            <button onClick={addStep} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
              + Add Step
            </button>
          )}
        </div>

        {editMode
          ? /* Edit mode: draggable step editors */
            steps.length === 0
              ? <div style={{ padding: '20px 0', textAlign: 'center', fontSize: '13px', color: 'var(--fg-4)' }}>No steps yet — add one above</div>
              : steps.map((step, i) => (
                  <StepRow
                    key={step.id}
                    step={step}
                    index={i}
                    onUpdate={s => updateStep(i, s)}
                    onDelete={() => deleteStep(i)}
                    onDragStart={() => { dragIdx.current = i }}
                    onDragOver={() => {}}
                    onDrop={() => onDrop(i)}
                  />
                ))

          : /* View mode: numbered steps with command blocks */
            steps.length === 0
              ? <div style={{ padding: '20px 0', textAlign: 'center', fontSize: '13px', color: 'var(--fg-4)' }}>No steps — click Edit to add some</div>
              : steps.map((step, i) => (
                  <div key={step.id} style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }}>
                    {/* Step number */}
                    <div style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                      background: 'var(--accent-dim)', border: '1px solid var(--accent-line)',
                      display: 'grid', placeItems: 'center',
                      fontSize: '12px', fontWeight: 700, color: 'var(--accent-2)',
                    }}>
                      {i + 1}
                    </div>

                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Instruction */}
                      <p style={{ margin: 0, fontSize: '13.5px', color: 'var(--fg)', lineHeight: 1.55 }}>
                        {step.instruction}
                      </p>

                      {/* Command */}
                      {step.command && (
                        <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,.08)' }}>
                          <pre style={{ margin: 0, padding: '10px 14px', background: '#0d1117', color: '#e6edf3', fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: 1.6, overflowX: 'auto' }}>
                            {step.command}
                          </pre>
                          <div style={{ position: 'absolute', top: 6, right: 8 }}>
                            <CopyButton text={step.command} />
                          </div>
                        </div>
                      )}

                      {/* Note */}
                      {step.note && (
                        <p style={{ margin: 0, fontSize: '12px', color: 'var(--fg-3)', fontStyle: 'italic', lineHeight: 1.5 }}>
                          {step.note}
                        </p>
                      )}
                    </div>
                  </div>
                ))
        }

        {/* Save button (edit mode) */}
        {editMode && hasChanges && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={save} disabled={saving} style={{ padding: '7px 18px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── NewRunbookModal ──────────────────────────────────────────────────────────

function NewRunbookModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (rb: Runbook) => void
}) {
  const { projects, selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [title,     setTitle]     = useState('')
  const [projectId, setProjectId] = useState(proj?.id ?? '')
  const [tagsRaw,   setTagsRaw]   = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('')
  const [tempSteps, setTempSteps] = useState<any[]>([])
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    templatesApi.list({ type: 'runbook', projectId: projectId || undefined })
      .then(setTemplates)
      .catch(() => {})
  }, [projectId])

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplateId(templateId)
    if (!templateId) {
      setTempSteps([])
      return
    }
    const t = templates.find(x => x.id === templateId)
    if (t && t.body) {
      if (Array.isArray(t.body.steps)) {
        setTempSteps(t.body.steps)
      } else {
        setTempSteps([])
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required'); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      const steps: RunbookStep[] = tempSteps.map((s, i) => ({
        id: globalThis.crypto.randomUUID(),
        order: i,
        instruction: s.instruction,
        command: s.command || undefined,
        note: s.note || undefined,
      }))
      const rb = await runbooksApi.create({ title: title.trim(), project_id: projectId || null, tags, steps })
      onCreate(rb)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-rb-dialog-title"
        className="modal-panel"
        style={{ width: 420, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', overflow: 'hidden' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span id="new-rb-dialog-title" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>New Runbook</span>
          <button onClick={onClose} aria-label="Close dialog" style={{ fontSize: 16, color: 'var(--fg-3)', background: 'none', border: 'none' }}>✕</button>
        </div>
        <form id="new-rb-form" onSubmit={submit} style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Use template</label>
            <select value={selectedTemplateId} onChange={e => handleTemplateSelect(e.target.value)} style={{ ...inp, cursor: 'default', color: selectedTemplateId ? 'var(--fg)' : 'var(--fg-3)' }}>
              <option value="">No template (blank)</option>
              {templates.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.project_name ? ` · ${t.project_name}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Deploy to Production" autoFocus style={inp} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Project</label>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inp, cursor: 'default' }}>
              <option value="">— Global —</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Tags (comma-separated)</label>
            <input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="deploy, backend, docker" style={inp} />
          </div>
        </form>
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {error && <span style={{ flex: 1, fontSize: '12px', color: '#EF4444' }}>{error}</span>}
          <button type="button" onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button type="submit" form="new-rb-form" disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Creating…' : 'Create Runbook'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── RunbooksPage ─────────────────────────────────────────────────────────────

export function RunbooksPage() {
  const { selectedProject } = useProjectStore()
  const proj = selectedProject()
  const [searchParams] = useSearchParams()

  const [runbooks,    setRunbooks]    = useState<Runbook[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selectedId,  setSelectedId]  = useState<string | null>(searchParams.get('open'))
  const [search,      setSearch]      = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [showNew,     setShowNew]     = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isPrint = searchParams.get('print') === '1'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await runbooksApi.list({ projectId: proj?.id, search: search || undefined })
      setRunbooks(data)
    } catch { setRunbooks([]) }
    finally { setLoading(false) }
  }, [proj?.id, search])

  useEffect(() => { load() }, [load])

  // Keyboard shortcut: N = new runbook
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function handleSearch(v: string) {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(v), 250)
  }

  const selected = runbooks.find(r => r.id === selectedId) ?? null

  async function handleUpdate(id: string, body: Partial<RunbookInput>) {
    const updated = await runbooksApi.update(id, body)
    setRunbooks(prev => prev.map(r => r.id === id ? updated : r))
    return updated
  }

  function handleDelete(id: string) {
    runbooksApi.remove(id).then(() => {
      setRunbooks(prev => prev.filter(r => r.id !== id))
      setSelectedId(null)
    })
  }

  function handleUsed(updated: Runbook) {
    setRunbooks(prev => prev.map(r => r.id === updated.id ? updated : r))
  }

  // Print view — clean, no nav chrome
  if (isPrint && selectedId) {
    const rb = runbooks.find(r => r.id === selectedId)
    if (loading) return <div style={{ padding: 40, color: '#333' }}>Loading…</div>
    if (!rb) return <div style={{ padding: 40, color: '#333' }}>Runbook not found.</div>
    return (
      <div style={{ padding: '40px 48px', maxWidth: 720, margin: '0 auto', fontFamily: 'Georgia, serif', color: '#111', background: '#fff', minHeight: '100vh' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 8px' }}>{rb.title}</h1>
        {rb.project_name && <p style={{ margin: '0 0 4px', fontSize: 14, color: '#555' }}>Project: {rb.project_name}</p>}
        <p style={{ margin: '0 0 32px', fontSize: 13, color: '#888' }}>
          {rb.steps.length} step{rb.steps.length !== 1 ? 's' : ''} · Last used: {fmtDate(rb.last_used_at)}
        </p>
        <hr style={{ border: 'none', borderTop: '1px solid #ddd', marginBottom: 32 }} />
        {rb.steps.map((step, i) => (
          <div key={step.id} style={{ display: 'flex', gap: 20, marginBottom: 28 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid #6366F1', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700, color: '#6366F1', flexShrink: 0, marginTop: 2 }}>
              {i + 1}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 8px', fontSize: 15, lineHeight: 1.6, color: '#111' }}>{step.instruction}</p>
              {step.command && (
                <pre style={{ margin: '0 0 8px', padding: '10px 14px', background: '#f5f5f5', borderRadius: 5, border: '1px solid #e0e0e0', fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, overflowX: 'auto', color: '#222' }}>
                  {step.command}
                </pre>
              )}
              {step.note && <p style={{ margin: 0, fontSize: 13, color: '#666', fontStyle: 'italic' }}>{step.note}</p>}
            </div>
          </div>
        ))}
        <p style={{ marginTop: 40, fontSize: 11, color: '#aaa' }}>Generated by DevBrain · {new Date().toLocaleDateString()}</p>
      </div>
    )
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Runbooks</h1>
        {proj && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: proj.color }} />
            {proj.name}
          </span>
        )}
        <button onClick={() => setShowNew(true)} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
          + New Runbook
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left list */}
        <div style={{ width: 300, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          <div style={{ padding: '10px 10px 6px' }}>
            <input
              value={searchInput}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search runbooks…"
              style={{ width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', color: 'var(--fg)', fontSize: '12.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
            {loading
              ? <div style={{ padding: 20, textAlign: 'center', fontSize: '12px', color: 'var(--fg-3)' }}>Loading…</div>
              : runbooks.length === 0
                ? <div style={{ padding: 20, textAlign: 'center', fontSize: '12px', color: 'var(--fg-3)' }}>
                    {search ? `No runbooks matching "${search}"` : 'No runbooks yet'}
                  </div>
                : runbooks.map(rb => (
                    <RunbookCard
                      key={rb.id}
                      rb={rb}
                      selected={rb.id === selectedId}
                      onClick={() => setSelectedId(rb.id)}
                      onMarkUsed={handleUsed}
                    />
                  ))
            }
          </div>

          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: '11px', color: 'var(--fg-4)' }}>
            {runbooks.length} runbook{runbooks.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Right detail */}
        {selected
          ? <RunbookDetail
              key={selected.id}
              rb={selected}
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onUsed={handleUsed}
            />
          : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--fg-3)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: '20px' }}>
                ▶
              </div>
              <p style={{ margin: 0, fontSize: '13px' }}>
                {runbooks.length > 0 ? 'Select a runbook to view it' : 'No runbooks yet — create one'}
              </p>
            </div>
        }
      </div>

      {showNew && (
        <NewRunbookModal
          onClose={() => setShowNew(false)}
          onCreate={rb => { setRunbooks(prev => [rb, ...prev]); setSelectedId(rb.id); setShowNew(false) }}
        />
      )}
    </div>
  )
}

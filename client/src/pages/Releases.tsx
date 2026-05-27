import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { releasesApi, gitApi, type Release, type ReleaseInput, type AiReleaseNotes } from '../lib/api'
import { useProjectStore } from '../store/projectStore'

// ── Constants ────────────────────────────────────────────────────────────────

const TYPE_STYLE: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  major:  { dot: '#EF4444', bg: 'rgba(239,68,68,.12)',   text: '#EF4444', border: 'rgba(239,68,68,.3)' },
  minor:  { dot: '#6366F1', bg: 'rgba(99,102,241,.12)',  text: '#818CF8', border: 'rgba(99,102,241,.3)' },
  patch:  { dot: '#22C55E', bg: 'rgba(34,197,94,.12)',   text: '#22C55E', border: 'rgba(34,197,94,.3)' },
  hotfix: { dot: '#F59E0B', bg: 'rgba(245,158,11,.12)',  text: '#F59E0B', border: 'rgba(245,158,11,.3)' },
}

function typeStyle(t: string) { return TYPE_STYLE[t] ?? TYPE_STYLE.patch }

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function today() { return new Date().toISOString().split('T')[0] }

// ── ItemList — editable bullet list ─────────────────────────────────────────

function ItemList({ items, color, onChange }: {
  items: string[]
  color: string
  onChange: (items: string[]) => void
}) {
  const [drafts, setDrafts] = useState(items)
  const [newItem, setNewItem] = useState('')

  useEffect(() => setDrafts(items), [items])

  function commit(newDrafts: string[]) {
    setDrafts(newDrafts)
    onChange(newDrafts.filter(Boolean))
  }

  function update(i: number, v: string) {
    const next = [...drafts]; next[i] = v; commit(next)
  }

  function remove(i: number) {
    commit(drafts.filter((_, j) => j !== i))
  }

  function add() {
    if (!newItem.trim()) return
    commit([...drafts, newItem.trim()])
    setNewItem('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {drafts.map((item, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
          <span style={{ color, marginTop: 3, flexShrink: 0, fontSize: 12 }}>•</span>
          <input
            value={item}
            onChange={e => update(i, e.target.value)}
            style={{ flex: 1, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 4, padding: '3px 8px', color: 'var(--fg)', fontSize: '12.5px', outline: 'none' }}
          />
          <button onClick={() => remove(i)} style={{ fontSize: 12, color: 'var(--fg-4)', background: 'none', border: 'none', cursor: 'default', padding: '3px 4px', flexShrink: 0 }}>✕</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <span style={{ color: 'var(--fg-4)', marginTop: 3, flexShrink: 0, fontSize: 12 }}>+</span>
        <input
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder="Add item… (Enter to add)"
          style={{ flex: 1, background: 'transparent', border: '1px dashed var(--line)', borderRadius: 4, padding: '3px 8px', color: 'var(--fg-3)', fontSize: '12.5px', outline: 'none' }}
        />
      </div>
    </div>
  )
}

// ── ReleaseModal — create or edit ────────────────────────────────────────────

function ReleaseModal({ initial, onClose, onSave }: {
  initial?: Partial<ReleaseInput> & { id?: string }
  onClose: () => void
  onSave: (r: Release) => void
}) {
  const { projects, selectedProject } = useProjectStore()
  const proj = selectedProject()

  const isEdit = !!initial?.id

  const [projectId,  setProjectId]  = useState(initial?.project_id ?? proj?.id ?? projects[0]?.id ?? '')
  const [version,    setVersion]    = useState(initial?.version ?? '')
  const [date,       setDate]       = useState(initial?.date ?? today())
  const [type,       setType]       = useState<ReleaseInput['type']>(initial?.type ?? 'patch')
  const [features,   setFeatures]   = useState<string[]>(initial?.features ?? [])
  const [fixes,      setFixes]      = useState<string[]>(initial?.fixes ?? [])
  const [breaking,   setBreaking]   = useState<string[]>(initial?.breaking_changes ?? [])
  const [notes,      setNotes]      = useState(initial?.notes ?? '')

  // AI generation
  const [showAi,     setShowAi]     = useState(false)
  const [commits,    setCommits]    = useState('')
  const [generating, setGenerating] = useState(false)
  const [aiError,    setAiError]    = useState('')

  const [saving, setSaving]  = useState(false)
  const [error,  setError]   = useState('')

  async function generate() {
    if (!commits.trim()) return
    setGenerating(true); setAiError('')
    try {
      const result: AiReleaseNotes = await releasesApi.aiGenerate(commits)
      if (result.features?.length)   setFeatures(result.features)
      if (result.fixes?.length)      setFixes(result.fixes)
      if (result.breaking_changes?.length) setBreaking(result.breaking_changes)
      if (result.notes)              setNotes(result.notes)
      setShowAi(false)
    } catch (e) {
      setAiError((e as Error).message)
    } finally {
      setGenerating(false)
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!version.trim()) { setError('Version is required'); return }
    if (!projectId)       { setError('Project is required'); return }
    setSaving(true); setError('')
    try {
      const body: ReleaseInput = { project_id: projectId, version: version.trim(), date, type, features, fixes, breaking_changes: breaking, notes, linked_issues: initial?.linked_issues ?? [] }
      const saved = isEdit
        ? await releasesApi.update(initial!.id!, { version: body.version, date: body.date, type: body.type, features: body.features, fixes: body.fixes, breaking_changes: body.breaking_changes, notes: body.notes, linked_issues: body.linked_issues })
        : await releasesApi.create(body)
      onSave(saved)
    } catch (e) {
      setError((e as Error).message)
      setSaving(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
      <div style={{ width: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>{isEdit ? 'Edit Release' : 'New Release'}</span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        <form id="release-form" onSubmit={submit} style={{ flex: 1, overflowY: 'auto', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Row: version + date + type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Version *</label>
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="v1.2.3" style={inp} />
            </div>
            <div>
              <label style={lbl}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, cursor: 'default' }} />
            </div>
            <div>
              <label style={lbl}>Type</label>
              <select value={type} onChange={e => setType(e.target.value as ReleaseInput['type'])} style={{ ...inp, cursor: 'default' }}>
                <option value="patch">patch</option>
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="hotfix">hotfix</option>
              </select>
            </div>
          </div>

          {/* Project (only when no project selected) */}
          {!proj && (
            <div>
              <label style={lbl}>Project *</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inp, cursor: 'default' }}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* AI Generate */}
          <div style={{ borderRadius: 7, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAi ? 8 : 0 }}>
              <span style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--accent-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 10 }}>◆</span> Generate from commit messages
              </span>
              <button type="button" onClick={() => setShowAi(v => !v)} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--accent-line)', background: 'none', color: 'var(--accent-2)', cursor: 'default' }}>
                {showAi ? 'Hide' : 'Expand'}
              </button>
            </div>
            {showAi && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <textarea
                  value={commits}
                  onChange={e => setCommits(e.target.value)}
                  placeholder={'Paste git log output or commit messages:\n\nfeat: add command palette with Ctrl+K shortcut\nfix: server not restarting after port conflict\nfeat: Shiki syntax highlighting for 8 languages\nrefactor: unified AI client in services/ai.ts'}
                  rows={5}
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--accent-line)', borderRadius: 5, padding: '8px 10px', color: 'var(--fg)', fontSize: '12px', fontFamily: 'var(--font-mono)', lineHeight: 1.5, resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
                />
                {aiError && <span style={{ fontSize: '11.5px', color: '#EF4444' }}>{aiError}</span>}
                <button type="button" onClick={generate} disabled={generating || !commits.trim()} style={{ alignSelf: 'flex-start', padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default', opacity: generating ? 0.6 : 1 }}>
                  {generating ? 'Generating…' : '◆ Generate Notes'}
                </button>
              </div>
            )}
          </div>

          {/* Notes summary */}
          <div>
            <label style={lbl}>Summary / Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Brief description of this release…" rows={2} style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          {/* Features */}
          <div>
            <label style={lbl}>✦ Features</label>
            <ItemList items={features} color="#22C55E" onChange={setFeatures} />
          </div>

          {/* Fixes */}
          <div>
            <label style={lbl}>○ Fixes</label>
            <ItemList items={fixes} color="#64748B" onChange={setFixes} />
          </div>

          {/* Breaking changes */}
          <div>
            <label style={lbl}>⚠ Breaking Changes</label>
            <ItemList items={breaking} color="#EF4444" onChange={setBreaking} />
          </div>

        </form>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {error && <span style={{ flex: 1, fontSize: '12px', color: '#EF4444' }}>{error}</span>}
          <button type="button" onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button type="submit" form="release-form" disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Release'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ReleaseCard ──────────────────────────────────────────────────────────────

function ReleaseCard({ release, onEdit, onDelete }: {
  release: Release
  onEdit: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const [expanded,    setExpanded]    = useState(true)
  const [confirmDel,  setConfirmDel]  = useState(false)
  const [qaInput,     setQaInput]     = useState('')
  const [qaAnswer,    setQaAnswer]    = useState('')
  const [qaLoading,   setQaLoading]   = useState(false)

  async function askQa() {
    if (!qaInput.trim()) return
    setQaLoading(true)
    setQaAnswer('')
    try {
      const { answer } = await releasesApi.qa(release.id, qaInput.trim())
      setQaAnswer(answer)
    } catch {
      setQaAnswer('Failed to get an answer.')
    } finally {
      setQaLoading(false)
    }
  }

  const ts = typeStyle(release.type)
  const hasContent = release.features.length > 0 || release.fixes.length > 0 || release.breaking_changes.length > 0 || release.notes

  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
      {/* Timeline stem + dot */}
      <div style={{ width: 28, position: 'relative', flexShrink: 0 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, background: 'var(--line)', transform: 'translateX(-50%)' }} />
        <div style={{
          position: 'absolute', left: '50%', top: 14,
          transform: 'translateX(-50%)',
          width: 12, height: 12, borderRadius: '50%',
          background: ts.dot, border: '2px solid var(--bg)',
          boxShadow: `0 0 0 3px ${ts.dot}30`,
          zIndex: 1,
        }} />
      </div>

      {/* Card */}
      <div style={{ flex: 1, paddingLeft: 14, paddingBottom: 24 }}>
        {/* Card header */}
        <div
          onClick={() => setExpanded(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', marginBottom: expanded && hasContent ? 8 : 0, minHeight: 40 }}
        >
          {/* Version */}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '14px', fontWeight: 700, color: 'var(--fg)' }}>
            {release.version}
          </span>

          {/* Type badge */}
          <span style={{ fontSize: '10px', padding: '2px 7px', borderRadius: 10, background: ts.bg, color: ts.text, border: `1px solid ${ts.border}`, fontWeight: 600, letterSpacing: '.04em' }}>
            {release.type}
          </span>

          {/* Project pill (when viewing all projects) */}
          {release.project_name && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '11px', color: 'var(--fg-3)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: release.project_color }} />
              {release.project_name}
            </span>
          )}

          {/* Counts summary (when collapsed) */}
          {!expanded && hasContent && (
            <span style={{ fontSize: '11px', color: 'var(--fg-4)' }}>
              {[
                release.features.length     ? `${release.features.length} feature${release.features.length !== 1 ? 's' : ''}` : '',
                release.fixes.length        ? `${release.fixes.length} fix${release.fixes.length !== 1 ? 'es' : ''}` : '',
                release.breaking_changes.length ? `${release.breaking_changes.length} breaking` : '',
              ].filter(Boolean).join(' · ')}
            </span>
          )}

          {/* Date — right-aligned */}
          <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--fg-3)', flexShrink: 0 }}>
            {fmtDate(release.date)}
          </span>

          {/* Expand toggle */}
          <span style={{ fontSize: '11px', color: 'var(--fg-4)', marginLeft: 6 }}>
            {expanded ? '▴' : '▾'}
          </span>
        </div>

        {/* Card body */}
        {expanded && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Notes */}
            {release.notes && (
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6, fontStyle: 'italic' }}>
                {release.notes}
              </p>
            )}

            {/* Breaking changes — shown first and prominently */}
            {release.breaking_changes.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#EF4444', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>⚠</span> Breaking Changes
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.breaking_changes.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: '#EF4444', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Features */}
            {release.features.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#22C55E', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>✦</span> Features
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.features.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Fixes */}
            {release.fixes.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>○</span> Fixes
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {release.fixes.map((item, i) => (
                    <li key={i} style={{ fontSize: '13px', color: 'var(--fg-3)', lineHeight: 1.55 }}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Linked Issues */}
            {release.linked_issues.length > 0 && (
              <div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 6 }}>
                  Linked Issues
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {release.linked_issues.map(id => (
                    <button
                      key={id}
                      onClick={e => {
                        e.stopPropagation()
                        navigate('/issues?open=' + id)
                      }}
                      title={`Open issue ${id}`}
                      style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', fontFamily: 'var(--font-mono)', cursor: 'default' }}
                    >
                      #{id.slice(0, 8)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, paddingTop: hasContent ? 4 : 0, borderTop: hasContent ? '1px solid var(--line)' : 'none' }}>
              <button onClick={onEdit} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                Edit
              </button>
              {!confirmDel
                ? <button onClick={() => setConfirmDel(true)} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-4)', cursor: 'default' }}>
                    Delete
                  </button>
                : <>
                    <button onClick={() => { onDelete(); setConfirmDel(false) }} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDel(false)} style={{ fontSize: '11.5px', padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
                      Cancel
                    </button>
                  </>
              }
            </div>

            {/* Ask about this release */}
            <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={qaInput}
                  onChange={e => setQaInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); askQa() } }}
                  placeholder="Ask about this release…"
                  style={{
                    flex: 1, padding: '5px 9px', borderRadius: 5,
                    border: '1px solid var(--line)', background: 'var(--bg)',
                    color: 'var(--fg)', fontSize: '12px', outline: 'none',
                  }}
                />
                <button
                  onClick={askQa}
                  disabled={qaLoading || !qaInput.trim()}
                  title="Ask AI about this release"
                  style={{
                    width: 28, height: 28, borderRadius: 5, flexShrink: 0,
                    border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
                    color: 'var(--accent-2)', fontSize: '11px',
                    display: 'grid', placeItems: 'center',
                    cursor: qaLoading || !qaInput.trim() ? 'not-allowed' : 'default',
                    opacity: qaLoading || !qaInput.trim() ? 0.5 : 1,
                  }}
                >
                  {qaLoading ? '…' : '◆'}
                </button>
              </div>
              {qaAnswer && (
                <div style={{
                  padding: '8px 10px', borderRadius: 6,
                  border: '1px solid var(--line)', background: 'var(--bg)',
                  fontSize: '12.5px', color: 'var(--fg-2)', lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}>
                  {qaAnswer}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  )
}

// ── ImportGitModal ────────────────────────────────────────────────────────────

function ImportGitModal({ onClose, onImported }: { onClose: () => void; onImported: (r: Release) => void }) {
  const { projects, selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [projectId, setProjectId] = useState(proj?.id ?? projects[0]?.id ?? '')
  const [version,   setVersion]   = useState('')
  const [date,      setDate]      = useState(today())
  const [type,      setType]      = useState<ReleaseInput['type']>('patch')
  const [commits,    setCommits]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [ghBase,     setGhBase]     = useState('')
  const [ghHead,     setGhHead]     = useState('HEAD')
  const [fetching,   setFetching]   = useState(false)

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function handleFetchFromGitHub() {
    if (!projectId || !ghBase.trim()) { setError('Select project and enter base ref'); return }
    setFetching(true); setError('')
    try {
      const { commits: log } = await gitApi.compare(projectId, ghBase.trim(), ghHead.trim() || 'HEAD')
      setCommits(log)
    } catch (e) { setError((e as Error).message) }
    finally { setFetching(false) }
  }

  async function handleImport() {
    if (!commits.trim())  { setError('Commit messages are required'); return }
    if (!version.trim())  { setError('Version is required'); return }
    if (!projectId)       { setError('Project is required'); return }
    setLoading(true); setError('')
    try {
      const release = await releasesApi.importGit({ commits, project_id: projectId, version: version.trim(), date, type })
      onImported(release)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 560, maxHeight: '88vh', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-2)' }}>◆</span> Import from git log
          </span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Version / Date / Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Version *</label>
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="v1.2.3" style={inp} />
            </div>
            <div>
              <label style={lbl}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, cursor: 'default' }} />
            </div>
            <div>
              <label style={lbl}>Type</label>
              <select value={type} onChange={e => setType(e.target.value as ReleaseInput['type'])} style={{ ...inp, cursor: 'default' }}>
                <option value="patch">patch</option>
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="hotfix">hotfix</option>
              </select>
            </div>
          </div>

          {/* Project (only in all-projects view) */}
          {!proj && (
            <div>
              <label style={lbl}>Project *</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inp, cursor: 'default' }}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Fetch from GitHub */}
          {projectId && (
            <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                Fetch from GitHub
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={ghBase} onChange={e => setGhBase(e.target.value)} placeholder="Base (e.g. v1.0.0 or a SHA)" style={{ ...inp, flex: 1, minWidth: 120 }} />
                <span style={{ fontSize: 12, color: 'var(--fg-4)', flexShrink: 0 }}>→</span>
                <input value={ghHead} onChange={e => setGhHead(e.target.value)} placeholder="Head (default: HEAD)" style={{ ...inp, flex: 1, minWidth: 120 }} />
                <button onClick={handleFetchFromGitHub} disabled={fetching || !ghBase.trim()} style={{ padding: '6px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px', cursor: fetching ? 'not-allowed' : 'default', opacity: fetching || !ghBase.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {fetching ? 'Fetching…' : 'Fetch commits'}
                </button>
              </div>
            </div>
          )}

          {/* Commits */}
          <div>
            <label style={lbl}>Git log / commit messages *</label>
            <textarea
              value={commits}
              onChange={e => setCommits(e.target.value)}
              rows={7}
              placeholder={'Paste git log output or commit messages:\n\nfeat: add Q&A endpoint for releases\nfix: fix pagination on issues list\nchore: update dependencies\nrefactor: unify AI client across routes'}
              style={{ ...inp, resize: 'vertical', lineHeight: 1.55, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: 4 }}>
              Supports any format — <code style={{ fontFamily: 'var(--font-mono)' }}>git log --oneline</code> or <code style={{ fontFamily: 'var(--font-mono)' }}>git log --pretty=format:"%h %s"</code>
            </div>
          </div>

          {error && <span style={{ fontSize: '12px', color: '#EF4444' }}>{error}</span>}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid var(--accent)', background: loading ? 'var(--bg-elev)' : 'var(--accent)',
              color: loading ? 'var(--fg-4)' : 'white', fontSize: '13px',
              cursor: loading ? 'not-allowed' : 'default', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 9 }}>◆</span>
            {loading ? 'Importing…' : 'Import Release'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── CompareModal ─────────────────────────────────────────────────────────────

function CompareModal({ releases, onClose }: { releases: Release[]; onClose: () => void }) {
  const [id1,     setId1]     = useState('')
  const [id2,     setId2]     = useState('')
  const [summary, setSummary] = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none', cursor: 'default' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function compare() {
    if (!id1 || !id2 || id1 === id2) return
    setLoading(true); setError(''); setSummary('')
    try {
      const { summary: s } = await releasesApi.compare(id1, id2)
      setSummary(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const canCompare = !!id1 && !!id2 && id1 !== id2 && !loading

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 560, maxHeight: '80vh', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-2)' }}>◆</span> Compare Releases
          </span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Selects */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Release A</label>
              <select value={id1} onChange={e => setId1(e.target.value)} style={inp}>
                <option value="">Select release…</option>
                {releases.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.version} · {r.type}{r.project_name ? ` · ${r.project_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Release B</label>
              <select value={id2} onChange={e => setId2(e.target.value)} style={inp}>
                <option value="">Select release…</option>
                {releases.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.version} · {r.type}{r.project_name ? ` · ${r.project_name}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {id1 && id2 && id1 === id2 && (
            <span style={{ fontSize: '12px', color: '#F59E0B' }}>Select two different releases to compare.</span>
          )}
          {error && <span style={{ fontSize: '12px', color: '#EF4444' }}>{error}</span>}

          <button
            onClick={compare}
            disabled={!canCompare}
            style={{
              alignSelf: 'flex-start', padding: '6px 14px', borderRadius: 6,
              border: `1px solid ${canCompare ? 'var(--accent)' : 'var(--line)'}`,
              background: canCompare ? 'var(--accent)' : 'var(--bg-elev)',
              color: canCompare ? 'white' : 'var(--fg-4)',
              fontSize: '13px', cursor: canCompare ? 'default' : 'not-allowed',
              fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6,
              opacity: loading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 9 }}>◆</span>
            {loading ? 'Comparing…' : 'Compare'}
          </button>

          {summary && (
            <div style={{
              padding: '12px 14px', borderRadius: 7,
              border: '1px solid var(--line)', background: 'var(--bg)',
              fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.65, whiteSpace: 'pre-wrap',
            }}>
              {summary}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── DraftAiModal ─────────────────────────────────────────────────────────────

function DraftAiModal({ projectId, onClose, onDraft }: {
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

// ── ReleasesPage ─────────────────────────────────────────────────────────────

export function ReleasesPage() {
  const { selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [releases,      setReleases]      = useState<Release[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showNew,       setShowNew]       = useState(false)
  const [editing,       setEditing]       = useState<Release | null>(null)
  const [showCompare,   setShowCompare]   = useState(false)
  const [showImportGit, setShowImportGit] = useState(false)
  const [showDraftAi,   setShowDraftAi]   = useState(false)
  const [draftInitial,  setDraftInitial]  = useState<Partial<ReleaseInput> | undefined>()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await releasesApi.list({ projectId: proj?.id })
      setReleases(data)
    } catch { setReleases([]) }
    finally { setLoading(false) }
  }, [proj?.id])

  useEffect(() => { load() }, [load])

  function handleSave(r: Release) {
    setReleases(prev => {
      const idx = prev.findIndex(x => x.id === r.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next }
      return [r, ...prev]
    })
    setShowNew(false)
    setEditing(null)
  }

  function handleDelete(id: string) {
    releasesApi.remove(id).then(() => setReleases(prev => prev.filter(r => r.id !== id)))
  }

  // Summary stats
  const stats = {
    total:    releases.length,
    major:    releases.filter(r => r.type === 'major').length,
    minor:    releases.filter(r => r.type === 'minor').length,
    patch:    releases.filter(r => r.type === 'patch').length,
    hotfix:   releases.filter(r => r.type === 'hotfix').length,
    features: releases.reduce((s, r) => s + r.features.length, 0),
    fixes:    releases.reduce((s, r) => s + r.fixes.length, 0),
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Releases</h1>
        {proj && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: proj.color }} />
            {proj.name}
          </span>
        )}

        {/* Stats */}
        {!loading && releases.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginLeft: 8 }}>
            {[
              { label: 'major',  count: stats.major,  ts: typeStyle('major') },
              { label: 'minor',  count: stats.minor,  ts: typeStyle('minor') },
              { label: 'patch',  count: stats.patch,  ts: typeStyle('patch') },
              { label: 'hotfix', count: stats.hotfix, ts: typeStyle('hotfix') },
            ].filter(s => s.count > 0).map(s => (
              <span key={s.label} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: 10, background: s.ts.bg, color: s.ts.text, border: `1px solid ${s.ts.border}` }}>
                {s.count} {s.label}
              </span>
            ))}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {releases.length >= 2 && (
            <button onClick={() => setShowCompare(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, color: 'var(--accent-2)' }}>◆</span> Compare
            </button>
          )}
          <button onClick={() => setShowImportGit(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, color: 'var(--accent-2)' }}>◆</span> Import
          </button>
          {proj && (
            <button onClick={() => setShowDraftAi(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
              ✦ Draft with AI
            </button>
          )}
          <button onClick={() => setShowNew(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
            + New Release
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
        {loading
          ? <div style={{ textAlign: 'center', padding: 40, fontSize: '13px', color: 'var(--fg-3)' }}>Loading…</div>
          : releases.length === 0
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 0', color: 'var(--fg-3)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: '20px' }}>
                  🏷
                </div>
                <p style={{ margin: 0, fontSize: '13px' }}>
                  No releases yet
                  {proj ? ` for ${proj.name}` : ''} — <span onClick={() => setShowNew(true)} style={{ color: 'var(--accent-2)', cursor: 'default', textDecoration: 'underline' }}>create one</span>
                </p>
              </div>
            : (
              <div style={{ maxWidth: 780 }}>
                {/* Top cap for timeline */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
                  <div style={{ width: 28, position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, height: 14, width: 2, background: 'var(--line)', transform: 'translateX(-50%)' }} />
                  </div>
                  <div style={{ flex: 1 }} />
                </div>

                {releases.map(r => (
                  <ReleaseCard
                    key={r.id}
                    release={r}
                    onEdit={() => setEditing(r)}
                    onDelete={() => handleDelete(r.id)}
                  />
                ))}

                {/* Stats footer */}
                <div style={{ marginTop: 16, marginLeft: 42, padding: '10px 14px', borderRadius: 7, background: 'var(--bg-elev)', border: '1px solid var(--line)', fontSize: '12px', color: 'var(--fg-3)', display: 'flex', gap: 20 }}>
                  <span>{stats.total} releases</span>
                  <span>✦ {stats.features} features shipped</span>
                  <span>○ {stats.fixes} fixes</span>
                </div>
              </div>
            )
        }
      </div>

      {showNew && (
        <ReleaseModal
          initial={draftInitial ?? (proj ? { project_id: proj.id } : undefined)}
          onClose={() => { setShowNew(false); setDraftInitial(undefined) }}
          onSave={handleSave}
        />
      )}
      {editing && (
        <ReleaseModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {showCompare && (
        <CompareModal
          releases={releases}
          onClose={() => setShowCompare(false)}
        />
      )}
      {showImportGit && (
        <ImportGitModal
          onClose={() => setShowImportGit(false)}
          onImported={r => { handleSave(r); setShowImportGit(false) }}
        />
      )}
      {showDraftAi && proj && (
        <DraftAiModal
          projectId={proj.id}
          onClose={() => setShowDraftAi(false)}
          onDraft={draft => {
            setDraftInitial(draft)
            setShowDraftAi(false)
            setShowNew(true)
          }}
        />
      )}
    </div>
  )
}

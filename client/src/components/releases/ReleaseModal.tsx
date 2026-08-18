import { useState, useEffect } from 'react'
import { releasesApi, type Release, type ReleaseInput, type AiReleaseNotes } from '../../lib/api'
import { useProjectStore } from '../../store/projectStore'
import { ComponentInput } from '../ComponentInput'
import { ItemList } from './ItemList'
import { today } from './shared'

// ── ReleaseModal — create or edit ────────────────────────────────────────────

export function ReleaseModal({ initial, onClose, onSave }: {
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
  const [component,  setComponent]  = useState(initial?.component ?? '')
  const [componentOptions, setComponentOptions] = useState<string[]>([])

  useEffect(() => {
    releasesApi.components(projectId || undefined).then(setComponentOptions).catch(() => setComponentOptions([]))
  }, [projectId])

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
      const body: ReleaseInput = { project_id: projectId, version: version.trim(), date, type, features, fixes, breaking_changes: breaking, notes, linked_issues: initial?.linked_issues ?? [], component: component.trim() || null }
      const saved = isEdit
        ? await releasesApi.update(initial!.id!, { version: body.version, date: body.date, type: body.type, features: body.features, fixes: body.fixes, breaking_changes: body.breaking_changes, notes: body.notes, linked_issues: body.linked_issues, component: body.component })
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

          {/* Component */}
          <div>
            <label style={lbl}>Component</label>
            <ComponentInput value={component} onChange={setComponent} options={componentOptions} />
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

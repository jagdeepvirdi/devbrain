import { useState, useEffect, useRef } from 'react'
import type { Project, ProjectInput } from '../../lib/api'

const PRESET_COLORS = [
  '#6366F1', '#2ECC71', '#F59E0B', '#8B5CF6',
  '#EC4899', '#60A5FA', '#F05A5A', '#2DD4BF',
  '#E6C341', '#FF9D4D', '#4ADE80', '#A78BFA',
]

const TYPE_OPTIONS: Project['type'][] = ['web', 'mobile', 'desktop', 'fintech', 'tool']
const STATUS_OPTIONS: Project['status'][] = ['active', 'paused', 'planning']

type Props = {
  project?: Project | null
  onSave:   (data: ProjectInput) => Promise<void>
  onClose:  () => void
}

export function ProjectModal({ project, onSave, onClose }: Props) {
  const isEdit = !!project
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stackInput, setStackInput] = useState('')

  const [form, setForm] = useState<ProjectInput>({
    name:        project?.name        ?? '',
    short_name:  project?.short_name  ?? '',
    description: project?.description ?? '',
    color:       project?.color       ?? '#6366F1',
    status:      project?.status      ?? 'active',
    tech_stack:  project?.tech_stack  ?? [],
    type:        project?.type        ?? 'web',
    repo_url:    project?.repo_url    ?? '',
  })

  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { nameRef.current?.focus() }, [])

  // Auto-generate short_name from name when creating
  useEffect(() => {
    if (isEdit) return
    setForm(f => ({
      ...f,
      short_name: f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30),
    }))
  }, [form.name, isEdit])

  function set<K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) {
    setForm(f => ({ ...f, [key]: value }))
    setError(null)
  }

  function addStackTag() {
    const tag = stackInput.trim()
    if (!tag || form.tech_stack.includes(tag)) { setStackInput(''); return }
    set('tech_stack', [...form.tech_stack, tag])
    setStackInput('')
  }

  function removeStackTag(tag: string) {
    set('tech_stack', form.tech_stack.filter(t => t !== tag))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // Close on backdrop click
  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const css: Record<string, React.CSSProperties> = {
    backdrop: {
      position: 'fixed', inset: 0,
      background: 'rgba(5,5,10,.65)',
      backdropFilter: 'blur(4px)',
      zIndex: 200,
      display: 'grid',
      placeItems: 'center',
      padding: '24px',
    },
    modal: {
      background: 'var(--bg-elev)',
      border: '1px solid var(--line-3)',
      borderRadius: '12px',
      boxShadow: '0 24px 60px rgba(0,0,0,.6)',
      width: '100%',
      maxWidth: '520px',
      maxHeight: '90vh',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      padding: '16px 20px',
      borderBottom: '1px solid var(--line)',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
    },
    body: {
      padding: '20px',
      overflowY: 'auto',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    },
    footer: {
      padding: '14px 20px',
      borderTop: '1px solid var(--line)',
      display: 'flex',
      justifyContent: 'flex-end',
      gap: '8px',
    },
    label: {
      display: 'block',
      fontSize: '11px',
      color: 'var(--fg-3)',
      textTransform: 'uppercase' as const,
      letterSpacing: '.07em',
      fontWeight: 600,
      marginBottom: '6px',
    },
    input: {
      width: '100%',
      padding: '7px 10px',
      background: 'var(--bg-elev-2)',
      border: '1px solid var(--line-2)',
      borderRadius: 'var(--radius)',
      fontSize: '13px',
      color: 'var(--fg)',
    },
    textarea: {
      width: '100%',
      padding: '7px 10px',
      background: 'var(--bg-elev-2)',
      border: '1px solid var(--line-2)',
      borderRadius: 'var(--radius)',
      fontSize: '13px',
      color: 'var(--fg)',
      resize: 'vertical' as const,
      minHeight: '64px',
    },
    row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
    select: {
      width: '100%',
      padding: '7px 10px',
      background: 'var(--bg-elev-2)',
      border: '1px solid var(--line-2)',
      borderRadius: 'var(--radius)',
      fontSize: '13px',
      color: 'var(--fg)',
    },
  }

  return (
    <div className="modal-overlay" style={css.backdrop} onClick={handleBackdrop}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-dialog-title"
        className="modal-panel"
        style={css.modal}
      >
        <div style={css.header}>
          <div style={{ width: 14, height: 14, borderRadius: 4, background: form.color, flexShrink: 0 }} />
          <h2 id="project-dialog-title" style={{ margin: 0, fontSize: '14px', fontWeight: 600 }}>
            {isEdit ? `Edit ${project.name}` : 'New Project'}
          </h2>
          <button onClick={onClose} aria-label="Close dialog" style={{ marginLeft: 'auto', color: 'var(--fg-3)', padding: '4px 8px', borderRadius: 'var(--radius)' }}>
            ✕
          </button>
        </div>

        <form id="project-form" onSubmit={handleSubmit} style={css.body}>
          {/* Name */}
          <div>
            <label style={css.label}>Name *</label>
            <input
              ref={nameRef}
              style={css.input}
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. PlayCru"
            />
          </div>

          {/* Short name + color */}
          <div style={css.row}>
            <div>
              <label style={css.label}>Short Name *</label>
              <input
                style={css.input}
                value={form.short_name}
                onChange={e => set('short_name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="playcru"
              />
            </div>
            <div>
              <label style={css.label}>Color</label>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <input
                  type="color"
                  value={form.color}
                  onChange={e => set('color', e.target.value)}
                  style={{ width: 32, height: 32, padding: 2, borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c} type="button"
                      onClick={() => set('color', c)}
                      style={{
                        width: 16, height: 16, borderRadius: 3,
                        background: c,
                        border: form.color === c ? '2px solid white' : '1px solid rgba(255,255,255,.2)',
                        cursor: 'default',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <label style={css.label}>Description</label>
            <textarea
              style={css.textarea}
              value={form.description}
              onChange={e => set('description', e.target.value)}
              placeholder="What is this project about?"
              rows={3}
            />
          </div>

          {/* Type + Status */}
          <div style={css.row}>
            <div>
              <label style={css.label}>Type</label>
              <select style={css.select} value={form.type} onChange={e => set('type', e.target.value as Project['type'])}>
                {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={css.label}>Status</label>
              <select style={css.select} value={form.status} onChange={e => set('status', e.target.value as Project['status'])}>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Tech stack */}
          <div>
            <label style={css.label}>Tech Stack</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {form.tech_stack.map(tag => (
                <span key={tag} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  padding: '2px 8px', borderRadius: '4px',
                  background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)',
                  fontSize: '11.5px', color: 'var(--fg-2)',
                }}>
                  {tag}
                  <button type="button" onClick={() => removeStackTag(tag)}
                    style={{ color: 'var(--fg-4)', fontSize: '11px', lineHeight: 1 }}>×</button>
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                style={{ ...css.input, flex: 1 }}
                value={stackInput}
                onChange={e => setStackInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStackTag() } }}
                placeholder="Flutter, Firebase… (Enter to add)"
              />
              <button type="button" onClick={addStackTag}
                style={{ padding: '0 12px', background: 'var(--bg-hover)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--fg-2)' }}>
                Add
              </button>
            </div>
          </div>

          {/* Repo URL */}
          <div>
            <label style={css.label}>Repo URL (optional)</label>
            <input
              style={css.input}
              value={form.repo_url ?? ''}
              onChange={e => set('repo_url', e.target.value)}
              placeholder="https://github.com/…"
            />
          </div>

        </form>

        <div style={css.footer}>
          {error && (
            <div style={{ flex: 1, padding: '6px 10px', background: 'rgba(240,90,90,.1)', border: '1px solid rgba(240,90,90,.3)', borderRadius: 'var(--radius)', fontSize: '12px', color: '#F8A8A8' }}>
              {error}
            </div>
          )}
          <button type="button" onClick={onClose}
            style={{ height: 26, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: '12px', marginLeft: error ? 0 : 'auto' }}>
            Cancel
          </button>
          <button
            type="submit"
            form="project-form"
            disabled={saving}
            style={{ height: 26, padding: '0 14px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'white', fontSize: '12px', border: 'none', opacity: saving ? .6 : 1 }}>
            {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create project'}
          </button>
        </div>
      </div>
    </div>
  )
}

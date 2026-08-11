import { useState, useEffect } from 'react'
import { commandsApi, type Command } from '../../lib/api'
import { useProjectStore } from '../../store/projectStore'
import { SUPPORTED_LANGS } from './highlighter'
import { ComponentInput } from '../ComponentInput'

export function NewCommandModal({ onClose, onCreate }: {
  onClose: () => void
  onCreate: (cmd: Command) => void
}) {
  const { projects } = useProjectStore()
  const { selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [title,      setTitle]      = useState('')
  const [command,    setCommand]    = useState('')
  const [language,   setLanguage]   = useState('bash')
  const [description,setDesc]       = useState('')
  const [projectId,  setProjectId]  = useState<string>(proj?.id ?? '')
  const [tagsRaw,    setTagsRaw]    = useState('')
  const [component,  setComponent]  = useState('')
  const [componentOptions, setComponentOptions] = useState<string[]>([])
  const [isFav,      setIsFav]      = useState(false)
  const [namespace,  setNamespace]  = useState<'team' | 'personal'>('team')
  const [saving,     setSaving]     = useState(false)
  const [error,      setError]      = useState('')

  useEffect(() => {
    commandsApi.components(projectId || undefined).then(setComponentOptions).catch(() => setComponentOptions([]))
  }, [projectId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !command.trim()) { setError('Title and command are required.'); return }
    setSaving(true)
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      const created = await commandsApi.create({
        title: title.trim(), command: command.trim(), language,
        description: description.trim(),
        project_id: projectId || null,
        tags, component: component.trim() || null, is_favorite: isFav, namespace,
      })
      onCreate(created)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)',
    borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px',
    boxSizing: 'border-box', outline: 'none',
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)',
    textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5,
  }

  return (
    <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-cmd-dialog-title"
        className="modal-panel"
        style={{ width: 540, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span id="new-cmd-dialog-title" style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>New Command</span>
          <button onClick={onClose} aria-label="Close dialog" style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', fontSize: 14 }}>✕</button>
        </div>

        <form id="new-cmd-form" onSubmit={submit} style={{ padding: '16px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          <div>
            <label style={labelStyle}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Start Dev Server" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={labelStyle}>Language</label>
              <select value={language} onChange={e => setLanguage(e.target.value)} style={{ ...inputStyle, cursor: 'default' }}>
                {[...SUPPORTED_LANGS, 'plaintext'].map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Project</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inputStyle, cursor: 'default' }}>
                <option value="">— Global —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label style={labelStyle}>Command *</label>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder="e.g. npm run dev"
              rows={5}
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)', fontSize: '12.5px', lineHeight: 1.65, resize: 'vertical' }}
            />
          </div>

          <div>
            <label style={labelStyle}>Description</label>
            <textarea value={description} onChange={e => setDesc(e.target.value)} placeholder="What does this command do?" rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
          </div>

          <div>
            <label style={labelStyle}>Tags (comma-separated)</label>
            <input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="dev, server, docker" style={inputStyle} />
          </div>

          <div>
            <label style={labelStyle}>Component</label>
            <ComponentInput value={component} onChange={setComponent} options={componentOptions} />
          </div>

          <div>
            <label style={labelStyle}>Visibility</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['team', 'personal'] as const).map(ns => (
                <label key={ns} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default', fontSize: '13px', color: namespace === ns ? 'var(--fg)' : 'var(--fg-3)', padding: '5px 12px', borderRadius: 5, border: `1px solid ${namespace === ns ? 'var(--accent)' : 'var(--line)'}`, background: namespace === ns ? 'var(--accent-dim)' : 'transparent', flex: 1, justifyContent: 'center' }}>
                  <input type="radio" name="namespace" value={ns} checked={namespace === ns} onChange={() => setNamespace(ns)} style={{ display: 'none' }} />
                  {ns === 'team' ? '👥 Team' : '🔒 Personal'}
                </label>
              ))}
            </div>
            <div style={{ marginTop: 4, fontSize: '11px', color: 'var(--fg-4)' }}>
              {namespace === 'team' ? 'Visible to all team members' : 'Visible only to you'}
            </div>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'default', fontSize: '13px', color: 'var(--fg-2)' }}>
            <input type="checkbox" checked={isFav} onChange={e => setIsFav(e.target.checked)} />
            Mark as favorite
          </label>
        </form>

        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
          {error && <span style={{ flex: 1, fontSize: '12px', color: '#EF4444' }}>{error}</span>}
          <button type="button" onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button type="submit" form="new-cmd-form" disabled={saving} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default', opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving…' : 'Save Command'}
          </button>
        </div>
      </div>
    </div>
  )
}

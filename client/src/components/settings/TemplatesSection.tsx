import { useState, useEffect } from 'react'
import { templatesApi, type Project, type Template } from '../../lib/api'
import { useToast } from '../Toast'

interface TemplatesSectionProps {
  projects: Project[]
}

export function TemplatesSection({ projects }: TemplatesSectionProps) {
  const { toast } = useToast()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  // Form States
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<'issue' | 'runbook' | 'document'>('issue')
  const [projectId, setProjectId] = useState<string | null>(null)

  // Issue Body
  const [issueTitle, setIssueTitle] = useState('')
  const [issueDescription, setIssueDescription] = useState('')
  const [issueTagsRaw, setIssueTagsRaw] = useState('')
  const [issueSteps, setIssueSteps] = useState<string[]>([])
  const [newIssueStep, setNewIssueStep] = useState('')

  // Document Body
  const [docTitle, setDocTitle] = useState('')
  const [docContent, setDocContent] = useState('')

  // Runbook Body
  const [rbSteps, setRbSteps] = useState<{ instruction: string; command?: string }[]>([])
  const [newRbInstruction, setNewRbInstruction] = useState('')
  const [newRbCommand, setNewRbCommand] = useState('')

  const loadTemplates = async () => {
    try {
      const data = await templatesApi.list()
      setTemplates(data)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const addIssueStep = () => {
    if (!newIssueStep.trim()) return
    setIssueSteps(prev => [...prev, newIssueStep.trim()])
    setNewIssueStep('')
  }

  const removeIssueStep = (index: number) => {
    setIssueSteps(prev => prev.filter((_, i) => i !== index))
  }

  const moveIssueStep = (index: number, direction: 'up' | 'down') => {
    setIssueSteps(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < next.length) {
        const temp = next[index]
        next[index] = next[target]
        next[target] = temp
      }
      return next
    })
  }

  const addRbStep = () => {
    if (!newRbInstruction.trim()) return
    setRbSteps(prev => [...prev, { instruction: newRbInstruction.trim(), command: newRbCommand.trim() || undefined }])
    setNewRbInstruction('')
    setNewRbCommand('')
  }

  const removeRbStep = (index: number) => {
    setRbSteps(prev => prev.filter((_, i) => i !== index))
  }

  const moveRbStep = (index: number, direction: 'up' | 'down') => {
    setRbSteps(prev => {
      const next = [...prev]
      const target = direction === 'up' ? index - 1 : index + 1
      if (target >= 0 && target < next.length) {
        const temp = next[index]
        next[index] = next[target]
        next[target] = temp
      }
      return next
    })
  }

  const openNew = () => {
    setEditingTemplate(null)
    setName('')
    setDescription('')
    setType('issue')
    setProjectId(null)
    setIssueTitle('')
    setIssueDescription('')
    setIssueTagsRaw('')
    setIssueSteps([])
    setDocTitle('')
    setDocContent('')
    setRbSteps([])
    setEditorOpen(true)
  }

  const openEdit = (t: Template) => {
    setEditingTemplate(t)
    setName(t.name)
    setDescription(t.description)
    setType(t.type)
    setProjectId(t.project_id)

    if (t.type === 'issue') {
      setIssueTitle(t.body?.title || '')
      setIssueDescription(t.body?.description || '')
      setIssueTagsRaw(Array.isArray(t.body?.tags) ? t.body.tags.join(', ') : '')
      setIssueSteps(Array.isArray(t.body?.steps) ? t.body.steps as string[] : [])
    } else if (t.type === 'document') {
      setDocTitle(t.body?.title || '')
      setDocContent(t.body?.content || '')
    } else if (t.type === 'runbook') {
      setRbSteps(Array.isArray(t.body?.steps) ? t.body.steps as { instruction: string; command?: string }[] : [])
    }
    setEditorOpen(true)
  }

  const openDuplicate = (t: Template) => {
    setEditingTemplate(null)
    setName(`${t.name} (Copy)`)
    setDescription(t.description)
    setType(t.type)
    setProjectId(t.project_id)

    if (t.type === 'issue') {
      setIssueTitle(t.body?.title || '')
      setIssueDescription(t.body?.description || '')
      setIssueTagsRaw(Array.isArray(t.body?.tags) ? t.body.tags.join(', ') : '')
      setIssueSteps(Array.isArray(t.body?.steps) ? t.body.steps as string[] : [])
    } else if (t.type === 'document') {
      setDocTitle(t.body?.title || '')
      setDocContent(t.body?.content || '')
    } else if (t.type === 'runbook') {
      setRbSteps(Array.isArray(t.body?.steps) ? t.body.steps as { instruction: string; command?: string }[] : [])
    }
    setEditorOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return
    try {
      await templatesApi.remove(id)
      toast('Template deleted', 'success')
      loadTemplates()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast('Name is required', 'error')
      return
    }

    let body: Record<string, unknown> = {}
    if (type === 'issue') {
      const tags = issueTagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      body = {
        title: issueTitle.trim(),
        description: issueDescription.trim(),
        tags,
        steps: issueSteps
      }
    } else if (type === 'document') {
      body = {
        title: docTitle.trim(),
        content: docContent.trim()
      }
    } else if (type === 'runbook') {
      body = {
        steps: rbSteps
      }
    }

    try {
      if (editingTemplate) {
        await templatesApi.update(editingTemplate.id, {
          name: name.trim(),
          description: description.trim(),
          project_id: projectId,
          body
        })
        toast('Template updated', 'success')
      } else {
        await templatesApi.create({
          name: name.trim(),
          description: description.trim(),
          type,
          project_id: projectId,
          body
        })
        toast('Template created', 'success')
      }
      setEditorOpen(false)
      loadTemplates()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const formInp: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg)',
    border: '1px solid var(--line-2)',
    borderRadius: 6,
    padding: '7px 10px',
    color: 'var(--fg)',
    fontSize: '13px',
    boxSizing: 'border-box',
    outline: 'none',
  }

  if (loading) return <div style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>Loading templates…</div>

  if (editorOpen) {
    return (
      <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>
            {editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'New Template'}
          </span>
          <button type="button" onClick={() => setEditorOpen(false)} style={{ fontSize: 12, color: 'var(--fg-3)', background: 'none', border: 'none' }}>✕ Close</button>
        </div>

        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Template Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Frontend Bug Report" style={formInp} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief explanation of this template..." style={formInp} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Type</label>
          <select
            value={type}
            onChange={e => setType(e.target.value as 'issue' | 'runbook' | 'document')}
            disabled={!!editingTemplate}
            style={formInp}
          >
            <option value="issue">Issue</option>
            <option value="runbook">Runbook</option>
            <option value="document">Document</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }}>Project Scope</label>
          <select value={projectId || ''} onChange={e => setProjectId(e.target.value || null)} style={formInp}>
            <option value="">Global (All projects)</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {type === 'issue' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Issue Fields</div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Title</label>
              <input value={issueTitle} onChange={e => setIssueTitle(e.target.value)} placeholder="e.g. Bug: [Component]" style={formInp} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Description (Markdown)</label>
              <textarea value={issueDescription} onChange={e => setIssueDescription(e.target.value)} placeholder="### Steps to reproduce..." rows={4} style={{ ...formInp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Tags (comma-separated)</label>
              <input value={issueTagsRaw} onChange={e => setIssueTagsRaw(e.target.value)} placeholder="e.g. bug, UI" style={formInp} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block' }}>Investigation Steps</label>
              {issueSteps.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-elev-2)', padding: 8, borderRadius: 6, border: '1px solid var(--line-2)' }}>
                  {issueSteps.map((step, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', color: 'var(--fg-2)' }}>
                      <span style={{ color: 'var(--fg-4)', width: 18 }}>{idx + 1}.</span>
                      <span style={{ flex: 1 }}>{step}</span>
                      <button type="button" disabled={idx === 0} onClick={() => moveIssueStep(idx, 'up')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▲</button>
                      <button type="button" disabled={idx === issueSteps.length - 1} onClick={() => moveIssueStep(idx, 'down')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▼</button>
                      <button type="button" onClick={() => removeIssueStep(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: '12px', cursor: 'default', padding: '0 4px' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <input value={newIssueStep} onChange={e => setNewIssueStep(e.target.value)} placeholder="Add investigation step..." style={{ ...formInp, flex: 1 }} />
                <button type="button" onClick={addIssueStep} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg)', fontSize: '12px' }}>Add</button>
              </div>
            </div>
          </div>
        )}

        {type === 'document' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Document Fields</div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Title</label>
              <input value={docTitle} onChange={e => setDocTitle(e.target.value)} placeholder="e.g. Postmortem - [Date]" style={formInp} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'block', marginBottom: 4 }}>Default Content (Markdown)</label>
              <textarea value={docContent} onChange={e => setDocContent(e.target.value)} placeholder="Write template content here..." rows={8} style={{ ...formInp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
          </div>
        )}

        {type === 'runbook' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--fg-2)' }}>Runbook Steps</div>
            {rbSteps.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg-elev-2)', padding: 8, borderRadius: 6, border: '1px solid var(--line-2)' }}>
                {rbSteps.map((step, idx) => (
                  <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 3, borderBottom: idx < rbSteps.length - 1 ? '1px solid var(--line)' : 'none', paddingBottom: idx < rbSteps.length - 1 ? 6 : 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '12.5px', color: 'var(--fg-2)' }}>
                      <span style={{ color: 'var(--fg-4)', width: 18 }}>{idx + 1}.</span>
                      <span style={{ flex: 1, fontWeight: 500 }}>{step.instruction}</span>
                      <button type="button" disabled={idx === 0} onClick={() => moveRbStep(idx, 'up')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▲</button>
                      <button type="button" disabled={idx === rbSteps.length - 1} onClick={() => moveRbStep(idx, 'down')} style={{ background: 'none', border: 'none', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>▼</button>
                      <button type="button" onClick={() => removeRbStep(idx)} style={{ background: 'none', border: 'none', color: '#EF4444', fontSize: '12px', cursor: 'default', padding: '0 4px' }}>✕</button>
                    </div>
                    {step.command && (
                      <pre style={{ margin: '2px 0 0 24px', padding: '4px 8px', background: '#0d1117', color: '#e6edf3', borderRadius: 4, fontSize: '11px', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>{step.command}</pre>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--bg)', border: '1px dashed var(--line-2)', padding: 10, borderRadius: 6 }}>
              <div style={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--fg-3)' }}>Add Step</div>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--fg-4)', display: 'block', marginBottom: 2 }}>Instruction *</label>
                <input value={newRbInstruction} onChange={e => setNewRbInstruction(e.target.value)} placeholder="e.g. Pull latest code" style={formInp} />
              </div>
              <div>
                <label style={{ fontSize: '10px', color: 'var(--fg-4)', display: 'block', marginBottom: 2 }}>Command (Optional)</label>
                <input value={newRbCommand} onChange={e => setNewRbCommand(e.target.value)} placeholder="e.g. git pull" style={{ ...formInp, fontFamily: 'var(--font-mono)' }} />
              </div>
              <button type="button" onClick={addRbStep} style={{ alignSelf: 'flex-end', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg)', fontSize: '12px' }}>Add Step</button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={() => setEditorOpen(false)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line-2)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>
            Cancel
          </button>
          <button type="submit" style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '13px', cursor: 'default' }}>
            Save
          </button>
        </div>
      </form>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '12.5px', color: 'var(--fg-3)' }}>Manage templates for Issues, Runbooks, and Documents</span>
        <button onClick={openNew} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
          + New Template
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map(t => (
          <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)' }}>{t.name}</span>

              {/* Type Badge */}
              {t.type === 'issue' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.3)', color: '#818CF8' }}>
                  Issue
                </span>
              )}
              {t.type === 'runbook' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(236,72,153,.15)', border: '1px solid rgba(236,72,153,.3)', color: '#F472B6' }}>
                  Runbook
                </span>
              )}
              {t.type === 'document' && (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.3)', color: '#4ADE80' }}>
                  Document
                </span>
              )}

              {/* Built-in Badge */}
              {t.is_builtin ? (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(234,179,8,.15)', border: '1px solid rgba(234,179,8,.3)', color: '#FACC15' }}>
                  Built-in
                </span>
              ) : (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,.05)', border: '1px solid var(--line-2)', color: 'var(--fg-3)' }}>
                  Custom
                </span>
              )}

              {/* Scope Badge */}
              {t.project_name ? (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: `${t.project_color || '#6366F1'}18`, border: `1px solid ${t.project_color || '#6366F1'}40`, color: t.project_color || '#818CF8' }}>
                  {t.project_name}
                </span>
              ) : (
                <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,.05)', border: '1px solid var(--line-2)', color: 'var(--fg-3)' }}>
                  Global
                </span>
              )}
            </div>

            {t.description && (
              <div style={{ fontSize: '12px', color: 'var(--fg-3)' }}>{t.description}</div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button onClick={() => openDuplicate(t)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>
                Duplicate
              </button>
              {!t.is_builtin && (
                <>
                  <button onClick={() => openEdit(t)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>
                    Edit
                  </button>
                  <button onClick={() => handleDelete(t.id)} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: 4, border: '1px solid #EF4444', background: 'rgba(239,68,68,.1)', color: '#EF4444', cursor: 'default' }}>
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

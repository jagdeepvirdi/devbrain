import { useState, useEffect, useRef } from 'react'
import { issuesApi, runbooksApi } from '../../lib/api'
import type { Issue, IssueStep, IssueNote, RelatedDoc, RelatedIssue, RelatedCommand } from '../../lib/api'
import { useToast } from '../Toast'
import { PRIORITY_META, STATUS_META } from './issueConstants'
import type { Priority, Status } from './issueConstants'
import { StepText } from './StepText'
import { useRecentlyViewed } from '../../hooks/useRecentlyViewed'

export function IssueDetail({ issueId, onBack, onDeleted }: { issueId: string; onBack: () => void; onDeleted: () => void }) {
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
  const [commitInput,    setCommitInput]    = useState('')
  const [linkCopied,     setLinkCopied]    = useState(false)
  const { toast } = useToast()
  const { track } = useRecentlyViewed()

  useEffect(() => {
    issuesApi.get(issueId).then(i => {
      setIssue(i)
      setSummary(i.summary ?? '')
      setLoading(false)
      track({ id: i.id, type: 'issue', title: i.title, projectName: i.project_name ?? undefined, projectColor: i.project_color ?? undefined })
    }).catch(() => setLoading(false))
  }, [issueId, track])

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

  async function linkCommit() {
    if (!issue || !commitInput.trim()) return
    const sha = commitInput.trim()
    try {
      const commits = await issuesApi.linkCommit(issue.id, sha)
      setIssue({ ...issue, linked_commits: commits })
      setCommitInput('')
    } catch (err) { toast((err as Error).message, 'error') }
  }

  async function unlinkCommit(sha: string) {
    if (!issue) return
    try {
      const commits = await issuesApi.unlinkCommit(issue.id, sha)
      setIssue({ ...issue, linked_commits: commits })
    } catch (err) { toast((err as Error).message, 'error') }
  }

  function onDrop(toIdx: number) {
    if (!issue) return
    const fromIdx = dragIdx.current
    if (fromIdx == null || fromIdx === toIdx) { setDropIdx(null); dragIdx.current = null; return }
    const arr = [...issue.investigation_steps]
    if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx > arr.length) { setDropIdx(null); dragIdx.current = null; return }
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
      setIssue({ ...issue, summary: s })
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

  if (loading) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-4)' }}>Loading...</div>
  if (!issue)  return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-4)' }}>Issue not found.</div>

  const pm = PRIORITY_META[issue.priority]
  const sm = STATUS_META[issue.status]
  const doneSteps = issue.investigation_steps.filter(s => s.done).length

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0, background: 'var(--bg-elev)' }}>
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
          <button
            onClick={() => {
              const url = `${window.location.origin}/issues?open=${issue.id}`
              navigator.clipboard.writeText(url).then(() => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000) })
            }}
            aria-label="Copy link to this issue"
            style={{ marginLeft: 'auto', fontSize: '11px', color: linkCopied ? '#4ADE80' : 'var(--fg-4)', padding: '2px 8px', borderRadius: 4, border: `1px solid ${linkCopied ? 'rgba(74,222,128,.4)' : 'var(--line-2)'}` }}
          >
            {linkCopied ? '✓ Copied' : '⎘ Copy link'}
          </button>
          <button onClick={doDelete} aria-label="Delete issue" style={{ fontSize: '11.5px', color: '#F05A5A', padding: '2px 8px', borderRadius: 4, border: '1px solid #F05A5A40' }}>
            Delete
          </button>
        </div>

        <h2 style={{ margin: '0 0 10px', fontSize: '16px', fontWeight: 600, color: 'var(--fg)', lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: 8 }}>
          {issue.source !== 'devbrain' && (
            <span style={{ 
              fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', 
              padding: '2px 6px', borderRadius: 4, 
              background: issue.source === 'github' ? '#24292e' : issue.source === 'jira' ? '#0052cc' : '#5e6ad2',
              color: 'white', letterSpacing: '0.04em'
            }}>
              {issue.source}
            </span>
          )}
          {issue.title}
        </h2>

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
                {savingRunbook ? 'Saving...' : '↗ Save as Runbook'}
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

          <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
            {doneSteps}/{issue.investigation_steps.length} steps · {issue.notes.length} notes
            {saving && <span style={{ marginLeft: 8, color: 'var(--accent-2)' }}>saving...</span>}
          </span>
        </div>

        {issue.description && (
          <p style={{ margin: '10px 0 0', fontSize: '13px', color: 'var(--fg-2)', lineHeight: 1.6 }}>
            {issue.description}
          </p>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
      <div style={{ flex: 1, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>

        {/* LEFT - Investigation steps */}
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
              <span>◆</span> {suggestingSteps ? 'Generating...' : 'Suggest'}
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
                <span style={{ color: 'var(--fg-4)', cursor: 'grab', fontSize: '10px', marginTop: 2, flexShrink: 0 }}>⠿</span>
                <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                <button
                  onClick={() => toggleStep(step.id)}
                  aria-label={step.done ? 'Mark step incomplete' : 'Mark step complete'}
                  aria-pressed={step.done}
                  style={{
                    width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                    border: `1.5px solid ${step.done ? 'var(--accent)' : 'var(--line-3)'}`,
                    background: step.done ? 'var(--accent)' : 'transparent',
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  {step.done && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round"><path d="M5 12l4 4 10-10"/></svg>}
                </button>
                <span style={{
                  flex: 1, fontSize: '13px', color: step.done ? 'var(--fg-4)' : 'var(--fg-2)',
                  textDecoration: step.done ? 'line-through' : 'none', lineHeight: 1.5,
                }}>
                  <StepText text={step.instruction} />
                </span>
                <button onClick={() => deleteStep(step.id)} aria-label="Remove step" style={{ color: 'var(--fg-4)', fontSize: '13px', flexShrink: 0, opacity: 0.5 }}>×</button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 10px' }}>
              <span style={{ color: 'var(--fg-4)', fontSize: '10px', width: 10, flexShrink: 0 }}>⠿</span>
              <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)', flexShrink: 0, width: 16 }}>
                {issue.investigation_steps.length + 1}.
              </span>
              <input
                value={newStepText}
                onChange={e => setNewStepText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStep() } }}
                placeholder="Add investigation step..."
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

          {/* PR URL */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              PR / MR URL
            </div>
            <input
              value={issue.pr_url ?? ''}
              onChange={e => setIssue({ ...issue, pr_url: e.target.value || null })}
              onBlur={e => patch({ pr_url: e.target.value || null })}
              placeholder="https://github.com/org/repo/pull/123"
              style={{
                width: '100%', padding: '6px 10px', borderRadius: 6,
                border: '1px solid var(--line-2)', background: 'var(--bg)',
                color: 'var(--fg)', fontSize: '13px', outline: 'none',
                boxSizing: 'border-box', fontFamily: 'var(--font-mono)',
              }}
            />
            {issue.pr_url && (
              <a href={issue.pr_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11.5px', color: 'var(--accent-2)', marginTop: 4, display: 'inline-block' }}>
                Open PR →
              </a>
            )}
          </div>

          {/* Linked Commits */}
          <div>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
              Linked Commits
            </div>
            {(issue.linked_commits ?? []).length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {(issue.linked_commits ?? []).map(sha => (
                  <div key={sha} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', borderRadius: 5, background: 'var(--bg-elev)', border: '1px solid var(--line)' }}>
                    <code style={{ flex: 1, fontSize: '12px', fontFamily: 'var(--font-mono)', color: '#818CF8' }}>{sha.slice(0, 7)}</code>
                    <button onClick={() => unlinkCommit(sha)} style={{ color: 'var(--fg-4)', fontSize: '13px', cursor: 'default', opacity: 0.6 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={commitInput}
                onChange={e => setCommitInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); linkCommit() } }}
                placeholder="Paste commit SHA..."
                style={{
                  flex: 1, padding: '5px 8px', borderRadius: 5,
                  border: '1px solid var(--line-2)', background: 'var(--bg)',
                  color: 'var(--fg)', fontSize: '12.5px', outline: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <button onClick={linkCommit} disabled={!commitInput.trim()} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px', cursor: 'default', opacity: commitInput.trim() ? 1 : 0.5 }}>
                Link
              </button>
            </div>
          </div>

        </div>

        {/* RIGHT - Notes */}
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
              <button onClick={() => deleteNote(note.id)} aria-label="Delete note" style={{ color: 'var(--fg-4)', fontSize: '13px', flexShrink: 0, opacity: 0.5, marginTop: 6 }}>×</button>
            </div>
          ))}

          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-end',
            border: '1px solid var(--line-2)', borderRadius: 7,
            background: 'var(--bg)', padding: '8px 10px',
          }}>
            <textarea
              value={noteInput}
              onChange={e => setNoteInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addNote() } }}
              placeholder="Add a note... (Enter to save, Shift+Enter for newline)"
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

      {/* AI Intelligence drawer */}
      {aiOpen && (
        <div style={{
          width: 284, flexShrink: 0,
          borderLeft: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
          background: 'var(--bg-elev)',
        }}>
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
              <span>◆</span> {summarizing ? 'Summarizing...' : 'Generate Summary'}
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

          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Similar Issues
            </div>
            {loadingSimilar
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching...</div>
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

          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Related Docs
            </div>
            {loadingDocs
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching...</div>
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

          <div style={{ padding: '14px 16px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Related Commands
            </div>
            {loadingCmds
              ? <div style={{ fontSize: '12px', color: 'var(--fg-4)' }}>Searching...</div>
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

      </div>
    </div>
  )
}

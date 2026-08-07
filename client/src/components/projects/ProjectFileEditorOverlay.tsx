import { useCallback, useEffect, useRef, useState } from 'react'
import { projectFilesApi } from '../../lib/api'
import { useToast } from '../Toast'
import { CodeEditor } from '../codes/CodeEditor'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

const AUTOSAVE_DEBOUNCE_MS = 2500
const DRAFT_DEBOUNCE_MS    = 500

type Draft = { content: string; savedAt: number }

function draftKey(projectId: string, filePath: string) { return `devbrain:pf-draft:${projectId}:${filePath}` }

function readDraft(projectId: string, filePath: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(projectId, filePath))
    return raw ? JSON.parse(raw) as Draft : null
  } catch {
    return null
  }
}

function writeDraft(projectId: string, filePath: string, content: string) {
  try {
    localStorage.setItem(draftKey(projectId, filePath), JSON.stringify({ content, savedAt: Date.now() }))
  } catch {
    // localStorage full/unavailable — the draft safety net is best-effort, not load-bearing
  }
}

function clearDraft(projectId: string, filePath: string) {
  try { localStorage.removeItem(draftKey(projectId, filePath)) } catch { /* ignore */ }
}

type ProjectFileEditorOverlayProps = {
  projectId: string
  filePath:  string
  onClose:   () => void
}

// Full-screen in-app editor for a REAL file on disk under a project's linked fs_path —
// the Phase 37 counterpart to CodeEditorOverlay (Codes/Notes, which edit a DB snapshot).
// Deliberately a separate component rather than a generalization of CodeEditorOverlay:
// the two have genuinely different data sources (documents row + documentsApi vs. a raw
// file path + projectFilesApi) and forcing them through one shared interface would trade
// this file's directness for an awkward abstraction. Mirrors CodeEditorOverlay's UX
// (read-only-first, Edit to unlock, Ctrl+S/autosave, draft safety net, confirm-close) —
// see TASKS.md Phase 36/37 for why those choices were made.
export function ProjectFileEditorOverlay({ projectId, filePath, onClose }: ProjectFileEditorOverlayProps) {
  const { toast } = useToast()
  const [loading,      setLoading]      = useState(true)
  const [loadError,    setLoadError]    = useState<string | null>(null)
  const [value,        setValue]        = useState('')
  const [savedValue,   setSavedValue]   = useState('')
  const [editing,      setEditing]      = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [autosave,     setAutosave]     = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [draftBanner,  setDraftBanner]  = useState<Draft | null>(null)
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const dirty = value !== savedValue

  const draftTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadError(null)
    projectFilesApi.getContent(projectId, filePath).then(res => {
      if (cancelled) return
      setValue(res.content)
      setSavedValue(res.content)
      setLoading(false)
      const draft = readDraft(projectId, filePath)
      if (draft && draft.content !== res.content) setDraftBanner(draft)
    }).catch(err => {
      if (cancelled) return
      setLoadError((err as Error).message)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [projectId, filePath])

  function startEditing() {
    setEditing(true)
    setTimeout(() => editorRef.current?.view?.focus(), 0)
  }

  const save = useCallback(async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      await projectFilesApi.writeContent(projectId, filePath, value)
      setSavedValue(value)
      clearDraft(projectId, filePath)
      toast('Saved to disk', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }, [projectId, filePath, value, dirty, saving, toast])

  // Debounced local-draft persistence — independent of the autosave toggle, so
  // in-progress edits survive an accidental tab close/crash either way.
  useEffect(() => {
    if (!dirty) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => writeDraft(projectId, filePath, value), DRAFT_DEBOUNCE_MS)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [value, dirty, projectId, filePath])

  // Debounced autosave — only while the toggle is on.
  useEffect(() => {
    if (!autosave || !dirty) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [value, dirty, autosave, save])

  // Ctrl/Cmd+S saves; Escape closes (confirms first if there are unsaved edits).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save()
      } else if (e.key === 'Escape') {
        if (dirty) setConfirmClose(true)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save, dirty, onClose])

  function handleCloseClick() {
    if (dirty) setConfirmClose(true)
    else onClose()
  }

  function restoreDraft() {
    if (draftBanner) setValue(draftBanner.content)
    setDraftBanner(null)
    startEditing()
  }

  function discardDraft() {
    clearDraft(projectId, filePath)
    setDraftBanner(null)
  }

  if (loading) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 900, display: 'grid', placeItems: 'center' }}>
        <span style={{ fontSize: 12.5, color: 'var(--fg-4)' }}>Loading {filePath}…</span>
      </div>
    )
  }

  if (loadError) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 900, display: 'grid', placeItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', maxWidth: 360, textAlign: 'center' }}>
          <span style={{ fontSize: 12.5, color: '#F8A8A8' }}>{loadError}</span>
          <button onClick={onClose} style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', cursor: 'default' }}>
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 900, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={handleCloseClick} style={{ color: 'var(--accent-2)', cursor: 'default', fontSize: 12, flexShrink: 0 }}>
          ← Files
        </button>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filePath}
        </span>
        {dirty && (
          <span title="Unsaved changes" style={{ width: 6, height: 6, borderRadius: '50%', background: '#F59E0B', flexShrink: 0 }} />
        )}
        {!editing && (
          <span style={{ fontSize: 10.5, color: 'var(--fg-4)', padding: '1px 6px', borderRadius: 3, border: '1px solid var(--line-2)' }}>
            read-only
          </span>
        )}

        <span style={{ flex: 1 }} />

        {editing ? (
          <>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--fg-3)', cursor: 'default' }}>
              <input type="checkbox" checked={autosave} onChange={e => setAutosave(e.target.checked)} />
              Autosave
            </label>

            <button
              onClick={save}
              disabled={!dirty || saving}
              style={{
                fontSize: 12, padding: '5px 12px', borderRadius: 5,
                border: '1px solid var(--accent-line)', background: dirty ? 'var(--accent-dim)' : 'var(--bg-elev)',
                color: dirty ? 'var(--accent-2)' : 'var(--fg-4)', cursor: 'default',
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving…' : dirty ? 'Save to disk (Ctrl+S)' : 'Saved'}
            </button>
          </>
        ) : (
          <button
            onClick={startEditing}
            style={{
              fontSize: 12, padding: '5px 12px', borderRadius: 5,
              border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
              color: 'var(--accent-2)', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 10 }}>✎</span>
            Edit
          </button>
        )}
      </div>

      {draftBanner && (
        <div style={{ padding: '8px 18px', borderBottom: '1px solid var(--line)', background: 'rgba(245,158,11,.08)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span style={{ fontSize: 11.5, color: '#F59E0B', flex: 1 }}>
            Found an unsaved draft from a previous session ({new Date(draftBanner.savedAt).toLocaleString()}) — restore it?
          </span>
          <button onClick={restoreDraft} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default' }}>
            Restore
          </button>
          <button onClick={discardDraft} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 4, border: '1px solid var(--line-2)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            Discard
          </button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0 }}>
        <CodeEditor ref={editorRef} value={value} filename={filePath} onChange={setValue} readOnly={!editing} />
      </div>

      {confirmClose && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 910, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Discard unsaved changes?</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)' }}>
              Your edits are kept in a local draft and offered back next time you open this file — but won't be
              written to disk until you save.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setConfirmClose(false)} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5 }}>
                Cancel
              </button>
              <button onClick={onClose} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: 'none', background: '#F05A5A', color: 'white', fontSize: 12.5 }}>
                Close without saving
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { documentsApi, type DocDetail } from '../../lib/api'
import { useToast } from '../Toast'
import { langColor } from '../../lib/language'
import { CodeEditor } from './CodeEditor'
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror'

const AUTOSAVE_DEBOUNCE_MS = 2500
const DRAFT_DEBOUNCE_MS    = 500

type Draft = { content: string; savedAt: number }

function draftKey(docId: string) { return `devbrain:draft:${docId}` }

function readDraft(docId: string): Draft | null {
  try {
    const raw = localStorage.getItem(draftKey(docId))
    return raw ? JSON.parse(raw) as Draft : null
  } catch {
    return null
  }
}

function writeDraft(docId: string, content: string) {
  try {
    localStorage.setItem(draftKey(docId), JSON.stringify({ content, savedAt: Date.now() }))
  } catch {
    // localStorage full/unavailable — the draft safety net is best-effort, not load-bearing
  }
}

function clearDraft(docId: string) {
  try { localStorage.removeItem(draftKey(docId)) } catch { /* ignore */ }
}

type CodeEditorOverlayProps = {
  doc:              DocDetail
  onClose:          () => void
  onSaved:          (updated: DocDetail) => void
  // Skips the read-only-first flow and opens straight into edit mode, focused — for a
  // document just created for the purpose of writing into it (e.g. a brand-new note),
  // where the read-only step would just be an extra click before the point of opening it.
  startInEditMode?: boolean
}

// Full-screen in-app editor for a tracked document's content (Codes tab code files, Notes
// tab notes). Edits a DB snapshot only — see TASKS.md Phase 37 for the separate
// real-on-disk-file editor.
export function CodeEditorOverlay({ doc, onClose, onSaved, startInEditMode }: CodeEditorOverlayProps) {
  const { toast } = useToast()
  const [value,        setValue]        = useState(doc.content)
  const [savedValue,   setSavedValue]   = useState(doc.content)
  const [editing,      setEditing]      = useState(!!startInEditMode)
  const [saving,       setSaving]       = useState(false)
  const [autosave,     setAutosave]     = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [draftBanner,  setDraftBanner]  = useState<Draft | null>(null)
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const dirty = value !== savedValue

  const draftTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function startEditing() {
    setEditing(true)
    // Editor is already mounted (read-only) — focus it once it becomes editable.
    setTimeout(() => editorRef.current?.view?.focus(), 0)
  }

  // Same focus as startEditing(), for the case where we mounted already-editable.
  useEffect(() => {
    if (startInEditMode) setTimeout(() => editorRef.current?.view?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Offer to restore a local draft left over from a previous session — once, on open.
  useEffect(() => {
    const draft = readDraft(doc.id)
    if (draft && draft.content !== doc.content) setDraftBanner(draft)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  const save = useCallback(async () => {
    if (saving || !dirty) return
    setSaving(true)
    try {
      const updated = await documentsApi.updateContentText(doc.id, value)
      setSavedValue(value)
      clearDraft(doc.id)
      onSaved(updated)
      toast('Saved', 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }, [doc.id, value, dirty, saving, onSaved, toast])

  // Debounced local-draft persistence — independent of the autosave toggle, so
  // in-progress edits survive an accidental tab close/crash either way.
  useEffect(() => {
    if (!dirty) return
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => writeDraft(doc.id, value), DRAFT_DEBOUNCE_MS)
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current) }
  }, [value, dirty, doc.id])

  // Debounced autosave — only while the toggle is on.
  useEffect(() => {
    if (!autosave || !dirty) return
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
    autosaveTimer.current = setTimeout(save, AUTOSAVE_DEBOUNCE_MS)
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }
  }, [value, dirty, autosave, save])

  // Ctrl/Cmd+S saves; Escape closes (confirms first if there are unsaved edits). Re-subscribes
  // whenever `save`/`dirty` change (i.e. on every keystroke) so the closure below never goes stale.
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
    clearDraft(doc.id)
    setDraftBanner(null)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 900, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={handleCloseClick} style={{ color: 'var(--accent-2)', cursor: 'default', fontSize: 12, flexShrink: 0 }}>
          ← Codes
        </button>
        {doc.language && (
          <span style={{ height: 20, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: langColor(doc.language), background: 'var(--bg-elev-2)', border: `1px solid ${langColor(doc.language)}40`, display: 'inline-flex', alignItems: 'center' }}>
            {doc.language}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', fontFamily: 'var(--font-mono)' }}>
          {doc.title}
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
              {saving ? 'Saving…' : dirty ? 'Save (Ctrl+S)' : 'Saved'}
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
        <CodeEditor ref={editorRef} value={value} language={doc.language} onChange={setValue} readOnly={!editing} />
      </div>

      {confirmClose && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 910, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Discard unsaved changes?</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)' }}>
              Your edits are kept in a local draft and offered back next time you open this file — but won't reach
              DevBrain until you save.
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

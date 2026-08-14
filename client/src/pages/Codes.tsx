import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { documentsApi, type DocMeta, type DocDetail, type EmbeddingStatus } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import { FilterBar, initialFilterState } from '../components/FilterBar'
import type { FilterState } from '../components/FilterBar'
import { LinkedItems } from '../components/LinkedItems'
import { MermaidDiagram } from '../components/MermaidDiagram'
import { langColor } from '../lib/language'
import { CodeEditorOverlay } from '../components/codes/CodeEditorOverlay'

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtSize(chars: number) {
  if (chars < 1000) return `${chars} ch`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)} K`
  return `${(chars / 1_000_000).toFixed(1)} M`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

const EMBED_DOT: Record<EmbeddingStatus, { color: string; title: string }> = {
  pending:    { color: '#64748B', title: 'Embedding pending' },
  processing: { color: '#F59E0B', title: 'Embedding in progress…' },
  done:       { color: '#22C55E', title: 'Embedded' },
  failed:     { color: '#EF4444', title: 'Embedding failed — click to retry' },
}

function EmbedDot({ status }: { status: EmbeddingStatus }) {
  const { color, title } = EMBED_DOT[status] ?? EMBED_DOT.pending
  return (
    <span title={title} style={{
      width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0,
      boxShadow: status === 'processing' ? `0 0 5px ${color}` : undefined,
    }} />
  )
}

const PAGE = 25

// ── Upload strip ──────────────────────────────────────────────────────────

function CodeUploadStrip({ projectId, existingComponents, onDone }: { projectId: string | undefined; existingComponents: string[]; onDone: () => void }) {
  const { toast } = useToast()
  const [dragging,  setDragging]  = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [tagInput,  setTagInput]  = useState('')
  const [tags,      setTags]      = useState<string[]>([])
  const [component, setComponent] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  function addTag() {
    const t = tagInput.trim().replace(/,/g, '')
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags(prev => [...prev, t])
    setTagInput('')
  }

  async function handleFiles(files: FileList) {
    const list = Array.from(files)
    for (const file of list) {
      setUploading(file.name)
      try {
        // 'code' stays first and mandatory (Codes tab identity), any
        // user-typed tags are additional, same as Documents' DropZone.
        await documentsApi.upload(file, projectId, ['code', ...tags], component.trim() || undefined)
      } catch (err) {
        const e = err as Error & { existingId?: string }
        toast(e.existingId ? `"${file.name}" already tracked` : e.message, 'error')
      }
    }
    setUploading(null)
    onDone()
  }

  return (
    <div style={{ margin: '0 24px' }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false)
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
        style={{
          padding: '14px 18px', borderRadius: 8,
          border: `1.5px dashed ${dragging ? 'var(--accent)' : 'var(--line-2)'}`,
          background: dragging ? 'var(--accent-dim)' : 'var(--bg-elev)',
          display: 'flex', alignItems: 'center', gap: 10, cursor: 'default',
        }}
      >
        <span style={{ fontSize: 16, color: 'var(--fg-4)' }}>{'</>'}</span>
        <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>
          {uploading ? `Uploading ${uploading}…` : 'Drop source files here, or click to browse — .ts, .py, .dart, .go, .rs, .java, .rb, .php, .swift, .c/.cpp, .cs, .sh, .ps1, and more'}
        </span>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={e => { if (e.target.files?.length) handleFiles(e.target.files) }}
        />
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTag()}
          placeholder="Add extra tags before uploading (optional)…"
          style={{ width: 260, padding: '6px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)' }}
        />
        {tags.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', fontSize: 11, color: 'var(--fg-2)' }}>
            #{t}
            <button onClick={() => setTags(prev => prev.filter(x => x !== t))} style={{ color: 'var(--fg-3)' }}>×</button>
          </span>
        ))}
        <input
          list="code-component-options"
          value={component}
          onChange={e => setComponent(e.target.value)}
          placeholder="Component (e.g. Custom Layer - SAP)…"
          style={{ width: 260, padding: '6px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)' }}
        />
        <datalist id="code-component-options">
          {existingComponents.map(c => <option key={c} value={c} />)}
        </datalist>
        {component && (
          <button onClick={() => setComponent('')} style={{ color: 'var(--fg-3)', fontSize: 11 }} title="Clear component">
            × clear
          </button>
        )}
      </div>
    </div>
  )
}

// ── Preview panel ─────────────────────────────────────────────────────────

function CodePreviewPanel({ docId, onClose, onReembedSuccess, onNavigate }: { docId: string; onClose: () => void; onReembedSuccess: (id: string, status: EmbeddingStatus) => void; onNavigate: (route: string, id: string) => void }) {
  const { toast } = useToast()
  const [doc, setDoc]         = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [reembed, setReembed] = useState(false)
  const [explaining,  setExplaining]  = useState(false)
  const [explanation, setExplanation] = useState<string | null>(null)
  const [saving,      setSaving]      = useState(false)
  const [savedTitle,  setSavedTitle]  = useState<string | null>(null)
  const [updating,    setUpdating]    = useState(false)
  const [diagramming, setDiagramming] = useState(false)
  const [diagram,     setDiagram]     = useState<string | null>(null)
  const [showEditor,  setShowEditor]  = useState(false)
  const updateFileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLoading(true)
    setExplanation(null)
    setSavedTitle(null)
    setDiagram(null)
    documentsApi.get(docId).then(d => {
      setDoc(d)
      setExplanation(d.explanation)
      setSavedTitle(d.linked_explanation_title)
      setDiagram(d.diagram)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [docId])

  async function handleReembed() {
    if (!doc || reembed) return
    setReembed(true)
    try {
      const result = await documentsApi.reembed(doc.id)
      setDoc(prev => prev ? { ...prev, embedding_status: result.embedding_status } : prev)
      onReembedSuccess(doc.id, result.embedding_status)
    } finally {
      setReembed(false)
    }
  }

  async function handleExplain() {
    if (!doc || explaining) return
    setExplaining(true)
    setSavedTitle(null)
    setExplanation('')
    try {
      await documentsApi.explainStream(doc.id, chunk => {
        setExplanation(prev => (prev ?? '') + chunk)
      })
    } catch {
      setExplanation('Failed to get explanation — is Ollama running?')
    } finally {
      setExplaining(false)
    }
  }

  async function handleDiagram() {
    if (!doc || diagramming) return
    setDiagramming(true)
    try {
      const res = await documentsApi.diagram(doc.id)
      setDiagram(res.diagram)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDiagramming(false)
    }
  }

  async function handleSaveExplanation() {
    if (!doc || saving || !explanation) return
    setSaving(true)
    try {
      const result = await documentsApi.saveExplanation(doc.id)
      setSavedTitle(result.title)
      toast(result.created ? `Saved as document "${result.title}"` : `Updated document "${result.title}"`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdateContent(file: File) {
    if (!doc || updating) return
    setUpdating(true)
    try {
      const result = await documentsApi.updateContent(doc.id, file)
      setDoc(result)
      onReembedSuccess(doc.id, result.embedding_status)
      toast(`"${doc.title}" updated and re-embedded (${result.chunk_count} chunks)`, 'success')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setUpdating(false)
    }
  }

  function handleEditorSaved(updated: DocDetail) {
    setDoc(updated)
    onReembedSuccess(updated.id, updated.embedding_status)
  }

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: 460, flexShrink: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {doc?.language && (
          <span style={{ height: 20, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: langColor(doc.language), background: 'var(--bg-elev-2)', border: `1px solid ${langColor(doc.language)}40`, display: 'inline-flex', alignItems: 'center' }}>
            {doc.language}
          </span>
        )}
        {doc?.component && (
          <span style={{ height: 20, padding: '0 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 600, color: 'var(--accent-2)', background: 'var(--accent-dim)', display: 'inline-flex', alignItems: 'center' }}>
            {doc.component}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
          {loading ? 'Loading…' : doc?.title}
        </span>
        {doc && (
          <button
            onClick={() => setShowEditor(true)}
            title="Open in editor"
            style={{ fontSize: 11, padding: '3px 9px', borderRadius: 5, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <span style={{ fontSize: 10 }}>⤢</span>
            Open
          </button>
        )}
        <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
      </div>

      {showEditor && doc && (
        <CodeEditorOverlay doc={doc} onClose={() => setShowEditor(false)} onSaved={handleEditorSaved} />
      )}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* AI Explain */}
        {doc && (
          <div>
            <button onClick={handleExplain} disabled={explaining} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 6,
              border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
              color: 'var(--accent-2)', fontSize: 12, fontWeight: 500,
              cursor: 'default', opacity: explaining ? 0.6 : 1,
            }}>
              <span style={{ fontSize: 10 }}>◆</span>
              {explaining ? 'Explaining…' : explanation ? 'Re-explain with AI' : 'Explain with AI'}
            </button>
            {doc.explanation_stale && !explaining && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 6,
                background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)',
                fontSize: 11.5, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>⚠</span>
                <span>File content changed since this explanation was generated — consider regenerating.</span>
              </div>
            )}
            {explanation && (
              <>
                <div style={{
                  marginTop: 10, padding: '12px 14px', borderRadius: 6,
                  background: 'var(--bg-elev)', border: '1px solid var(--line)',
                  fontSize: 12.5, lineHeight: 1.65, color: 'var(--fg-2)', whiteSpace: 'pre-wrap',
                }}>
                  {explanation}
                </div>
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button onClick={handleSaveExplanation} disabled={saving} style={{
                    fontSize: 11.5, padding: '5px 11px', borderRadius: 5,
                    border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
                    color: 'var(--fg-2)', cursor: 'default', opacity: saving ? 0.6 : 1,
                  }}>
                    {saving ? 'Saving…' : savedTitle ? 'Update saved document' : 'Save as document'}
                  </button>
                  {savedTitle && (
                    <span style={{ fontSize: 11, color: '#4ADE80' }}>✓ Saved to Documents</span>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* AI Diagram */}
        {doc && (
          <div>
            <button onClick={handleDiagram} disabled={diagramming} style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '6px 12px', borderRadius: 6,
              border: '1px solid var(--accent-line)', background: 'var(--accent-dim)',
              color: 'var(--accent-2)', fontSize: 12, fontWeight: 500,
              cursor: 'default', opacity: diagramming ? 0.6 : 1,
            }}>
              <span style={{ fontSize: 10 }}>◇</span>
              {diagramming ? 'Diagramming…' : diagram ? 'Regenerate diagram' : 'Generate diagram'}
            </button>
            {doc.diagram_stale && !diagramming && (
              <div style={{
                marginTop: 10, padding: '8px 12px', borderRadius: 6,
                background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)',
                fontSize: 11.5, color: '#F59E0B', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span>⚠</span>
                <span>File content changed since this diagram was generated — consider regenerating.</span>
              </div>
            )}
            {diagram && (
              <div style={{
                marginTop: 10, padding: '12px 14px', borderRadius: 6,
                background: 'var(--bg-elev)', border: '1px solid var(--line)',
              }}>
                <MermaidDiagram definition={diagram} />
              </div>
            )}
          </div>
        )}

        {doc && (
          <LinkedItems entityType="document" entityId={doc.id} onNavigate={onNavigate} />
        )}

        <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre', wordBreak: 'normal' }}>
          {loading ? 'Loading…' : (doc?.content ?? '')}
        </pre>
      </div>
      {doc && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-4)', display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
          <EmbedDot status={doc.embedding_status} />
          <span>{fmtSize(doc.content_length)}</span>
          <span style={{ flex: 1 }}>{fmtDate(doc.created_at)}</span>
          <input
            ref={updateFileRef}
            type="file"
            hidden
            onChange={e => { const f = e.target.files?.[0]; if (f) handleUpdateContent(f); e.target.value = '' }}
          />
          <button
            onClick={() => updateFileRef.current?.click()}
            disabled={updating}
            title="Replace this file's tracked content with a newer version"
            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', cursor: updating ? 'wait' : 'default', opacity: updating ? 0.6 : 1 }}
          >
            {updating ? 'Updating…' : 'Update file'}
          </button>
          {(doc.embedding_status === 'failed' || doc.embedding_status === 'pending') && (
            <button
              onClick={handleReembed}
              disabled={reembed}
              title="Re-embed this file"
              style={{ fontSize: 10, padding: '2px 7px', borderRadius: 3, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: reembed ? 'wait' : 'default', opacity: reembed ? 0.6 : 1 }}
            >
              {reembed ? 'Queueing…' : 'Re-embed'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Component overview modal ────────────────────────────────────────────

function ComponentOverviewModal({ projectId, onClose }: { projectId: string | undefined; onClose: () => void }) {
  const { toast } = useToast()
  const [components, setComponents] = useState<string[]>([])
  const [loading,     setLoading]     = useState(true)
  const [selected,    setSelected]    = useState('')
  const [generating,  setGenerating]  = useState(false)

  useEffect(() => {
    documentsApi.components(projectId).then(list => {
      setComponents(list)
      setSelected(list[0] ?? '')
    }).catch(() => setComponents([])).finally(() => setLoading(false))
  }, [projectId])

  async function handleGenerate() {
    if (!selected || generating) return
    setGenerating(true)
    try {
      const result = await documentsApi.componentOverview(selected, projectId ?? null)
      toast(
        `${result.created ? 'Generated' : 'Updated'} "${result.title}" from ${result.fileCount} file${result.fileCount !== 1 ? 's' : ''}`,
        'success'
      )
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setGenerating(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 9px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'grid', placeItems: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 18, width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>Generate component overview</span>
          <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          Combines the signature outlines of every code file tagged with one component into a single AI-generated architecture overview, saved to Documents.
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Loading components…</div>
        ) : components.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>No components found. Tag a code file with a component first (Upload → Component field).</div>
        ) : (
          <select value={selected} onChange={e => setSelected(e.target.value)} style={{ ...inp, height: 30 }}>
            {components.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!selected || generating}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: (!selected || generating) ? 0.6 : 1 }}
          >
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Duplicates modal ────────────────────────────────────────────────────────

type DuplicatePair = { docA: { id: string; title: string }; docB: { id: string; title: string }; score: number }

function scoreBand(score: number): { label: string; color: string } {
  if (score >= 0.9) return { label: 'near-identical', color: '#EF4444' }
  if (score >= 0.7) return { label: 'likely duplicate', color: '#F59E0B' }
  return { label: 'similar', color: 'var(--fg-4)' }
}

function DuplicatesModal({
  projectId, onClose, onOpenDoc, onDeleted,
}: {
  projectId: string | undefined
  onClose: () => void
  onOpenDoc: (id: string) => void
  onDeleted: () => void
}) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [pairs,   setPairs]   = useState<DuplicatePair[]>([])
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    documentsApi.findDuplicates(projectId ?? null)
      .then(setPairs)
      .catch(err => toast((err as Error).message, 'error'))
      .finally(() => setLoading(false))
  }, [projectId, toast])

  useEffect(() => { load() }, [load])

  async function handleDelete(id: string, title: string) {
    if (deletingId) return
    setDeletingId(id)
    try {
      await documentsApi.remove(id)
      setPairs(prev => prev.filter(p => p.docA.id !== id && p.docB.id !== id))
      toast(`"${title}" removed`)
      onDeleted()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'grid', placeItems: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 18, width: 560, maxHeight: '75vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>Possible duplicate files</span>
          <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
        </div>

        <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>
          Shortlisted by embedding similarity, confirmed by a line-level similarity score — no exact
          match required, so a renamed file with a few edited lines still shows up.
        </div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Scanning for duplicates…</div>
          ) : pairs.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>No likely duplicates found{projectId ? ' in this project' : ''}.</div>
          ) : (
            pairs.map(p => {
              const band = scoreBand(p.score)
              return (
                <div key={`${p.docA.id}|${p.docB.id}`} style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: band.color }}>{Math.round(p.score * 100)}% · {band.label}</span>
                  </div>
                  {[p.docA, p.docB].map(doc => (
                    <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => { onOpenDoc(doc.id); onClose() }} style={{ flex: 1, textAlign: 'left', fontSize: 12.5, color: 'var(--fg)', padding: '3px 0' }}>
                        {doc.title}
                      </button>
                      <button
                        onClick={() => handleDelete(doc.id, doc.title)}
                        disabled={deletingId === doc.id}
                        style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 4, border: '1px solid #EF444455', background: 'none', color: '#EF4444', cursor: deletingId === doc.id ? 'wait' : 'default', opacity: deletingId === doc.id ? 0.6 : 1 }}
                      >
                        {deletingId === doc.id ? 'Removing…' : 'Remove'}
                      </button>
                    </div>
                  ))}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}

// ── Codes page ────────────────────────────────────────────────────────────

export function CodesPage() {
  const { selectedId } = useProjectStore()
  const { toast }      = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [docs,       setDocs]       = useState<DocMeta[]>([])
  const [total,      setTotal]      = useState(0)
  const [nextOffset, setNextOffset] = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search,     setSearch]     = useState('')
  const [filters,    setFilters]    = useState<FilterState>(initialFilterState)
  const [selected,   setSelected]   = useState<string | null>(() => searchParams.get('open'))
  const [deleting,   setDeleting]   = useState<DocMeta | null>(null)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showDuplicatesModal, setShowDuplicatesModal] = useState(false)

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkWorking,   setBulkWorking]   = useState(false)
  const [confirmBulkDel, setConfirmBulkDel] = useState(false)
  const [componentOptions, setComponentOptions] = useState<string[]>([])
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  // Scoped to file_type='code' so this list (and the datalist it feeds in
  // CodeUploadStrip/FilterBar) never mixes in Documents' PDF/DOCX components.
  const refreshComponentOptions = useCallback(() => {
    documentsApi.components(selectedId ?? undefined, 'code').then(setComponentOptions).catch(() => {})
  }, [selectedId])

  useEffect(() => {
    refreshComponentOptions()
  }, [refreshComponentOptions])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => prev.size === docs.length ? new Set() : new Set(docs.map(d => d.id)))
  }, [docs])

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) { setLoading(true); setSelectedIds(new Set()) }
    else setLoadingMore(true)
    try {
      const result = await documentsApi.list({
        projectId: selectedId ?? undefined,
        fileType:  ['code'],
        tags:      filters.tags.length > 0 ? filters.tags : undefined,
        component: filters.component.length > 0 ? filters.component : undefined,
        dateFrom:  filters.dateFrom || undefined,
        dateTo:    filters.dateTo || undefined,
        q:         search.trim() || undefined,
        limit:     PAGE,
        offset,
      })
      setTotal(result.total)
      setDocs(prev => append ? [...prev, ...result.items] : result.items)
      setNextOffset(offset + result.items.length)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [selectedId, filters, search, toast])

  useEffect(() => {
    const timer = setTimeout(() => load(0, false), 150)
    return () => clearTimeout(timer)
  }, [load])

  async function handleDelete(doc: DocMeta) {
    try {
      await documentsApi.remove(doc.id)
      setDeleting(null)
      if (selected === doc.id) setSelected(null)
      toast(`"${doc.title}" removed`)
      load(0, false)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    try {
      await documentsApi.bulk([...selectedIds], 'delete')
      const count = selectedIds.size
      setDocs(prev => prev.filter(d => !selectedIds.has(d.id)))
      setTotal(t => t - count)
      if (selected && selectedIds.has(selected)) setSelected(null)
      toast(`Removed ${count} file${count !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk remove failed', 'error')
    } finally {
      setBulkWorking(false)
      setConfirmBulkDel(false)
    }
  }

  async function handleBulkTag(tag: string) {
    if (!tag.trim()) return
    setBulkWorking(true)
    try {
      await documentsApi.bulk([...selectedIds], 'tag', tag.trim())
      setDocs(prev => prev.map(d => {
        if (selectedIds.has(d.id)) {
          const newTags = d.tags.includes(tag.trim()) ? d.tags : [...d.tags, tag.trim()]
          return { ...d, tags: newTags }
        }
        return d
      }))
      toast(`Tagged ${selectedIds.size} file${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk tagging failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkComponent(component: string) {
    const value = component.trim()
    if (!value) return
    setBulkWorking(true)
    try {
      await documentsApi.bulk([...selectedIds], 'component', value)
      setDocs(prev => prev.map(d => selectedIds.has(d.id) ? { ...d, component: value } : d))
      toast(`Set component on ${selectedIds.size} file${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
      refreshComponentOptions()
    } catch {
      toast('Bulk component update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < docs.length
    }
  }, [selectedIds, docs])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Codes</h1>
        <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{total}</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tracked code…"
          style={{ marginLeft: 8, height: 26, padding: '0 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)', width: 220 }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--fg-4)', marginLeft: 4 }}>
          {selectedId ? 'filtered by project' : 'all projects'}
        </span>
        <button
          onClick={() => setShowDuplicatesModal(true)}
          style={{ marginLeft: 'auto', fontSize: 11.5, padding: '5px 11px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: 'var(--fg-3)', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 10 }}>⧉</span>
          Find duplicates
        </button>
        <button
          onClick={() => setShowOverviewModal(true)}
          style={{ fontSize: 11.5, padding: '5px 11px', borderRadius: 5, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 10 }}>◇</span>
          Component overview
        </button>
      </div>

      {showOverviewModal && (
        <ComponentOverviewModal projectId={selectedId ?? undefined} onClose={() => setShowOverviewModal(false)} />
      )}

      {showDuplicatesModal && (
        <DuplicatesModal
          projectId={selectedId ?? undefined}
          onClose={() => setShowDuplicatesModal(false)}
          onOpenDoc={id => { setSelected(id); setSearchParams({ open: id }, { replace: true }) }}
          onDeleted={() => load(0, false)}
        />
      )}

      <FilterBar entityType="codes" filters={filters} onChange={setFilters} />

      <div style={{ paddingTop: 14 }}>
        <CodeUploadStrip projectId={selectedId ?? undefined} existingComponents={componentOptions} onDone={() => { load(0, false); refreshComponentOptions() }} />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', marginTop: 16 }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '24px 32px 1fr 100px 90px 80px 80px', gap: 12, padding: '8px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1, alignItems: 'center' }}>
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              checked={docs.length > 0 && selectedIds.size === docs.length}
              onChange={toggleSelectAll}
              style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
            />
            <span />
            <span>File</span>
            <span>Language</span>
            <span>Chunks</span>
            <span>Size</span>
            <span>Date</span>
          </div>

          {loading && [1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} cols={[14, 7, 220, 70, 60, 70, 70]} />)}

          {!loading && docs.length === 0 && (
            <div style={{ padding: '48px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 28, color: 'var(--fg-4)' }}>{'</>'}</div>
              <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                {search ? `No tracked code matches "${search}".` : 'No code files tracked yet.'}
              </div>
              {!search && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>Drop a source file above to start tracking it.</div>}
            </div>
          )}

          {docs.map(doc => {
            const isSel = selected === doc.id
            const isChecked = selectedIds.has(doc.id)
            return (
              <div
                key={doc.id}
                onClick={() => { const next = isSel ? null : doc.id; setSelected(next); setSearchParams(next ? { open: next } : {}, { replace: true }) }}
                className={`bulk-select-row ${isChecked ? 'bulk-select-row-selected' : ''} ${selectedIds.size > 0 ? 'bulk-select-has-selection' : ''}`}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 32px 1fr 100px 90px 80px 80px',
                  gap: 12, padding: '9px 18px',
                  borderBottom: '1px solid var(--line)',
                  background: isSel ? 'var(--accent-dim)' : 'transparent',
                  cursor: 'default', alignItems: 'center',
                }}
              >
                <input
                  type="checkbox"
                  className="bulk-select-checkbox"
                  checked={isChecked}
                  onChange={e => { e.stopPropagation(); toggleSelect(doc.id) }}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
                />

                <span style={{ width: 7, height: 7, borderRadius: '50%', background: doc.project_color ?? 'var(--fg-4)', display: 'inline-block', margin: 'auto' }} />

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
                    {(doc.explanation_stale || doc.diagram_stale) && (
                      <span title="Docs may be outdated — file content changed since the explanation/diagram was generated" style={{ fontSize: 10, color: '#F59E0B', flexShrink: 0 }}>⚠</span>
                    )}
                  </div>
                  {(doc.project_name || doc.component) && (
                    <div style={{ fontSize: 11, color: 'var(--fg-4)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {doc.project_name && <span>{doc.project_name}</span>}
                      {doc.component && (
                        <span style={{ padding: '0 6px', borderRadius: 8, background: 'var(--accent-dim)', color: 'var(--accent-2)', fontSize: 10, fontWeight: 600, lineHeight: '15px' }}>
                          {doc.component}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <span style={{ fontSize: 11, fontWeight: 600, color: langColor(doc.language), fontFamily: 'var(--font-mono)' }}>
                  {doc.language ?? '—'}
                </span>

                <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <EmbedDot status={doc.embedding_status} />
                  {doc.chunk_count}
                </span>

                <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  {fmtSize(doc.content_length)}
                </span>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(doc.created_at)}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleting(doc) }}
                    style={{ color: 'var(--fg-4)', fontSize: 11, padding: '2px 5px', borderRadius: 3, opacity: 0.6 }}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          {!loading && docs.length < total && (
            <div style={{ padding: '12px 18px', textAlign: 'center' }}>
              <button
                onClick={() => load(nextOffset, true)}
                disabled={loadingMore}
                style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: loadingMore ? 0.6 : 1 }}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - docs.length} remaining)`}
              </button>
            </div>
          )}
        </div>

        {selected && (
          <CodePreviewPanel
            docId={selected}
            onClose={() => { setSelected(null); setSearchParams({}, { replace: true }) }}
            onReembedSuccess={(id, status) => setDocs(prev => prev.map(d => d.id === id ? { ...d, embedding_status: status } : d))}
            onNavigate={(route, id) => navigate(`${route}?open=${id}`)}
          />
        )}
      </div>

      {deleting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Remove "{deleting.title}"?</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)' }}>All {deleting.chunk_count} embedded chunks will also be deleted. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setDeleting(null)} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5 }}>Cancel</button>
              <button onClick={() => handleDelete(deleting)} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: 'none', background: '#F05A5A', color: 'white', fontSize: 12.5 }}>Remove</button>
            </div>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-elev-2)', border: '1px solid var(--accent-line)', borderRadius: 10,
          padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, animation: 'modal-in 0.15s ease',
        }}>
          <span style={{ fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: 500, marginRight: 6 }}>
            {selectedIds.size} selected
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                placeholder="Add tag..."
                onKeyDown={e => {
                  if (e.key === 'Enter') { handleBulkTag(e.currentTarget.value); e.currentTarget.value = '' }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 85, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                list="code-component-options"
                placeholder="Set component..."
                onKeyDown={e => {
                  if (e.key === 'Enter') { handleBulkComponent(e.currentTarget.value); e.currentTarget.value = '' }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 105, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            {!confirmBulkDel ? (
              <button
                onClick={() => setConfirmBulkDel(true)}
                disabled={bulkWorking}
                style={{ fontSize: '11.5px', padding: '4px 12px', borderRadius: 6, border: '1px solid rgba(239,68,68,.4)', background: 'rgba(239,68,68,.08)', color: '#EF4444' }}
              >
                Remove
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  style={{ fontSize: '11.5px', padding: '4px 12px', borderRadius: 6, border: 'none', background: '#EF4444', color: 'white' }}
                >
                  {bulkWorking ? 'Removing…' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmBulkDel(false)}
                  disabled={bulkWorking}
                  style={{ fontSize: '11.5px', padding: '4px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg-elev)', color: 'var(--fg-3)' }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

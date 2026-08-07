import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { documentsApi, type DocMeta, type DocDetail, type EmbeddingStatus } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import { LinkedItems } from '../components/LinkedItems'
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

// ── New note modal ───────────────────────────────────────────────────────

function NewNoteModal({ onClose, onCreated }: { onClose: () => void; onCreated: (doc: DocDetail) => void }) {
  const { toast } = useToast()
  const { selectedId } = useProjectStore()
  const [title,    setTitle]    = useState('')
  const [tagsRaw,  setTagsRaw]  = useState('')
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!title.trim() || creating) return
    setCreating(true)
    try {
      const tags = tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      const created = await documentsApi.createNote(title.trim(), '', selectedId ?? undefined, tags)
      onCreated(created)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setCreating(false)
    }
  }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 9px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 400, display: 'grid', placeItems: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 18, width: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>New note</span>
          <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--fg-4)', display: 'block', marginBottom: 4 }}>Title</label>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            placeholder="Quick note title…"
            autoFocus
            style={inp}
          />
        </div>

        <div>
          <label style={{ fontSize: 11, color: 'var(--fg-4)', display: 'block', marginBottom: 4 }}>Tags (optional)</label>
          <input value={tagsRaw} onChange={e => setTagsRaw(e.target.value)} placeholder="idea, meeting, todo" style={inp} />
        </div>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 12, padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default' }}>
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!title.trim() || creating}
            style={{ fontSize: 12, padding: '5px 14px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', cursor: 'default', opacity: (!title.trim() || creating) ? 0.6 : 1 }}
          >
            {creating ? 'Creating…' : 'Create & write'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Preview panel ─────────────────────────────────────────────────────────

function NotePreviewPanel({ docId, onClose, onReembedSuccess, onNavigate }: { docId: string; onClose: () => void; onReembedSuccess: (id: string, status: EmbeddingStatus) => void; onNavigate: (route: string, id: string) => void }) {
  const [doc, setDoc]         = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [showEditor, setShowEditor] = useState(false)

  useEffect(() => {
    setLoading(true)
    documentsApi.get(docId).then(d => {
      setDoc(d)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [docId])

  function handleEditorSaved(updated: DocDetail) {
    setDoc(updated)
    onReembedSuccess(updated.id, updated.embedding_status)
  }

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: 460, flexShrink: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
        {doc?.tags && doc.tags.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {doc.tags.map(t => (
              <span key={t} style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 10, background: 'var(--bg-elev-2)', color: 'var(--fg-3)', border: '1px solid var(--line-2)' }}>
                {t}
              </span>
            ))}
          </div>
        )}

        {doc && (
          <LinkedItems entityType="document" entityId={doc.id} onNavigate={onNavigate} />
        )}

        <pre style={{ margin: 0, fontSize: 12.5, lineHeight: 1.65, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {loading ? 'Loading…' : (doc?.content || '(empty note)')}
        </pre>
      </div>

      {doc && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-4)', display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
          <EmbedDot status={doc.embedding_status} />
          <span>{fmtSize(doc.content_length)}</span>
          <span style={{ flex: 1 }}>{fmtDate(doc.created_at)}</span>
        </div>
      )}
    </div>
  )
}

// ── Notes page ────────────────────────────────────────────────────────────

export function NotesPage() {
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
  const [selected,   setSelected]   = useState<string | null>(() => searchParams.get('open'))
  const [deleting,   setDeleting]   = useState<DocMeta | null>(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [composingDoc, setComposingDoc] = useState<DocDetail | null>(null)

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) setLoading(true); else setLoadingMore(true)
    try {
      const result = await documentsApi.list({
        projectId: selectedId ?? undefined,
        fileType:  ['note'],
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
  }, [selectedId, search, toast])

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

  function handleCreated(created: DocDetail) {
    setShowNewModal(false)
    setSelected(created.id)
    setSearchParams({ open: created.id }, { replace: true })
    setComposingDoc(created)
    load(0, false)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Notes</h1>
        <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{total}</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search notes…"
          style={{ marginLeft: 8, height: 26, padding: '0 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)', width: 220 }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--fg-4)', marginLeft: 4 }}>
          {selectedId ? 'filtered by project' : 'all projects'}
        </span>
        <button
          onClick={() => setShowNewModal(true)}
          style={{ marginLeft: 'auto', fontSize: 11.5, padding: '5px 11px', borderRadius: 5, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', cursor: 'default', display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span style={{ fontSize: 10 }}>+</span>
          New note
        </button>
      </div>

      {showNewModal && (
        <NewNoteModal onClose={() => setShowNewModal(false)} onCreated={handleCreated} />
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', marginTop: 16 }}>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 1fr 90px', gap: 12, padding: '8px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
            <span />
            <span>Title</span>
            <span>Tags</span>
            <span>Date</span>
          </div>

          {loading && [1, 2, 3, 4, 5].map(i => <SkeletonRow key={i} cols={[7, 220, 160, 70]} />)}

          {!loading && docs.length === 0 && (
            <div style={{ padding: '48px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 28, color: 'var(--fg-4)' }}>📝</div>
              <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                {search ? `No notes match "${search}".` : 'No notes yet.'}
              </div>
              {!search && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>Click "New note" above to jot one down.</div>}
            </div>
          )}

          {docs.map(doc => {
            const isSel = selected === doc.id
            return (
              <div
                key={doc.id}
                onClick={() => { const next = isSel ? null : doc.id; setSelected(next); setSearchParams(next ? { open: next } : {}, { replace: true }) }}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 1fr 90px',
                  gap: 12, padding: '9px 18px',
                  borderBottom: '1px solid var(--line)',
                  background: isSel ? 'var(--accent-dim)' : 'transparent',
                  cursor: 'default', alignItems: 'center',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: doc.project_color ?? 'var(--fg-4)', display: 'inline-block', margin: 'auto' }} />

                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <EmbedDot status={doc.embedding_status} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</span>
                  </div>
                  {doc.project_name && (
                    <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{doc.project_name}</div>
                  )}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, overflow: 'hidden' }}>
                  {doc.tags.slice(0, 3).map(t => (
                    <span key={t} style={{ fontSize: 10, padding: '1px 7px', borderRadius: 8, background: 'var(--bg-elev-2)', color: 'var(--fg-3)', border: '1px solid var(--line-2)', whiteSpace: 'nowrap' }}>
                      {t}
                    </span>
                  ))}
                </div>

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
          <NotePreviewPanel
            docId={selected}
            onClose={() => { setSelected(null); setSearchParams({}, { replace: true }) }}
            onReembedSuccess={(id, status) => setDocs(prev => prev.map(d => d.id === id ? { ...d, embedding_status: status } : d))}
            onNavigate={(route, id) => navigate(`${route}?open=${id}`)}
          />
        )}
      </div>

      {composingDoc && (
        <CodeEditorOverlay
          doc={composingDoc}
          startInEditMode
          onClose={() => setComposingDoc(null)}
          onSaved={updated => {
            setDocs(prev => prev.map(d => d.id === updated.id ? { ...d, embedding_status: updated.embedding_status } : d))
          }}
        />
      )}

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
    </>
  )
}

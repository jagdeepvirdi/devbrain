import { useState, useEffect, useCallback, useRef } from 'react'
import { documentsApi, type DocMeta, type DocDetail } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'

// ── Helpers ───────────────────────────────────────────────────────────────

const TYPE_STYLE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pdf:  { label: 'PDF',  color: '#F8A8A8', bg: 'rgba(240,90,90,.10)',  border: 'rgba(240,90,90,.25)'  },
  docx: { label: 'DOCX', color: '#93C5FD', bg: 'rgba(96,165,250,.10)',  border: 'rgba(96,165,250,.25)'  },
  md:   { label: 'MD',   color: '#C4B5FD', bg: 'rgba(167,139,250,.10)', border: 'rgba(167,139,250,.25)' },
  txt:  { label: 'TXT',  color: 'var(--fg-3)', bg: 'var(--bg-elev-2)', border: 'var(--line-2)'         },
  xlsx: { label: 'XLS',  color: '#86EFAC', bg: 'rgba(74,222,128,.10)',  border: 'rgba(74,222,128,.25)'  },
  url:  { label: 'URL',  color: '#5EEAD4', bg: 'rgba(45,212,191,.10)',  border: 'rgba(45,212,191,.25)'  },
}

function fmtSize(chars: number) {
  if (chars < 1000) return `${chars} ch`
  if (chars < 1_000_000) return `${(chars / 1000).toFixed(1)} K`
  return `${(chars / 1_000_000).toFixed(1)} M`
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

// ── Upload drop zone ──────────────────────────────────────────────────────

function DropZone({ projectId, onDone }: { projectId: string | undefined; onDone: () => void }) {
  const [dragging,  setDragging]  = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [urlInput,  setUrlInput]  = useState('')
  const [error,     setError]     = useState<string | null>(null)
  const [tagInput,  setTagInput]  = useState('')
  const [tags,      setTags]      = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  function addTag() {
    const t = tagInput.trim().replace(/,/g, '')
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags(prev => [...prev, t])
    setTagInput('')
  }

  async function handleFiles(files: FileList) {
    setError(null)
    for (const file of Array.from(files)) {
      setUploading(file.name)
      try {
        await documentsApi.upload(file, projectId, tags)
      } catch (err) {
        setError((err as Error).message)
      }
    }
    setUploading(null)
    setTags([])
    onDone()
  }

  async function handleUrl() {
    const url = urlInput.trim()
    if (!url) return
    setError(null)
    setUploading(url)
    try {
      await documentsApi.importUrl(url, projectId, tags)
      setUrlInput('')
      setTags([])
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(null)
    }
  }

  return (
    <div style={{ margin: '16px 24px 0' }}>
      {/* Drop area */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
        onClick={() => fileRef.current?.click()}
        style={{
          border: `1px dashed ${dragging ? 'var(--accent)' : 'var(--line-3)'}`,
          borderRadius: '10px',
          padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: '14px',
          background: dragging ? 'var(--accent-dim)' : 'var(--bg-elev)',
          cursor: 'pointer',
          transition: 'all .15s',
        }}
      >
        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', color: 'var(--accent-2)', display: 'grid', placeItems: 'center', flexShrink: 0, fontSize: 18 }}>
          ↑
        </div>
        <div>
          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>
            {uploading ? `Embedding "${uploading}"…` : 'Drop files here or click to browse'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
            PDF · DOCX · MD · TXT · XLSX — up to 50 MB each
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.md,.txt,.xlsx,.xls"
        style={{ display: 'none' }} onChange={e => e.target.files && handleFiles(e.target.files)} />

      {/* URL input */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          value={urlInput}
          onChange={e => setUrlInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleUrl()}
          placeholder="Or paste a URL to import…"
          style={{ flex: 1, padding: '7px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--fg)' }}
        />
        <button
          onClick={handleUrl}
          disabled={!urlInput.trim() || !!uploading}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'white', fontSize: 12, border: 'none', opacity: (!urlInput.trim() || !!uploading) ? .5 : 1 }}
        >
          Import
        </button>
      </div>

      {/* Tags input */}
      <div style={{ marginTop: 8 }}>
        {tags.length > 0 && (
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
            {tags.map(t => (
              <span key={t} style={{ fontSize: '11px', padding: '1px 7px', borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', color: 'var(--accent-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                {t}
                <button onClick={() => setTags(prev => prev.filter(x => x !== t))} style={{ color: 'var(--accent-2)', fontSize: 9, background: 'none', border: 'none', cursor: 'default', padding: 0, lineHeight: 1 }}>✕</button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag() } }}
            placeholder="Add tags before uploading… (Enter or comma)"
            style={{ flex: 1, padding: '5px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--fg)', outline: 'none' }}
          />
          {tagInput.trim() && (
            <button onClick={addTag} style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius)', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', color: 'var(--fg-3)', fontSize: '11px', cursor: 'default' }}>
              Add
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(240,90,90,.08)', border: '1px solid rgba(240,90,90,.25)', borderRadius: 'var(--radius)', fontSize: 12.5, color: '#F8A8A8' }}>
          {error}
        </div>
      )}
    </div>
  )
}

// ── Document preview panel ────────────────────────────────────────────────

function PreviewPanel({ docId, onClose }: { docId: string; onClose: () => void }) {
  const [doc, setDoc]   = useState<DocDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    documentsApi.get(docId).then(d => { setDoc(d); setLoading(false) }).catch(() => setLoading(false))
  }, [docId])

  const ts = TYPE_STYLE[doc?.file_type ?? ''] ?? TYPE_STYLE.txt

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: 380, flexShrink: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {doc && (
          <span style={{ height: 20, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, display: 'inline-flex', alignItems: 'center' }}>
            {ts.label}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : doc?.title}
        </span>
        <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontSize: 12.5, lineHeight: 1.65, color: 'var(--fg-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {loading ? 'Loading…' : (doc?.content ?? '')}
      </div>
      {doc && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-4)', display: 'flex', gap: 12, fontFamily: 'var(--font-mono)' }}>
          <span>{doc.chunk_count} chunks</span>
          <span>{fmtSize(doc.content_length)}</span>
          <span>{fmtDate(doc.created_at)}</span>
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────

const PAGE = 25

export function DocumentsPage() {
  const { selectedId } = useProjectStore()
  const { toast }      = useToast()

  const [docs,        setDocs]        = useState<DocMeta[]>([])
  const [total,       setTotal]       = useState(0)
  const [nextOffset,  setNextOffset]  = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState<DocMeta | null>(null)

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) setLoading(true)
    else setLoadingMore(true)
    try {
      const result = await documentsApi.list({
        projectId: selectedId ?? undefined,
        search:    search || undefined,
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

  useEffect(() => { load(0, false) }, [load])

  async function handleDelete(doc: DocMeta) {
    try {
      await documentsApi.remove(doc.id)
      setDeleting(null)
      if (selected === doc.id) setSelected(null)
      toast(`"${doc.title}" deleted`)
      load(0, false)
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  return (
    <>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Documents</h1>
        <span style={{ fontSize: 11, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{total}</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search documents…"
          style={{ marginLeft: 8, height: 26, padding: '0 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)', width: 220 }}
        />
        <span style={{ fontSize: 11.5, color: 'var(--fg-4)', marginLeft: 4 }}>
          {selectedId ? 'filtered by project' : 'all projects'}
        </span>
      </div>

      {/* Drop zone */}
      <DropZone projectId={selectedId ?? undefined} onDone={() => load(0, false)} />

      {/* Table + preview split */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', marginTop: 16 }}>
        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 100px 80px', gap: 12, padding: '8px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1 }}>
            <span />
            <span>Title</span>
            <span>Type</span>
            <span>Chunks</span>
            <span>Size</span>
            <span>Date</span>
          </div>

          {loading && [1,2,3,4,5].map(i => <SkeletonRow key={i} cols={[7, 220, 60, 70, 90, 70]} />)}

          {!loading && docs.length === 0 && (
            <div style={{ padding: '48px 18px', color: 'var(--fg-4)', fontSize: 12.5, textAlign: 'center' }}>
              {search ? 'No documents match your search.' : 'No documents yet. Upload a file or import a URL above.'}
            </div>
          )}

          {docs.map(doc => {
            const ts   = TYPE_STYLE[doc.file_type] ?? TYPE_STYLE.txt
            const isSel = selected === doc.id
            return (
              <div
                key={doc.id}
                onClick={() => setSelected(isSel ? null : doc.id)}
                style={{
                  display: 'grid', gridTemplateColumns: '32px 1fr 70px 80px 100px 80px',
                  gap: 12, padding: '9px 18px',
                  borderBottom: '1px solid var(--line)',
                  background: isSel ? 'var(--accent-dim)' : 'transparent',
                  cursor: 'default',
                  alignItems: 'center',
                }}
              >
                {/* Project color dot */}
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: doc.project_color ?? 'var(--fg-4)', display: 'inline-block', margin: 'auto' }} />

                {/* Title */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
                  {doc.project_name && <div style={{ fontSize: 11, color: 'var(--fg-4)' }}>{doc.project_name}</div>}
                </div>

                {/* Type badge */}
                <span style={{ height: 18, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {ts.label}
                </span>

                {/* Chunk count */}
                <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                  {doc.chunk_count}
                </span>

                {/* Size */}
                <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                  {fmtSize(doc.content_length)}
                </span>

                {/* Date + delete */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(doc.created_at)}
                  </span>
                  <button
                    onClick={e => { e.stopPropagation(); setDeleting(doc) }}
                    style={{ color: 'var(--fg-4)', fontSize: 11, padding: '2px 5px', borderRadius: 3, opacity: 0.6 }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}

          {/* Load more */}
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

        {/* Preview panel */}
        {selected && <PreviewPanel docId={selected} onClose={() => setSelected(null)} />}
      </div>

      {/* Delete confirm */}
      {deleting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: 24, maxWidth: 360, width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Delete "{deleting.title}"?</p>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--fg-3)' }}>All {deleting.chunk_count} embedded chunks will also be deleted. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button onClick={() => setDeleting(null)} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5 }}>Cancel</button>
              <button onClick={() => handleDelete(deleting)} style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: 'none', background: '#F05A5A', color: 'white', fontSize: 12.5 }}>Delete</button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}

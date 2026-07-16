import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { documentsApi, type DocMeta, type DocDetail, type EmbeddingStatus } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import { FilterBar, initialFilterState } from '../components/FilterBar'
import type { FilterState } from '../components/FilterBar'
import { LinkedItems } from '../components/LinkedItems'

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

function DropZone({ projectId, existingComponents, onDone }: { projectId: string | undefined; existingComponents: string[]; onDone: () => void }) {
  const [dragging,       setDragging]       = useState(false)
  const [uploading,      setUploading]      = useState<string | null>(null)
  const [urlInput,       setUrlInput]       = useState('')
  const [error,          setError]          = useState<string | null>(null)
  const [tagInput,       setTagInput]       = useState('')
  const [tags,           setTags]           = useState<string[]>([])
  const [component,      setComponent]      = useState('')
  const [suggestedTags,  setSuggestedTags]  = useState<string[]>([])
  const [suggesting,     setSuggesting]     = useState(false)
  const [stagedFile,     setStagedFile]     = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSuggestTags() {
    // A single staged file gets real content-based suggestions; otherwise
    // (multi-file batch, or a URL import) fall back to the typed hint.
    if (!stagedFile && !urlInput.trim() && !tagInput.trim()) return
    setSuggesting(true)
    try {
      const { tags: suggested } = stagedFile
        ? await documentsApi.suggestTagsFromFile(stagedFile)
        : await documentsApi.suggestTags(urlInput.trim() || tagInput.trim())
      setSuggestedTags(suggested.filter(t => !tags.includes(t)))
    } catch {
      // silently fail
    } finally {
      setSuggesting(false)
    }
  }

  function acceptSuggested(tag: string) {
    setTags(prev => prev.includes(tag) ? prev : [...prev, tag])
    setSuggestedTags(prev => prev.filter(t => t !== tag))
  }

  function addTag() {
    const t = tagInput.trim().replace(/,/g, '')
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags(prev => [...prev, t])
    setTagInput('')
  }

  async function handleFiles(files: FileList) {
    setError(null)
    const list = Array.from(files)

    // A single file is staged (not uploaded yet) so Auto-tag can analyze its
    // real content first. Multi-file drops/selections upload immediately,
    // same as before — one shared tag set doesn't fit several files anyway.
    if (list.length === 1) {
      setStagedFile(list[0])
      setSuggestedTags([])
      return
    }

    for (const file of list) {
      setUploading(file.name)
      try {
        await documentsApi.upload(file, projectId, tags, component.trim() || undefined)
      } catch (err) {
        setError((err as Error).message)
      }
    }
    setUploading(null)
    setTags([])
    onDone()
  }

  async function handleUploadStaged() {
    if (!stagedFile) return
    setError(null)
    setUploading(stagedFile.name)
    try {
      await documentsApi.upload(stagedFile, projectId, tags, component.trim() || undefined)
      setStagedFile(null)
      setTags([])
      setSuggestedTags([])
      onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(null)
    }
  }

  async function handleUrl() {
    const url = urlInput.trim()
    if (!url) return
    setError(null)
    setUploading(url)
    try {
      await documentsApi.importUrl(url, projectId, tags, component.trim() || undefined)
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
            {uploading ? `Embedding "${uploading}"…` : stagedFile ? `Ready to upload "${stagedFile.name}"` : 'Drop files here or click to browse'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--fg-3)', marginTop: 2 }}>
            PDF · DOC · DOCX · MD · TXT · XLSX · YAML · LOG · SQL · JSON · CSV · HTML · IPYNB — up to 50 MB each
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.md,.txt,.xlsx,.xls,.yaml,.yml,.log,.sql,.json,.csv,.html,.htm,.ipynb"
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />

      {stagedFile && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', borderRadius: 'var(--radius)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {stagedFile.name} — add tags/component below, then upload
          </span>
          <button
            onClick={handleUploadStaged}
            disabled={!!uploading}
            style={{ height: 26, padding: '0 12px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'white', fontSize: 11.5, border: 'none', opacity: uploading ? .5 : 1 }}
          >
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
          <button
            onClick={() => { setStagedFile(null); setSuggestedTags([]) }}
            disabled={!!uploading}
            style={{ height: 26, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11.5 }}
          >
            Cancel
          </button>
        </div>
      )}

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

      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTag()}
          placeholder="Add tags to files/URL before importing…"
          style={{ width: 300, padding: '6px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)' }}
        />
        <button
          onClick={handleSuggestTags}
          disabled={suggesting}
          title={stagedFile ? `Analyze "${stagedFile.name}"'s actual content` : 'Suggest tags from typed text (select a single file to analyze its real content instead)'}
          style={{ height: 28, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 11.5 }}
        >
          {suggesting ? 'Suggesting…' : '🪄 Auto-tag'}
        </button>
        {tags.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', fontSize: 11, color: 'var(--fg-2)' }}>
            #{t}
            <button onClick={() => setTags(prev => prev.filter(x => x !== t))} style={{ color: 'var(--fg-3)' }}>×</button>
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 8, alignItems: 'center' }}>
        <input
          list="component-options"
          value={component}
          onChange={e => setComponent(e.target.value)}
          placeholder="Component (e.g. SAP, BPP, Payment)…"
          style={{ width: 300, padding: '6px 10px', background: 'var(--bg-elev-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius)', fontSize: 12.5, color: 'var(--fg)' }}
        />
        <datalist id="component-options">
          {existingComponents.map(c => <option key={c} value={c} />)}
        </datalist>
        {component && (
          <button onClick={() => setComponent('')} style={{ color: 'var(--fg-3)', fontSize: 11 }} title="Clear component">
            × clear
          </button>
        )}
      </div>
      {suggestedTags.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Suggestions:</span>
          {suggestedTags.map(t => (
            <button key={t} onClick={() => acceptSuggested(t)} style={{ padding: '2px 8px', borderRadius: 4, border: '1px dashed var(--line-3)', background: 'transparent', color: 'var(--fg-3)', fontSize: 11 }}>
              +{t}
            </button>
          ))}
        </div>
      )}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--red)' }}>{error}</div>}
    </div>
  )
}

// ── Embedding status dot ──────────────────────────────────────────────────

const EMBED_DOT: Record<EmbeddingStatus, { color: string; title: string }> = {
  pending:    { color: '#64748B', title: 'Embedding pending' },
  processing: { color: '#F59E0B', title: 'Embedding in progress…' },
  done:       { color: '#22C55E', title: 'Embedded' },
  failed:     { color: '#EF4444', title: 'Embedding failed — click to retry' },
}

function EmbedDot({ status, onClick }: { status: EmbeddingStatus; onClick?: () => void }) {
  const { color, title } = EMBED_DOT[status] ?? EMBED_DOT.pending
  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      title={title}
      style={{
        width: 6, height: 6, borderRadius: '50%', background: color,
        display: 'inline-block', flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: status === 'processing' ? `0 0 5px ${color}` : undefined,
      }}
    />
  )
}

// ── Document preview panel ────────────────────────────────────────────────

function PreviewPanel({ docId, onClose, onReembedSuccess, onNavigate }: { docId: string; onClose: () => void; onReembedSuccess: (id: string, status: EmbeddingStatus) => void; onNavigate: (route: string, id: string) => void }) {
  const [doc, setDoc]           = useState<DocDetail | null>(null)
  const [loading, setLoading]   = useState(true)
  const [reembed, setReembed]   = useState(false)

  useEffect(() => {
    setLoading(true)
    documentsApi.get(docId).then(d => { setDoc(d); setLoading(false) }).catch(() => setLoading(false))
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

  const ts = TYPE_STYLE[doc?.file_type ?? ''] ?? TYPE_STYLE.txt

  return (
    <div style={{ borderLeft: '1px solid var(--line)', background: 'var(--panel)', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: 380, flexShrink: 0 }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        {doc && (
          <span style={{ height: 20, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, display: 'inline-flex', alignItems: 'center' }}>
            {ts.label}
          </span>
        )}
        {doc?.component && (
          <span style={{ height: 20, padding: '0 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 600, color: 'var(--accent-2)', background: 'var(--accent-dim)', display: 'inline-flex', alignItems: 'center' }}>
            {doc.component}
          </span>
        )}
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {loading ? 'Loading…' : doc?.title}
        </span>
        <button onClick={onClose} style={{ color: 'var(--fg-3)', fontSize: 13, padding: '2px 6px', borderRadius: 'var(--radius)' }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {doc && (
          <LinkedItems entityType="document" entityId={doc.id} onNavigate={onNavigate} />
        )}
        <div style={{ fontSize: 12.5, lineHeight: 1.65, color: 'var(--fg-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {loading ? 'Loading…' : (doc?.content ?? '')}
        </div>
      </div>
      {doc && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--fg-4)', display: 'flex', gap: 10, fontFamily: 'var(--font-mono)', alignItems: 'center' }}>
          <EmbedDot status={doc.embedding_status} />
          <span>{doc.chunk_count} chunks</span>
          <span>{fmtSize(doc.content_length)}</span>
          <span style={{ flex: 1 }}>{fmtDate(doc.created_at)}</span>
          {(doc.embedding_status === 'failed' || doc.embedding_status === 'pending') && (
            <button
              onClick={handleReembed}
              disabled={reembed}
              title="Re-embed this document"
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

// ── Main page ─────────────────────────────────────────────────────────────

const PAGE = 25

export function DocumentsPage() {
  const { selectedId } = useProjectStore()
  const { toast }      = useToast()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const [docs,        setDocs]        = useState<DocMeta[]>([])
  const [total,       setTotal]       = useState(0)
  const [nextOffset,  setNextOffset]  = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [search,      setSearch]      = useState('')
  const [filters,     setFilters]     = useState<FilterState>(initialFilterState)
  const [selected,    setSelected]    = useState<string | null>(() => searchParams.get('open'))
  const [deleting,    setDeleting]    = useState<DocMeta | null>(null)

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkWorking,   setBulkWorking]   = useState(false)
  const [confirmBulkDel, setConfirmBulkDel] = useState(false)
  const [componentOptions, setComponentOptions] = useState<string[]>([])
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const refreshComponentOptions = useCallback(() => {
    documentsApi.components(selectedId ?? undefined).then(setComponentOptions).catch(() => {})
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
    if (!append) {
      setLoading(true)
      setSelectedIds(new Set())
    }
    else setLoadingMore(true)
    try {
      const result = await documentsApi.list({
        projectId:  selectedId ?? undefined,
        projectIds: selectedId ? undefined : (filters.projectIds.length > 0 ? filters.projectIds : undefined),
        fileType:   filters.fileType.length > 0 ? filters.fileType : undefined,
        tags:       filters.tags.length > 0 ? filters.tags : undefined,
        component:  filters.component.length > 0 ? filters.component : undefined,
        dateFrom:   filters.dateFrom || undefined,
        dateTo:     filters.dateTo || undefined,
        q:          search.trim() || undefined,
        limit:      PAGE,
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
  }, [load, search, filters, selectedId])

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

  async function handleBulkReembed() {
    setBulkWorking(true)
    try {
      await documentsApi.bulk([...selectedIds], 're-embed')
      toast(`Queued ${selectedIds.size} document${selectedIds.size !== 1 ? 's' : ''} for re-embedding`, 'success')
      setDocs(prev => prev.map(d => selectedIds.has(d.id) ? { ...d, embedding_status: 'processing' } : d))
      setSelectedIds(new Set())
    } catch {
      toast('Bulk re-embed failed', 'error')
    } finally {
      setBulkWorking(false)
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
      toast(`Deleted ${count} document${count !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk delete failed', 'error')
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
      toast(`Tagged ${selectedIds.size} document${selectedIds.size !== 1 ? 's' : ''}`, 'success')
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
      toast(`Set component on ${selectedIds.size} document${selectedIds.size !== 1 ? 's' : ''}`, 'success')
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

      <FilterBar entityType="documents" filters={filters} onChange={setFilters} />

      {/* Drop zone */}
      <DropZone
        projectId={selectedId ?? undefined}
        existingComponents={componentOptions}
        onDone={() => { load(0, false); refreshComponentOptions() }}
      />

      {/* Table + preview split */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', marginTop: 16 }}>
        {/* Table */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* Table header */}
          <div style={{ display: 'grid', gridTemplateColumns: '24px 32px 1fr 70px 80px 100px 80px', gap: 12, padding: '8px 18px', borderBottom: '1px solid var(--line)', fontSize: 10.5, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 1, alignItems: 'center' }}>
            <input
              type="checkbox"
              ref={headerCheckboxRef}
              checked={docs.length > 0 && selectedIds.size === docs.length}
              onChange={toggleSelectAll}
              style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
            />
            <span />
            <span>Title</span>
            <span>Type</span>
            <span>Chunks</span>
            <span>Size</span>
            <span>Date</span>
          </div>

          {loading && [1,2,3,4,5].map(i => <SkeletonRow key={i} cols={[14, 7, 220, 60, 70, 90, 70]} />)}

          {!loading && docs.length === 0 && (
            <div style={{ padding: '48px 18px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 28, color: 'var(--fg-4)' }}>📄</div>
              <div style={{ color: 'var(--fg-3)', fontSize: 13 }}>
                {search ? `No documents match "${search}".` : 'No documents yet.'}
              </div>
              {!search && <div style={{ color: 'var(--fg-4)', fontSize: 12 }}>Upload a PDF, DOCX, or Markdown file above, or import a URL.</div>}
            </div>
          )}

          {docs.map(doc => {
            const ts   = TYPE_STYLE[doc.file_type] ?? TYPE_STYLE.txt
            const isSel = selected === doc.id
            const isChecked = selectedIds.has(doc.id)
            return (
              <div
                key={doc.id}
                onClick={() => { const next = isSel ? null : doc.id; setSelected(next); setSearchParams(next ? { open: next } : {}, { replace: true }) }}
                className={`bulk-select-row ${isChecked ? 'bulk-select-row-selected' : ''} ${selectedIds.size > 0 ? 'bulk-select-has-selection' : ''}`}
                style={{
                  display: 'grid', gridTemplateColumns: '24px 32px 1fr 70px 80px 100px 80px',
                  gap: 12, padding: '9px 18px',
                  borderBottom: '1px solid var(--line)',
                  background: isSel ? 'var(--accent-dim)' : 'transparent',
                  cursor: 'default',
                  alignItems: 'center',
                }}
              >
                {/* Checkbox column */}
                <input
                  type="checkbox"
                  className="bulk-select-checkbox"
                  checked={isChecked}
                  onChange={e => {
                    e.stopPropagation()
                    toggleSelect(doc.id)
                  }}
                  onClick={e => e.stopPropagation()}
                  style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
                />

                {/* Project color dot */}
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: doc.project_color ?? 'var(--fg-4)', display: 'inline-block', margin: 'auto' }} />

                {/* Title */}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.title}</div>
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

                {/* Type badge */}
                <span style={{ height: 18, padding: '0 6px', borderRadius: 4, fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {ts.label}
                </span>

                {/* Chunk count + embedding status */}
                <span style={{ fontSize: 11.5, color: 'var(--fg-3)', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <EmbedDot status={doc.embedding_status} />
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
        {selected && (
          <PreviewPanel
            docId={selected}
            onClose={() => { setSelected(null); setSearchParams({}, { replace: true }) }}
            onReembedSuccess={(id, status) => setDocs(prev => prev.map(d => d.id === id ? { ...d, embedding_status: status } : d))}
            onNavigate={(route, id) => navigate(`${route}?open=${id}`)}
          />
        )}
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

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-elev-2)',
          border: '1px solid var(--accent-line)',
          borderRadius: 10,
          padding: '10px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
          zIndex: 100,
          animation: 'modal-in 0.15s ease',
        }}>
          <span style={{ fontSize: '12.5px', color: 'var(--fg-2)', fontWeight: 500, marginRight: 6 }}>
            {selectedIds.size} selected
          </span>

          <div style={{ display: 'flex', gap: 6 }}>
            {/* Tag Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                placeholder="Add tag..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleBulkTag(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 85, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            {/* Set Component Input — overwrites, doesn't append (single-select) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '2px 8px' }}>
              <input
                list="component-options"
                placeholder="Set component..."
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleBulkComponent(e.currentTarget.value)
                    e.currentTarget.value = ''
                  }
                }}
                style={{ fontSize: '11.5px', color: 'var(--fg)', width: 105, background: 'none', border: 'none', outline: 'none' }}
              />
            </div>

            {/* Re-embed button */}
            <button
              onClick={handleBulkReembed}
              disabled={bulkWorking}
              style={{
                fontSize: '11.5px',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: 'var(--fg)',
                transition: 'all 0.15s',
              }}
            >
              Re-embed
            </button>

            {/* Delete button with confirmation */}
            {!confirmBulkDel ? (
              <button
                onClick={() => setConfirmBulkDel(true)}
                disabled={bulkWorking}
                style={{
                  fontSize: '11.5px',
                  padding: '4px 12px',
                  borderRadius: 6,
                  border: '1px solid rgba(239,68,68,.4)',
                  background: 'rgba(239,68,68,.08)',
                  color: '#EF4444',
                  transition: 'all 0.15s',
                }}
              >
                Delete
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkWorking}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#EF4444',
                    color: 'white',
                    fontWeight: 500,
                  }}
                >
                  {bulkWorking ? 'Deleting...' : 'Confirm'}
                </button>
                <button
                  onClick={() => setConfirmBulkDel(false)}
                  style={{
                    fontSize: '11.5px',
                    padding: '4px 10px',
                    borderRadius: 6,
                    border: '1px solid var(--line)',
                    background: 'var(--bg-elev)',
                    color: 'var(--fg-3)',
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div style={{ width: '1px', height: 16, background: 'var(--line-2)', margin: '0 4px' }} />

          <button
            onClick={() => setSelectedIds(new Set())}
            style={{
              fontSize: '12px',
              color: 'var(--fg-3)',
              background: 'none',
              border: 'none',
              padding: '4px 8px',
              borderRadius: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--fg)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--fg-3)'}
          >
            Deselect all
          </button>
        </div>
      )}

    </>
  )
}

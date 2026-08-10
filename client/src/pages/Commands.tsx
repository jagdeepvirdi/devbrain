import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { commandsApi, type Command, type CommandInput, type CommandFacets } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { useToast } from '../components/Toast'
import { SkeletonRow } from '../components/Skeleton'
import { useHighlighter, langColor, SHIKI_STYLE } from '../components/commands/highlighter'
import { CommandCard } from '../components/commands/CommandCard'
import { CommandDetail } from '../components/commands/CommandDetail'
import { NewCommandModal } from '../components/commands/NewCommandModal'
import { CommandPalette } from '../components/commands/CommandPalette'

const CMD_PAGE = 25

function parseShellFile(text: string): { title: string; command: string }[] {
  const results: { title: string; command: string }[] = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i].trim()
    // Skip shebang and blank lines
    if (line.startsWith('#!') || line === '') { i++; continue }
    if (line.startsWith('#')) {
      const title = line.replace(/^#+\s*/, '').trim()
      i++
      const cmdLines: string[] = []
      while (i < lines.length) {
        const cl = lines[i]
        if (cl.trim() === '' || cl.trim().startsWith('#')) break
        cmdLines.push(cl)
        i++
      }
      if (cmdLines.length > 0 && title) {
        results.push({ title, command: cmdLines.join('\n').trimEnd() })
      }
    } else {
      i++
    }
  }
  return results
}

export function CommandsPage() {
  const hl = useHighlighter()
  const { selectedProject } = useProjectStore()
  const { toast } = useToast()
  const proj = selectedProject()
  const [searchParams, setSearchParams] = useSearchParams()

  const [commands,      setCommands]      = useState<Command[]>([])
  const [total,         setTotal]         = useState(0)
  const [nextOffset,    setNextOffset]    = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [loadingMore,   setLoadingMore]   = useState(false)
  const [selectedId,    setSelectedId]    = useState<string | null>(searchParams.get('open'))
  const [search,        setSearch]        = useState('')
  const [langFilter,    setLangFilter]    = useState<string | null>(null)
  const [tagFilter,     setTagFilter]     = useState<string | null>(null)
  const [favFilter,     setFavFilter]     = useState(false)
  const [nsFilter,      setNsFilter]      = useState<'all' | 'personal' | 'team'>('all')
  const [facets,        setFacets]        = useState<CommandFacets>({ languages: [], tags: [] })
  const [showNew,       setShowNew]       = useState(false)
  const [paletteOpen,   setPaletteOpen]   = useState(false)
  const [importing,     setImporting]     = useState(false)
  const importRef = useRef<HTMLInputElement>(null)
  const loadAbortRef = useRef<AbortController | null>(null)

  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [bulkWorking,   setBulkWorking]   = useState(false)
  const [confirmBulkDel, setConfirmBulkDel] = useState(false)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => prev.size === commands.length ? new Set() : new Set(commands.map(c => c.id)))
  }, [commands])

  async function handleBulkFavorite(favorite: boolean) {
    setBulkWorking(true)
    try {
      await commandsApi.bulk([...selectedIds], 'favorite', favorite ? 'true' : 'false')
      setCommands(prev => prev.map(c => selectedIds.has(c.id) ? { ...c, is_favorite: favorite } : c))
      toast(`Updated ${selectedIds.size} command${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk update failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkDelete() {
    setBulkWorking(true)
    try {
      await commandsApi.bulk([...selectedIds], 'delete')
      const count = selectedIds.size
      setCommands(prev => prev.filter(c => !selectedIds.has(c.id)))
      setTotal(t => t - count)
      if (selectedId && selectedIds.has(selectedId)) selectCommand(null)
      toast(`Deleted ${count} command${count !== 1 ? 's' : ''}`, 'success')
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
      await commandsApi.bulk([...selectedIds], 'tag', tag.trim())
      setCommands(prev => prev.map(c => {
        if (selectedIds.has(c.id)) {
          const newTags = c.tags.includes(tag.trim()) ? c.tags : [...c.tags, tag.trim()]
          return { ...c, tags: newTags }
        }
        return c
      }))
      toast(`Tagged ${selectedIds.size} command${selectedIds.size !== 1 ? 's' : ''}`, 'success')
      setSelectedIds(new Set())
    } catch {
      toast('Bulk tagging failed', 'error')
    } finally {
      setBulkWorking(false)
    }
  }

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = selectedIds.size > 0 && selectedIds.size < commands.length
    }
  }, [selectedIds, commands])

  // Inject Shiki CSS once
  useEffect(() => {
    const id = 'shiki-style'
    if (!document.getElementById(id)) {
      const style = document.createElement('style')
      style.id = id
      style.textContent = SHIKI_STYLE
      document.head.appendChild(style)
    }
  }, [])

  const load = useCallback(async (offset: number, append: boolean) => {
    if (!append) {
      loadAbortRef.current?.abort()
      loadAbortRef.current = new AbortController()
      setLoading(true)
      setSelectedIds(new Set())
    } else {
      setLoadingMore(true)
    }
    const signal = !append ? loadAbortRef.current?.signal : undefined
    try {
      const result = await commandsApi.list({
        projectId: proj?.id,
        search:    search || undefined,
        language:  langFilter ?? undefined,
        tag:       tagFilter ?? undefined,
        favorite:  favFilter || undefined,
        namespace: nsFilter !== 'all' ? nsFilter : undefined,
        limit:     CMD_PAGE,
        offset,
        signal,
      })
      setTotal(result.total)
      setCommands(prev => append ? [...prev, ...result.items] : result.items)
      setNextOffset(offset + result.items.length)
      setLoading(false)
      setLoadingMore(false)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      if (!append) setCommands([])
      setLoading(false)
      setLoadingMore(false)
    }
  }, [proj?.id, search, langFilter, tagFilter, favFilter, nsFilter])

  useEffect(() => { load(0, false) }, [load])

  // Filter chip options: languages + tags across the FULL project/namespace
  // scope, not just the currently loaded page — otherwise chips for
  // less-common languages/tags would only appear once you'd scrolled far
  // enough to load a page containing one.
  useEffect(() => {
    let cancelled = false
    commandsApi.facets({ projectId: proj?.id, namespace: nsFilter !== 'all' ? nsFilter : undefined })
      .then(f => { if (!cancelled) setFacets(f) })
      .catch(() => { if (!cancelled) setFacets({ languages: [], tags: [] }) })
    return () => { cancelled = true }
  }, [proj?.id, nsFilter])

  // Debounce search
  const [searchInput, setSearchInput] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function handleSearchChange(v: string) {
    setSearchInput(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => setSearch(v), 250)
  }

  const selected = useMemo(
    () => commands.find(c => c.id === selectedId) ?? null,
    [commands, selectedId]
  )

  const handleUpdate = useCallback(async (id: string, updates: Partial<CommandInput>) => {
    const updated = await commandsApi.update(id, updates)
    setCommands(prev => prev.map(c => c.id === id ? updated : c))
  }, [])

  // Keep ?open= URL param in sync with selected command
  const selectCommand = useCallback((id: string | null) => {
    setSelectedId(id)
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (id) next.set('open', id)
      else next.delete('open')
      return next
    }, { replace: true })
  }, [setSearchParams])

  const handleDelete = useCallback((id: string) => {
    commandsApi.remove(id).then(() => {
      setCommands(prev => prev.filter(c => c.id !== id))
      selectCommand(null)
    })
  }, [selectCommand])

  const handleFavToggle = useCallback((e: React.MouseEvent, cmd: Command) => {
    e.stopPropagation()
    commandsApi.update(cmd.id, { is_favorite: !cmd.is_favorite }).then(updated => {
      setCommands(prev => prev.map(c => c.id === cmd.id ? updated : c))
    })
  }, [])

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const text = await file.text()
      const parsed = parseShellFile(text)
      if (parsed.length === 0) { toast('No parseable commands found (need # comment before each command)', 'error'); return }
      let created = 0
      for (const { title, command } of parsed) {
        await commandsApi.create({ title, command, language: 'bash', description: '', tags: [], is_favorite: false, namespace: 'team', project_id: proj?.id ?? null })
        created++
      }
      load(0, false)
      toast(`Imported ${created} command${created !== 1 ? 's' : ''}`, 'success')
    } catch {
      toast('Import failed', 'error')
    } finally {
      setImporting(false)
    }
  }

  // Keyboard shortcut: N = new command
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Commands</h1>
        {proj && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: proj.color }} />
            {proj.name}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <button onClick={() => setPaletteOpen(true)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 10px', borderRadius: 5, fontSize: '12px',
            border: '1px solid var(--line-2)', background: 'var(--bg-elev)',
            color: 'var(--fg-3)', cursor: 'default',
          }}>
            <span style={{ opacity: .6 }}>⌘</span> Quick copy
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '10px', padding: '0 4px', border: '1px solid var(--line-2)', borderRadius: 3 }}>Ctrl+K</span>
          </button>
          <button
            onClick={() => importRef.current?.click()}
            disabled={importing}
            title="Import commands from a shell file (.sh, .bash, .zshrc)"
            style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px', cursor: 'default', opacity: importing ? 0.6 : 1 }}
          >
            {importing ? 'Importing…' : '↑ Import'}
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".sh,.bash,.zshrc,.bashrc,.zsh,.profile"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button onClick={() => setShowNew(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
            + New
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: list */}
        <div style={{ width: 300, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0 }}>
          {/* Search */}
          <div style={{ padding: '10px 10px 6px' }}>
            <input
              value={searchInput}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="Search…"
              style={{ width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '6px 10px', color: 'var(--fg)', fontSize: '12.5px', boxSizing: 'border-box', outline: 'none' }}
            />
          </div>

          {/* Filters */}
          <div style={{ padding: '0 10px 4px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <button onClick={() => { setFavFilter(false); setLangFilter(null); setTagFilter(null); setNsFilter('all') }} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--line)', background: !favFilter && !langFilter && !tagFilter && nsFilter === 'all' ? 'var(--bg-elev-2)' : 'transparent', color: !favFilter && !langFilter && !tagFilter && nsFilter === 'all' ? 'var(--fg)' : 'var(--fg-3)', cursor: 'default' }}>
              All
            </button>
            <button onClick={() => { setFavFilter(v => !v); setLangFilter(null); setTagFilter(null) }} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: '1px solid var(--line)', background: favFilter ? '#F59E0B20' : 'transparent', color: favFilter ? '#F59E0B' : 'var(--fg-3)', cursor: 'default' }}>
              ★ Favorites
            </button>
            <button onClick={() => setNsFilter(v => v === 'team' ? 'all' : 'team')} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: `1px solid ${nsFilter === 'team' ? 'rgba(99,102,241,.5)' : 'var(--line)'}`, background: nsFilter === 'team' ? 'rgba(99,102,241,.15)' : 'transparent', color: nsFilter === 'team' ? 'var(--accent-2)' : 'var(--fg-3)', cursor: 'default' }}>
              👥 Team
            </button>
            <button onClick={() => setNsFilter(v => v === 'personal' ? 'all' : 'personal')} style={{ fontSize: '11px', padding: '2px 8px', borderRadius: 10, border: `1px solid ${nsFilter === 'personal' ? 'rgba(99,102,241,.5)' : 'var(--line)'}`, background: nsFilter === 'personal' ? 'rgba(99,102,241,.15)' : 'transparent', color: nsFilter === 'personal' ? 'var(--accent-2)' : 'var(--fg-3)', cursor: 'default' }}>
              🔒 Personal
            </button>
            {facets.languages.map(({ value: l, count }) => (
              <button key={l} onClick={() => setLangFilter(langFilter === l ? null : l)} title={`${count} command${count !== 1 ? 's' : ''}`} style={{
                fontSize: '11px', padding: '2px 8px', borderRadius: 10,
                border: `1px solid ${langFilter === l ? langColor(l) + '60' : 'var(--line)'}`,
                background: langFilter === l ? langColor(l) + '20' : 'transparent',
                color: langFilter === l ? langColor(l) : 'var(--fg-3)', cursor: 'default',
              }}>
                {l} <span style={{ opacity: .55 }}>{count}</span>
              </button>
            ))}
          </div>

          {/* Tags — capped + independently scrollable so a project with many
              distinct tags can't push the command list itself out of view
              (the sidebar column is overflow:hidden, so unbounded chip wrap
              would otherwise squeeze the list's flex:1 region to nothing). */}
          {facets.tags.length > 0 && (
            <div style={{ padding: '0 10px 8px', display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', marginBottom: 4, maxHeight: 88, overflowY: 'auto', flexShrink: 0 }}>
              {facets.tags.map(({ value: t, count }) => (
                <button key={t} onClick={() => setTagFilter(tagFilter === t ? null : t)} title={`${count} command${count !== 1 ? 's' : ''}`} style={{
                  fontSize: '10.5px', padding: '2px 7px', borderRadius: 10, marginBottom: 6,
                  border: `1px solid ${tagFilter === t ? 'rgba(99,102,241,.5)' : 'var(--line)'}`,
                  background: tagFilter === t ? 'rgba(99,102,241,.15)' : 'var(--bg-elev)',
                  color: tagFilter === t ? 'var(--accent-2)' : 'var(--fg-4)', cursor: 'default',
                }}>
                  #{t} <span style={{ opacity: .55 }}>{count}</span>
                </button>
              ))}
            </div>
          )}

          {/* List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 8px' }}>
            {/* List header select all */}
            {!loading && commands.length > 0 && (
              <div style={{ padding: '6px 14px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-elev-2)', margin: '0 6px 6px', borderRadius: 6 }}>
                <input
                  type="checkbox"
                  ref={headerCheckboxRef}
                  checked={commands.length > 0 && selectedIds.size === commands.length}
                  onChange={toggleSelectAll}
                  style={{ accentColor: 'var(--accent)', cursor: 'default', width: 14, height: 14 }}
                />
                <span style={{ fontSize: '11px', color: 'var(--fg-3)', fontWeight: 500 }}>
                  Select all
                </span>
              </div>
            )}

            {loading
              ? [1,2,3,4,5].map(i => <SkeletonRow key={i} cols={[140, 80, 50]} />)
              : commands.length === 0
                ? <div style={{ padding: '28px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 38, height: 38, borderRadius: 8, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: 18, color: 'var(--fg-4)' }}>&gt;_</div>
                    <div style={{ fontSize: '12px', color: 'var(--fg-3)' }}>
                      {search
                        ? `No commands matching "${search}"`
                        : (langFilter || tagFilter)
                          ? `No commands match the selected filter${langFilter && tagFilter ? 's' : ''}`
                          : 'No commands yet'}
                    </div>
                    {!search && !langFilter && !tagFilter && (
                      <button onClick={() => setShowNew(true)} style={{ fontSize: '11.5px', padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent-dim)', color: 'var(--accent-2)' }}>
                        + Create your first command
                      </button>
                    )}
                  </div>
                : commands.map(cmd => (
                    <CommandCard
                      key={cmd.id}
                      cmd={cmd}
                      selected={cmd.id === selectedId}
                      onClick={() => selectCommand(cmd.id)}
                      onFavToggle={e => handleFavToggle(e, cmd)}
                      isChecked={selectedIds.has(cmd.id)}
                      onToggleSelect={toggleSelect}
                      hasSelection={selectedIds.size > 0}
                    />
                  ))
            }
            {!loading && commands.length < total && (
              <div style={{ padding: '8px', textAlign: 'center' }}>
                <button
                  onClick={() => load(nextOffset, true)}
                  disabled={loadingMore}
                  style={{ height: 24, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: 11.5, opacity: loadingMore ? 0.6 : 1 }}
                >
                  {loadingMore ? 'Loading…' : `+${total - commands.length} more`}
                </button>
              </div>
            )}
          </div>

          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: '11px', color: 'var(--fg-4)' }}>
            {total} command{total !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Right: detail */}
        {selected
          ? <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <CommandDetail
                key={selected.id}
                cmd={selected}
                hl={hl}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            </div>
          : <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: 'var(--fg-3)' }}>
              <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: '18px' }}>
                &gt;_
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-3)' }}>
                {commands.length > 0 ? 'Select a command to view it' : 'No commands yet — create one'}
              </p>
            </div>
        }
      </div>

      {showNew && (
        <NewCommandModal
          onClose={() => setShowNew(false)}
          onCreate={cmd => { setCommands(prev => [cmd, ...prev]); setSelectedId(cmd.id); setShowNew(false) }}
        />
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}

      {/* Floating Action Bar */}
      {selectedIds.size > 0 && (
        <div style={{
          position: 'absolute',
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

            {/* Favorite toggle */}
            <button
              onClick={() => handleBulkFavorite(true)}
              disabled={bulkWorking}
              style={{
                fontSize: '11.5px',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: '#F59E0B',
                transition: 'all 0.15s',
              }}
            >
              ★ Favorite
            </button>
            <button
              onClick={() => handleBulkFavorite(false)}
              disabled={bulkWorking}
              style={{
                fontSize: '11.5px',
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid var(--line)',
                background: 'var(--bg-elev)',
                color: 'var(--fg-3)',
                transition: 'all 0.15s',
              }}
            >
              ☆ Unfavorite
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
    </div>
  )
}

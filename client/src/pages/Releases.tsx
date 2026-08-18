import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { releasesApi, type Release, type ReleaseInput } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { ReleaseModal } from '../components/releases/ReleaseModal'
import { ReleaseCard } from '../components/releases/ReleaseCard'
import { ReleaseTable } from '../components/releases/ReleaseTable'
import { ImportGitModal } from '../components/releases/ImportGitModal'
import { CompareModal } from '../components/releases/CompareModal'
import { DraftAiModal } from '../components/releases/DraftAiModal'
import { typeStyle } from '../components/releases/shared'

// ── ReleasesPage ─────────────────────────────────────────────────────────────

export function ReleasesPage() {
  const { selectedProject } = useProjectStore()
  const proj = selectedProject()
  const [searchParams] = useSearchParams()

  const [releases,      setReleases]      = useState<Release[]>([])
  const [loading,       setLoading]       = useState(true)
  const [showNew,       setShowNew]       = useState(false)
  const [editing,       setEditing]       = useState<Release | null>(null)
  const [showCompare,   setShowCompare]   = useState(false)
  const [showImportGit, setShowImportGit] = useState(false)
  const [showDraftAi,   setShowDraftAi]   = useState(false)
  const [draftInitial,  setDraftInitial]  = useState<Partial<ReleaseInput> | undefined>()
  const [view,          setView]          = useState<'timeline' | 'table'>('timeline')
  const [exporting,     setExporting]     = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await releasesApi.list({ projectId: proj?.id })
      setReleases(data)
    } catch { setReleases([]) }
    finally { setLoading(false) }
  }, [proj?.id])

  useEffect(() => { load() }, [load])

  // Deep-link support (?open=<id>) — if the linked release isn't in the
  // current project-scoped list (linked from a different project), fetch it
  // directly and prepend it so it's still visible; then scroll to its card.
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || loading) return

    const scrollTo = () => document.getElementById(`release-${openId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })

    if (releases.some(r => r.id === openId)) {
      scrollTo()
      return
    }
    releasesApi.get(openId)
      .then(r => { setReleases(prev => prev.some(x => x.id === r.id) ? prev : [r, ...prev]); setTimeout(scrollTo, 50) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading])

  function handleSave(r: Release) {
    setReleases(prev => {
      const idx = prev.findIndex(x => x.id === r.id)
      if (idx >= 0) { const next = [...prev]; next[idx] = r; return next }
      return [r, ...prev]
    })
    setShowNew(false)
    setEditing(null)
  }

  function handleDelete(id: string) {
    releasesApi.remove(id).then(() => setReleases(prev => prev.filter(r => r.id !== id)))
  }

  async function handleExport() {
    setExporting(true)
    try {
      await releasesApi.export({ projectId: proj?.id })
    } catch {
      // best-effort — no toast wiring here, matches the rest of this page's error handling for now
    } finally {
      setExporting(false)
    }
  }

  // Summary stats
  const stats = {
    total:    releases.length,
    major:    releases.filter(r => r.type === 'major').length,
    minor:    releases.filter(r => r.type === 'minor').length,
    patch:    releases.filter(r => r.type === 'patch').length,
    hotfix:   releases.filter(r => r.type === 'hotfix').length,
    features: releases.reduce((s, r) => s + r.features.length, 0),
    fixes:    releases.reduce((s, r) => s + r.fixes.length, 0),
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Releases</h1>
        {proj && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '11.5px', color: 'var(--fg-3)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: proj.color }} />
            {proj.name}
          </span>
        )}

        {/* Stats */}
        {!loading && releases.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginLeft: 8 }}>
            {[
              { label: 'major',  count: stats.major,  ts: typeStyle('major') },
              { label: 'minor',  count: stats.minor,  ts: typeStyle('minor') },
              { label: 'patch',  count: stats.patch,  ts: typeStyle('patch') },
              { label: 'hotfix', count: stats.hotfix, ts: typeStyle('hotfix') },
            ].filter(s => s.count > 0).map(s => (
              <span key={s.label} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: 10, background: s.ts.bg, color: s.ts.text, border: `1px solid ${s.ts.border}` }}>
                {s.count} {s.label}
              </span>
            ))}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 5, overflow: 'hidden' }}>
            {(['timeline', 'table'] as const).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: '5px 10px', fontSize: '12px', cursor: 'default',
                  border: 'none', background: view === v ? 'var(--accent-dim)' : 'none',
                  color: view === v ? 'var(--accent-2)' : 'var(--fg-3)',
                }}
              >
                {v === 'timeline' ? '☰ Timeline' : '▦ Table'}
              </button>
            ))}
          </div>

          {releases.length > 0 && (
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Download the current view as an .xlsx file"
              style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '12px', cursor: exporting ? 'not-allowed' : 'default', opacity: exporting ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: 5 }}
            >
              ⇩ {exporting ? 'Exporting…' : 'Export'}
            </button>
          )}

          {releases.length >= 2 && (
            <button onClick={() => setShowCompare(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 9, color: 'var(--accent-2)' }}>◆</span> Compare
            </button>
          )}
          <button onClick={() => setShowImportGit(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 9, color: 'var(--accent-2)' }}>◆</span> Import
          </button>
          {proj && (
            <button onClick={() => setShowDraftAi(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent-line)', background: 'var(--accent-dim)', color: 'var(--accent-2)', fontSize: '12px', cursor: 'default', display: 'flex', alignItems: 'center', gap: 5 }}>
              ✦ Draft with AI
            </button>
          )}
          <button onClick={() => setShowNew(true)} style={{ padding: '5px 12px', borderRadius: 5, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: '12px', cursor: 'default' }}>
            + New Release
          </button>
        </div>
      </div>

      {/* Timeline */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 40px' }}>
        {loading
          ? <div style={{ textAlign: 'center', padding: 40, fontSize: '13px', color: 'var(--fg-3)' }}>Loading…</div>
          : releases.length === 0
            ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '60px 0', color: 'var(--fg-3)' }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--bg-elev)', border: '1px solid var(--line)', display: 'grid', placeItems: 'center', fontSize: '20px' }}>
                  🏷
                </div>
                <p style={{ margin: 0, fontSize: '13px' }}>
                  No releases yet
                  {proj ? ` for ${proj.name}` : ''} — <span onClick={() => setShowNew(true)} style={{ color: 'var(--accent-2)', cursor: 'default', textDecoration: 'underline' }}>create one</span>
                </p>
              </div>
            : view === 'table' ? (
              <div>
                <ReleaseTable
                  releases={releases}
                  showProject={!proj}
                  onEdit={r => setEditing(r)}
                  onDelete={handleDelete}
                />

                {/* Stats footer */}
                <div style={{ marginTop: 16, padding: '10px 14px', borderRadius: 7, background: 'var(--bg-elev)', border: '1px solid var(--line)', fontSize: '12px', color: 'var(--fg-3)', display: 'flex', gap: 20 }}>
                  <span>{stats.total} releases</span>
                  <span>✦ {stats.features} features shipped</span>
                  <span>○ {stats.fixes} fixes</span>
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 780 }}>
                {/* Top cap for timeline */}
                <div style={{ display: 'flex', gap: 0, marginBottom: 0 }}>
                  <div style={{ width: 28, position: 'relative', flexShrink: 0 }}>
                    <div style={{ position: 'absolute', left: '50%', top: 0, height: 14, width: 2, background: 'var(--line)', transform: 'translateX(-50%)' }} />
                  </div>
                  <div style={{ flex: 1 }} />
                </div>

                {releases.map(r => (
                  <ReleaseCard
                    key={r.id}
                    release={r}
                    onEdit={() => setEditing(r)}
                    onDelete={() => handleDelete(r.id)}
                  />
                ))}

                {/* Stats footer */}
                <div style={{ marginTop: 16, marginLeft: 42, padding: '10px 14px', borderRadius: 7, background: 'var(--bg-elev)', border: '1px solid var(--line)', fontSize: '12px', color: 'var(--fg-3)', display: 'flex', gap: 20 }}>
                  <span>{stats.total} releases</span>
                  <span>✦ {stats.features} features shipped</span>
                  <span>○ {stats.fixes} fixes</span>
                </div>
              </div>
            )
        }
      </div>

      {showNew && (
        <ReleaseModal
          initial={draftInitial ?? (proj ? { project_id: proj.id } : undefined)}
          onClose={() => { setShowNew(false); setDraftInitial(undefined) }}
          onSave={handleSave}
        />
      )}
      {editing && (
        <ReleaseModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}
      {showCompare && (
        <CompareModal
          releases={releases}
          onClose={() => setShowCompare(false)}
        />
      )}
      {showImportGit && (
        <ImportGitModal
          onClose={() => setShowImportGit(false)}
          onImported={r => { handleSave(r); setShowImportGit(false) }}
        />
      )}
      {showDraftAi && proj && (
        <DraftAiModal
          projectId={proj.id}
          onClose={() => setShowDraftAi(false)}
          onDraft={draft => {
            setDraftInitial(draft)
            setShowDraftAi(false)
            setShowNew(true)
          }}
        />
      )}
    </div>
  )
}

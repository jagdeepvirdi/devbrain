import { useState, useEffect } from 'react'
import { releasesApi, gitApi, type Release, type ReleaseInput } from '../../lib/api'
import { useProjectStore } from '../../store/projectStore'
import { today } from './shared'

// ── ImportGitModal ────────────────────────────────────────────────────────────

export function ImportGitModal({ onClose, onImported }: { onClose: () => void; onImported: (r: Release) => void }) {
  const { projects, selectedProject } = useProjectStore()
  const proj = selectedProject()

  const [projectId, setProjectId] = useState(proj?.id ?? projects[0]?.id ?? '')
  const [version,   setVersion]   = useState('')
  const [date,      setDate]      = useState(today())
  const [type,      setType]      = useState<ReleaseInput['type']>('patch')
  const [commits,    setCommits]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [ghBase,     setGhBase]     = useState('')
  const [ghHead,     setGhHead]     = useState('HEAD')
  const [fetching,   setFetching]   = useState(false)

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg-elev)', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 10px', color: 'var(--fg)', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }
  const lbl: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', display: 'block', marginBottom: 5 }

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function handleFetchFromGitHub() {
    if (!projectId || !ghBase.trim()) { setError('Select project and enter base ref'); return }
    setFetching(true); setError('')
    try {
      const { commits: log } = await gitApi.compare(projectId, ghBase.trim(), ghHead.trim() || 'HEAD')
      setCommits(log)
    } catch (e) { setError((e as Error).message) }
    finally { setFetching(false) }
  }

  async function handleImport() {
    if (!commits.trim())  { setError('Commit messages are required'); return }
    if (!version.trim())  { setError('Version is required'); return }
    if (!projectId)       { setError('Project is required'); return }
    setLoading(true); setError('')
    try {
      const release = await releasesApi.importGit({ commits, project_id: projectId, version: version.trim(), date, type })
      onImported(release)
    } catch (e) {
      setError((e as Error).message)
      setLoading(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, backdropFilter: 'blur(4px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 560, maxHeight: '88vh', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 24px 60px rgba(0,0,0,.5)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontSize: 10, color: 'var(--accent-2)' }}>◆</span> Import from git log
          </span>
          <button onClick={onClose} style={{ width: 24, height: 24, display: 'grid', placeItems: 'center', borderRadius: 4, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-3)', cursor: 'default', fontSize: 14 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 18px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Version / Date / Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={lbl}>Version *</label>
              <input value={version} onChange={e => setVersion(e.target.value)} placeholder="v1.2.3" style={inp} />
            </div>
            <div>
              <label style={lbl}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...inp, cursor: 'default' }} />
            </div>
            <div>
              <label style={lbl}>Type</label>
              <select value={type} onChange={e => setType(e.target.value as ReleaseInput['type'])} style={{ ...inp, cursor: 'default' }}>
                <option value="patch">patch</option>
                <option value="minor">minor</option>
                <option value="major">major</option>
                <option value="hotfix">hotfix</option>
              </select>
            </div>
          </div>

          {/* Project (only in all-projects view) */}
          {!proj && (
            <div>
              <label style={lbl}>Project *</label>
              <select value={projectId} onChange={e => setProjectId(e.target.value)} style={{ ...inp, cursor: 'default' }}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}

          {/* Fetch from GitHub */}
          {projectId && (
            <div style={{ padding: '10px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--bg)' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
                Fetch from GitHub
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input value={ghBase} onChange={e => setGhBase(e.target.value)} placeholder="Base (e.g. v1.0.0 or a SHA)" style={{ ...inp, flex: 1, minWidth: 120 }} />
                <span style={{ fontSize: 12, color: 'var(--fg-4)', flexShrink: 0 }}>→</span>
                <input value={ghHead} onChange={e => setGhHead(e.target.value)} placeholder="Head (default: HEAD)" style={{ ...inp, flex: 1, minWidth: 120 }} />
                <button onClick={handleFetchFromGitHub} disabled={fetching || !ghBase.trim()} style={{ padding: '6px 10px', borderRadius: 5, border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px', cursor: fetching ? 'not-allowed' : 'default', opacity: fetching || !ghBase.trim() ? 0.5 : 1, whiteSpace: 'nowrap' }}>
                  {fetching ? 'Fetching…' : 'Fetch commits'}
                </button>
              </div>
            </div>
          )}

          {/* Commits */}
          <div>
            <label style={lbl}>Git log / commit messages *</label>
            <textarea
              value={commits}
              onChange={e => setCommits(e.target.value)}
              rows={7}
              placeholder={'Paste git log output or commit messages:\n\nfeat: add Q&A endpoint for releases\nfix: fix pagination on issues list\nchore: update dependencies\nrefactor: unify AI client across routes'}
              style={{ ...inp, resize: 'vertical', lineHeight: 1.55, fontFamily: 'var(--font-mono)', fontSize: '12px' }}
            />
            <div style={{ fontSize: '11px', color: 'var(--fg-4)', marginTop: 4 }}>
              Supports any format — <code style={{ fontFamily: 'var(--font-mono)' }}>git log --oneline</code> or <code style={{ fontFamily: 'var(--font-mono)' }}>git log --pretty=format:"%h %s"</code>
            </div>
          </div>

          {error && <span style={{ fontSize: '12px', color: '#EF4444' }}>{error}</span>}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--line)', display: 'flex', gap: 8, justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--line)', background: 'none', color: 'var(--fg-2)', fontSize: '13px', cursor: 'default' }}>Cancel</button>
          <button
            onClick={handleImport}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 6,
              border: '1px solid var(--accent)', background: loading ? 'var(--bg-elev)' : 'var(--accent)',
              color: loading ? 'var(--fg-4)' : 'white', fontSize: '13px',
              cursor: loading ? 'not-allowed' : 'default', fontWeight: 500,
              display: 'flex', alignItems: 'center', gap: 6, opacity: loading ? 0.7 : 1,
            }}
          >
            <span style={{ fontSize: 9 }}>◆</span>
            {loading ? 'Importing…' : 'Import Release'}
          </button>
        </div>
      </div>
    </div>
  )
}

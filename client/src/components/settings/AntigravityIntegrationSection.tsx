import { useState, useEffect } from 'react'
import { settingsApi, projectsApi, antigravityProjectsApi, type ScanCandidate, type Project } from '../../lib/api'
import { useToast } from '../Toast'
import { CandidateRow } from './CandidateRow'

export function AntigravityIntegrationSection() {
  const { toast }                         = useToast()
  const [scanRoot,     setScanRoot]       = useState('')
  const [savedRoot,    setSavedRoot]      = useState<string | null>(null)
  const [rootLoading,  setRootLoading]    = useState(true)
  const [rootSaving,   setRootSaving]     = useState(false)
  const [scanning,     setScanning]       = useState(false)
  const [candidates,   setCandidates]     = useState<ScanCandidate[] | null>(null)
  const [scanError,    setScanError]      = useState<string | null>(null)
  const [projects,     setProjects]       = useState<Project[]>([])
  const [linked,       setLinked]         = useState<Set<string>>(new Set())

  useEffect(() => {
    settingsApi.getAntigravitySettings()
      .then(d => { setScanRoot(d.scan_root ?? ''); setSavedRoot(d.scan_root) })
      .catch(() => {})
      .finally(() => setRootLoading(false))

    projectsApi.list().then(setProjects).catch(() => {})
  }, [])

  async function handleSaveRoot(e: React.FormEvent) {
    e.preventDefault()
    setRootSaving(true)
    try {
      const val = scanRoot.trim() || null
      await settingsApi.saveAntigravitySettings(val)
      setSavedRoot(val)
      toast('Scan root saved')
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setRootSaving(false)
    }
  }

  async function handleScan() {
    setScanning(true)
    setScanError(null)
    setCandidates(null)
    setLinked(new Set())
    try {
      const result = await antigravityProjectsApi.scan()
      setCandidates(result.candidates)
      if (result.candidates.length === 0) {
        toast('Scan complete — no Antigravity projects found')
      } else {
        toast(`Found ${result.candidates.length} project${result.candidates.length !== 1 ? 's' : ''}`)
      }
    } catch (err) {
      setScanError((err as Error).message)
    } finally {
      setScanning(false)
    }
  }

  function handleLinked(path: string) {
    setLinked(prev => new Set([...prev, path]))
    // Refresh projects list so actions stay accurate
    projectsApi.list().then(setProjects).catch(() => {})
  }

  const inp: React.CSSProperties = {
    flex: 1, background: 'var(--bg)', border: '1px solid var(--line-2)',
    borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5,
    boxSizing: 'border-box', outline: 'none',
  }

  const visibleCandidates = candidates?.filter(c => !linked.has(c.path)) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Scan root */}
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', marginBottom: 6 }}>Scan root</div>
        <div style={{ fontSize: 12, color: 'var(--fg-4)', marginBottom: 8 }}>
          Root folder to scan for Gemini/Antigravity projects. Searches up to 3 levels deep for folders containing <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>ANTIGRAVITY.md</code>, <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>TASKS.md</code>, or <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>sessions/</code>.
        </div>
        {rootLoading ? (
          <div style={{ fontSize: 12, color: 'var(--fg-4)' }}>Loading…</div>
        ) : (
          <form onSubmit={handleSaveRoot} style={{ display: 'flex', gap: 8 }}>
            <input
              value={scanRoot}
              onChange={e => setScanRoot(e.target.value)}
              placeholder="e.g. C:\Users\you\Projects"
              style={inp}
            />
            <button
              type="submit"
              disabled={rootSaving || scanRoot.trim() === (savedRoot ?? '')}
              style={{ height: 30, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: rootSaving ? 0.6 : 1, whiteSpace: 'nowrap', cursor: 'default' }}
            >
              {rootSaving ? 'Saving…' : 'Save'}
            </button>
          </form>
        )}
      </div>

      {/* Scan button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          onClick={handleScan}
          disabled={scanning || !savedRoot}
          title={!savedRoot ? 'Save a scan root first' : undefined}
          style={{ height: 30, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid rgba(99,102,241,.4)', background: 'rgba(99,102,241,.12)', color: '#818CF8', fontSize: 12.5, opacity: (scanning || !savedRoot) ? 0.5 : 1, cursor: (scanning || !savedRoot) ? 'default' : 'pointer' }}
        >
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
        {savedRoot && (
          <span style={{ fontSize: 11.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{savedRoot}</span>
        )}
      </div>

      {/* Error */}
      {scanError && (
        <div style={{ fontSize: 12.5, color: '#F8A8A8', padding: '8px 12px', borderRadius: 6, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)' }}>
          {scanError}
        </div>
      )}

      {/* Results */}
      {candidates !== null && visibleCandidates.length === 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--fg-4)', padding: '10px 0' }}>
          {candidates.length === 0 ? 'No Antigravity projects found under the scan root.' : 'All discovered projects have been linked.'}
        </div>
      )}

      {visibleCandidates.length > 0 && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--line)' }}>
                {['Path', 'Detected name', 'Last session', 'Tasks', 'Suggested match', 'Action'].map(h => (
                  <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10.5, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleCandidates.map(c => (
                <CandidateRow
                  key={c.path}
                  candidate={c}
                  projects={projects}
                  onLinked={handleLinked}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { settingsApi, type Project } from '../../lib/api'
import { useToast } from '../Toast'

export function ExportSection({ projects }: { projects: Project[] }) {
  const { toast } = useToast()
  const [exportingId,  setExportingId]  = useState<string | null>(null)
  const [exportingAll, setExportingAll] = useState(false)
  const [selectedId,   setSelectedId]   = useState<string>('')

  const inp: React.CSSProperties = { background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '5px 8px', color: 'var(--fg)', fontSize: 12.5, outline: 'none' }

  async function handleExportProject() {
    if (!selectedId) return
    setExportingId(selectedId)
    try {
      const p = projects.find(x => x.id === selectedId)!
      await settingsApi.exportProject(selectedId, p.short_name)
      toast(`Exported ${p.name}`)
    } catch { toast('Export failed', 'error') }
    finally { setExportingId(null) }
  }

  async function handleExportAll() {
    setExportingAll(true)
    try { await settingsApi.exportAll(); toast('Full export downloaded') }
    catch { toast('Export failed', 'error') }
    finally { setExportingAll(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 4 }}>Project</div>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ ...inp, width: '100%' }}>
            <option value="">— select project —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button
          onClick={handleExportProject}
          disabled={!selectedId || !!exportingId}
          style={{ height: 32, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: (!selectedId || !!exportingId) ? 0.5 : 1, cursor: 'default', flexShrink: 0 }}
        >
          {exportingId ? 'Exporting…' : 'Export project'}
        </button>
      </div>
      <div style={{ height: 1, background: 'var(--line)' }} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Export all projects</div>
          <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Downloads a zip with markdown files for every project</div>
        </div>
        <button
          onClick={handleExportAll}
          disabled={exportingAll}
          style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: exportingAll ? 0.6 : 1, cursor: 'default' }}
        >
          {exportingAll ? 'Exporting…' : 'Export all'}
        </button>
      </div>
    </div>
  )
}

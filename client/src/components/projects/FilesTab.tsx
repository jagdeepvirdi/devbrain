import { Fragment, useState, useEffect, useCallback } from 'react'
import { projectFilesApi, type ProjectFileEntry } from '../../lib/api'
import { ProjectFileEditorOverlay } from './ProjectFileEditorOverlay'

interface FilesTabProps {
  projectId: string
}

function fmtSize(bytes?: number) {
  if (bytes == null) return ''
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

// Directory browser + editor launcher for a project's linked fs_path (real files on
// disk) — the counterpart to GitTab, in the same per-project slide-in panel. Browsing
// is directory-at-a-time (not a full recursive tree) to keep listing requests cheap
// even on large repos; each request applies the root .gitignore server-side.
export default function FilesTab({ projectId }: FilesTabProps) {
  const [dirPath, setDirPath] = useState('')
  const [items,   setItems]   = useState<ProjectFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<string | null>(null)

  const load = useCallback((p: string) => {
    setLoading(true)
    projectFilesApi.list(projectId, p)
      .then(res => { setDirPath(res.path); setItems(res.items); setError(null) })
      .catch(err => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { load('') }, [load])

  const crumbs = dirPath ? dirPath.split('/') : []

  if (error) return <div style={{ fontSize: 12, color: '#F8A8A8', padding: 20, textAlign: 'center' }}>{error}</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, fontSize: 11.5 }}>
        <button onClick={() => load('')} style={{ color: dirPath ? '#818CF8' : 'var(--fg)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          root
        </button>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            <span style={{ color: 'var(--fg-4)' }}>/</span>
            <button
              onClick={() => load(crumbs.slice(0, i + 1).join('/'))}
              style={{ color: i === crumbs.length - 1 ? 'var(--fg)' : '#818CF8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {c}
            </button>
          </Fragment>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: 20, textAlign: 'center' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--fg-4)', padding: 20, textAlign: 'center' }}>Empty directory.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map(item => (
            <button
              key={item.name}
              onClick={() => {
                const next = dirPath ? `${dirPath}/${item.name}` : item.name
                if (item.type === 'dir') load(next)
                else setOpenFile(next)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '6px 4px',
                background: 'none', border: 'none', borderBottom: '1px solid var(--line-2)',
                cursor: 'pointer', textAlign: 'left', width: '100%',
              }}
            >
              <span style={{ fontSize: 12, color: item.type === 'dir' ? '#818CF8' : 'var(--fg-3)', width: 14, flexShrink: 0 }}>
                {item.type === 'dir' ? '📁' : '📄'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--fg)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.name}
              </span>
              {item.type === 'file' && (
                <span style={{ fontSize: 10.5, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{fmtSize(item.size)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {openFile && (
        <ProjectFileEditorOverlay projectId={projectId} filePath={openFile} onClose={() => setOpenFile(null)} />
      )}
    </div>
  )
}

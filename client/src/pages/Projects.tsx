import { useState, useEffect, useCallback } from 'react'
import { projectsApi, type Project, type ProjectInput } from '../lib/api'
import { useProjectStore } from '../store/projectStore'
import { ProjectModal } from '../components/projects/ProjectModal'
import TasksTab from '../components/projects/TasksTab'
import SessionsTab from '../components/projects/SessionsTab'
import GitTab from '../components/projects/GitTab'
import MembersTab from '../components/projects/MembersTab'
import { useToast } from '../components/Toast'

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  active:   { color: '#86EFAC', bg: 'rgba(74,222,128,.08)',  border: 'rgba(74,222,128,.25)' },
  paused:   { color: '#F0DC85', bg: 'rgba(230,195,65,.08)',  border: 'rgba(230,195,65,.25)' },
  planning: { color: 'var(--fg-3)', bg: 'var(--bg-elev-2)', border: 'var(--line-2)' },
}

type DeleteState   = { id: string; name: string } | null
type LinkingState  = { id: string; current: string | null } | null
type PanelTab      = 'tasks' | 'sessions' | 'git' | 'members'
type PanelState    = { projectId: string; tab: PanelTab } | null

export function ProjectsPage() {
  const { projects, setProjects, setSelectedId } = useProjectStore()
  const { toast } = useToast()
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState<string | null>(null)
  const [modal, setModal]     = useState<'create' | Project | null>(null)
  const [deleting, setDeleting] = useState<DeleteState>(null)
  const [panel, setPanel]     = useState<PanelState>(null)
  const [linking, setLinking] = useState<LinkingState>(null)
  const [linkPath, setLinkPath]     = useState('')
  const [linkSaving, setLinkSaving] = useState(false)

  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null)
  useEffect(() => {
    authApi.me().then(d => setCurrentUser(d.user))
  }, [])
  const isAdmin = currentUser?.role === 'admin'

  const load = useCallback(async () => {
    try {
      const data = await projectsApi.list()
      setProjects(data)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [setProjects])

  useEffect(() => { load() }, [load])

  async function handleSave(data: ProjectInput) {
    if (modal === 'create') {
      await projectsApi.create(data)
      toast(`Project "${data.name}" created`)
    } else if (modal && typeof modal === 'object') {
      await projectsApi.update(modal.id, data)
      toast('Project updated')
    }
    await load()
  }

  async function handleDelete() {
    if (!deleting) return
    try {
      await projectsApi.remove(deleting.id)
      setDeleting(null)
      toast(`"${deleting.name}" deleted`)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
      setDeleting(null)
    }
  }

  async function handleSeedReset() {
    if (!confirm('Reset all projects to seed defaults? This will delete ALL projects and their data.')) return
    try {
      await projectsApi.seedReset()
      toast('Seed reset complete')
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  function openLink(p: Project) {
    setLinking({ id: p.id, current: p.fs_path })
    setLinkPath(p.fs_path ?? '')
  }

  async function handleLinkSave() {
    if (!linking) return
    setLinkSaving(true)
    try {
      const path = linkPath.trim() || null
      await projectsApi.link(linking.id, path)
      toast(path ? 'Project linked to folder' : 'Folder link removed')
      setLinking(null)
      await load()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLinkSaving(false)
    }
  }

  const panelProject = panel ? projects.find(p => p.id === panel.projectId) : null

  if (loading) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--fg-3)', fontSize: '12.5px' }}>
      Loading projects…
    </div>
  )

  if (error) return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#F8A8A8', fontSize: '12.5px' }}>
      Error: {error}
    </div>
  )

  return (
    <>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>Projects</h1>
        <span style={{ fontSize: '11px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{projects.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button
            onClick={handleSeedReset}
            style={{ height: 26, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-3)', fontSize: '12px' }}
          >
            Reset to seed
          </button>
          <button
            onClick={() => setModal('create')}
            style={{ height: 26, padding: '0 12px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'white', fontSize: '12px', border: 'none', boxShadow: '0 0 0 1px rgba(99,102,241,.3), 0 0 18px rgba(99,102,241,.25)' }}
          >
            ＋ New project
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Project grid */}
        <div data-testid="project-grid" style={{ flex: 1, overflowY: 'auto', padding: '18px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '14px', alignContent: 'start' }}>
          {projects.length === 0 && (
            <div style={{ gridColumn: '1/-1', padding: '48px', textAlign: 'center', color: 'var(--fg-3)', fontSize: '13px' }}>
              No projects yet. Create one above.
            </div>
          )}
          {projects.map(p => {
            const st = STATUS_STYLE[p.status]
            const isLinked   = !!p.fs_path
            const panelOpen  = panel?.projectId === p.id
            return (
              <div key={p.id} data-testid="project-card" style={{ background: 'var(--bg-elev)', border: `1px solid ${panelOpen ? 'rgba(99,102,241,.4)' : 'var(--line)'}`, borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Color bar */}
                <div style={{ height: 3, background: p.color }} />

                <div style={{ padding: '14px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {/* Title row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--fg)', flex: 1 }}>{p.name}</span>
                    {isLinked && (
                      <span title={p.fs_path ?? ''} style={{
                        display: 'inline-flex', alignItems: 'center',
                        height: 16, padding: '0 5px', borderRadius: 3,
                        fontSize: '10px', fontWeight: 600,
                        color: '#818CF8', background: 'rgba(99,102,241,.12)', border: '1px solid rgba(99,102,241,.3)',
                        letterSpacing: '0.03em',
                      }}>
                        CLAUDE
                      </span>
                    )}
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      height: 18, padding: '0 6px', borderRadius: 4,
                      fontSize: '10.5px', fontWeight: 500,
                      color: st.color, background: st.bg, border: `1px solid ${st.border}`,
                    }}>
                      {p.status}
                    </span>
                  </div>

                  {/* Description */}
                  {p.description && (
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--fg-3)', lineHeight: 1.55, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }}>
                      {p.description}
                    </p>
                  )}

                  {/* Tech stack chips */}
                  {p.tech_stack.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {p.tech_stack.slice(0, 5).map(t => (
                        <span key={t} style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', fontSize: '11px', color: 'var(--fg-3)' }}>
                          {t}
                        </span>
                      ))}
                      {p.tech_stack.length > 5 && (
                        <span style={{ padding: '2px 7px', borderRadius: 4, background: 'var(--bg-elev-2)', border: '1px solid var(--line)', fontSize: '11px', color: 'var(--fg-4)' }}>
                          +{p.tech_stack.length - 5}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Stats row */}
                  <div style={{ display: 'flex', gap: '14px', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid var(--line)' }}>
                    {[
                      { label: 'docs',     val: p.doc_count },
                      { label: 'issues',   val: p.issue_count },
                      { label: 'commands', val: p.command_count },
                      { label: 'releases', val: p.release_count },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--fg)', fontVariantNumeric: 'tabular-nums' }}>{val}</span>
                        <span style={{ fontSize: '10.5px', color: 'var(--fg-4)' }}>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Action row */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)', display: 'flex', gap: '6px', background: 'var(--bg-elev-2)', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setSelectedId(p.id)}
                    style={{ height: 24, padding: '0 10px', flex: 1, borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: '11.5px' }}
                  >
                    Select
                  </button>
                  {isLinked && (
                    <>
                      <button
                        onClick={() => setPanel(panelOpen && panel?.tab === 'tasks' ? null : { projectId: p.id, tab: 'tasks' })}
                        style={{
                          height: 24, padding: '0 10px', borderRadius: 'var(--radius)',
                          border:     `1px solid ${panelOpen && panel?.tab === 'tasks' ? 'rgba(99,102,241,.4)' : 'var(--line-2)'}`,
                          background: panelOpen && panel?.tab === 'tasks' ? 'rgba(99,102,241,.15)' : 'var(--bg-elev)',
                          color:      panelOpen && panel?.tab === 'tasks' ? '#818CF8' : 'var(--fg-2)',
                          fontSize: '11.5px',
                        }}
                      >
                        Tasks
                      </button>
                      <button
                        onClick={() => setPanel(panelOpen && panel?.tab === 'sessions' ? null : { projectId: p.id, tab: 'sessions' })}
                        style={{
                          height: 24, padding: '0 10px', borderRadius: 'var(--radius)',
                          border:     `1px solid ${panelOpen && panel?.tab === 'sessions' ? 'rgba(99,102,241,.4)' : 'var(--line-2)'}`,
                          background: panelOpen && panel?.tab === 'sessions' ? 'rgba(99,102,241,.15)' : 'var(--bg-elev)',
                          color:      panelOpen && panel?.tab === 'sessions' ? '#818CF8' : 'var(--fg-2)',
                          fontSize: '11.5px',
                        }}
                      >
                        Sessions
                      </button>
                      <button
                        onClick={() => setPanel(panelOpen && panel?.tab === 'git' ? null : { projectId: p.id, tab: 'git' })}
                        style={{
                          height: 24, padding: '0 10px', borderRadius: 'var(--radius)',
                          border:     `1px solid ${panelOpen && panel?.tab === 'git' ? 'rgba(99,102,241,.4)' : 'var(--line-2)'}`,
                          background: panelOpen && panel?.tab === 'git' ? 'rgba(99,102,241,.15)' : 'var(--bg-elev)',
                          color:      panelOpen && panel?.tab === 'git' ? '#818CF8' : 'var(--fg-2)',
                          fontSize: '11.5px',
                        }}
                      >
                        Git
                      </button>
                    </>
                  )}
                  {!isLinked && (
                    <span title="Link a folder in Settings → Claude Integration to enable task and session sync" style={{ fontSize: '11px', color: 'var(--fg-4)', display: 'flex', alignItems: 'center', gap: 4, cursor: 'default' }}>
                      ⊘ No folder linked
                    </span>
                  )}
                  <button
                    onClick={() => openLink(p)}
                    title={isLinked ? `Linked: ${p.fs_path}` : 'Link to Claude project folder'}
                    style={{ height: 24, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: isLinked ? '#818CF8' : 'var(--fg-3)', fontSize: '11.5px' }}
                  >
                    {isLinked ? '⊙ Linked' : '⊕ Link'}
                  </button>
                  <button
                    onClick={() => setModal(p)}
                    style={{ height: 24, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: '11.5px' }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => setDeleting({ id: p.id, name: p.name })}
                    style={{ height: 24, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.08)', color: '#F8A8A8', fontSize: '11.5px' }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Tasks / Sessions slide-in panel */}
        {panel && panelProject && (
          <div style={{
            width: 400, flexShrink: 0, borderLeft: '1px solid var(--line)',
            background: 'var(--bg)', display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Panel header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: panelProject.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg)', flex: 1 }}>{panelProject.name}</span>
              {/* Tab switcher */}
              {(['tasks', 'sessions', 'git', 'members'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setPanel({ projectId: panel.projectId, tab: t })}
                  style={{
                    height: 22, padding: '0 9px', borderRadius: 'var(--radius)',
                    border:     `1px solid ${panel.tab === t ? 'rgba(99,102,241,.4)' : 'var(--line)'}`,
                    background: panel.tab === t ? 'rgba(99,102,241,.15)' : 'none',
                    color:      panel.tab === t ? '#818CF8' : 'var(--fg-4)',
                    fontSize: 11, cursor: 'pointer', textTransform: 'capitalize',
                  }}
                >
                  {t}
                </button>
              ))}
              <button
                onClick={() => setPanel(null)}
                aria-label="Close panel"
                style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', color: 'var(--fg-4)', fontSize: 14, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
              >
                ✕
              </button>
            </div>
            {/* Panel body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
              {panel.tab === 'tasks' && <TasksTab projectId={panel.projectId} />}
              {panel.tab === 'sessions' && <SessionsTab projectId={panel.projectId} />}
              {panel.tab === 'git' && <GitTab projectId={panel.projectId} />}
              {panel.tab === 'members' && <MembersTab projectId={panel.projectId} isAdmin={isAdmin} />}
            </div>
          </div>
        )}
      </div>

      {/* Create / Edit modal */}
      {modal && (
        <ProjectModal
          project={modal === 'create' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Link folder dialog */}
      {linking && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: '10px', padding: '24px', maxWidth: '440px', width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Link to Claude project folder</h3>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--fg-3)', lineHeight: 1.6 }}>
              Enter the absolute path to the project directory that contains a <code style={{ background: 'var(--bg-elev-2)', padding: '1px 4px', borderRadius: 3 }}>TASKS.md</code> or <code style={{ background: 'var(--bg-elev-2)', padding: '1px 4px', borderRadius: 3 }}>CLAUDE.md</code> file. DevBrain will watch for changes and sync tasks live.
            </p>
            <input
              type="text"
              value={linkPath}
              onChange={e => setLinkPath(e.target.value)}
              placeholder={linking.current ?? 'e.g. C:\\Users\\you\\projects\\myapp'}
              style={{ height: 32, padding: '0 10px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg)', color: 'var(--fg)', fontSize: '12px', fontFamily: 'var(--font-mono)', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleLinkSave() }}
            />
            {linking.current && (
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--fg-4)' }}>
                Currently linked: <span style={{ fontFamily: 'var(--font-mono)', color: '#818CF8' }}>{linking.current}</span>
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              {linking.current && (
                <button
                  onClick={async () => { setLinkPath(''); await handleLinkSave() }}
                  disabled={linkSaving}
                  style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.08)', color: '#F8A8A8', fontSize: '12px' }}
                >
                  Remove link
                </button>
              )}
              <button
                onClick={() => setLinking(null)}
                style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleLinkSave}
                disabled={linkSaving}
                style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', background: 'var(--accent)', color: 'white', fontSize: '12px', border: 'none', opacity: linkSaving ? 0.6 : 1 }}
              >
                {linkSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {deleting && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 300, display: 'grid', placeItems: 'center' }}>
          <div style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: '10px', padding: '24px', maxWidth: '360px', width: '100%', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '22px' }}>⚠</div>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: '14px', fontWeight: 600, color: 'var(--fg)' }}>Delete "{deleting.name}"?</p>
              <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--fg-3)' }}>All documents, issues, commands, and releases for this project will be permanently deleted.</p>
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={() => setDeleting(null)}
                style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: '12.5px' }}>
                Cancel
              </button>
              <button onClick={handleDelete}
                style={{ height: 28, padding: '0 16px', borderRadius: 'var(--radius)', border: 'none', background: '#F05A5A', color: 'white', fontSize: '12.5px' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

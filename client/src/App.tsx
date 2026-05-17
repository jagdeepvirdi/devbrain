import { useState, useEffect, useCallback } from 'react'
import { useProjectStore } from './store/projectStore'
import { projectsApi, authApi } from './lib/api'
import { ToastProvider } from './components/Toast'
import { ProjectSwitcher } from './components/projects/ProjectSwitcher'
import { ProjectsPage }   from './pages/Projects'
import { AiTaskPage }     from './pages/AiTask'
import { DocumentsPage }  from './pages/Documents'
import { DocChatPage }    from './pages/DocChat'
import { IssuesPage }    from './pages/Issues'
import { TasksPage }     from './pages/Tasks'
import { CommandsPage }  from './pages/Commands'
import { ReleasesPage }  from './pages/Releases'
import { RunbooksPage }  from './pages/Runbooks'
import { DashboardPage } from './pages/Dashboard'
import { SettingsPage }  from './pages/Settings'
import { LoginPage }     from './pages/Login'
import { GlobalSearch }  from './components/search/GlobalSearch'

type RouteId = 'dashboard' | 'docs' | 'chat' | 'issues' | 'tasks' | 'commands' | 'releases' | 'runbooks' | 'projects' | 'aitask' | 'settings'
type Density = 'compact' | 'normal' | 'comfy'
type Tint    = 'cool' | 'black' | 'warm'

const NAV_ITEMS: { id: RouteId; label: string; icon: string; dividerBefore?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard',  icon: '⊞' },
  { id: 'docs',      label: 'Documents',  icon: '📄' },
  { id: 'chat',      label: 'Ask AI',     icon: '◆' },
  { id: 'issues',    label: 'Issues',     icon: '⚠' },
  { id: 'tasks',     label: 'Tasks',      icon: '☑' },
  { id: 'commands',  label: 'Commands',   icon: '>' },
  { id: 'releases',  label: 'Releases',   icon: '🏷' },
  { id: 'runbooks',  label: 'Runbooks',   icon: '▶' },
  { id: 'aitask',    label: 'AI Task',    icon: '◆', dividerBefore: true },
  { id: 'projects',  label: 'Projects',   icon: '⊛' },
  { id: 'settings',  label: 'Settings',   icon: '⚙', dividerBefore: true },
]

export default function App() {
  const { projects, setProjects, selectedProject } = useProjectStore()
  const [route,      setRoute]      = useState<RouteId>('dashboard')
  const [density,    setDensity]    = useState<Density>('normal')
  const [tint]                      = useState<Tint>('cool')
  const [sidebar,    setSidebar]    = useState<'open' | 'collapsed'>('open')
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [authed,     setAuthed]     = useState<boolean | null>(null)

  // Auth check on mount
  useEffect(() => {
    authApi.me().then(({ authed }) => setAuthed(authed))
  }, [])

  // Listen for 401 events from any API call
  useEffect(() => {
    function onUnauthorized() { setAuthed(false) }
    window.addEventListener('devbrain:unauthorized', onUnauthorized)
    return () => window.removeEventListener('devbrain:unauthorized', onUnauthorized)
  }, [])

  // Cross-page navigation via custom events (e.g. Release → Issues)
  useEffect(() => {
    function onNavigate(e: Event) {
      setRoute((e as CustomEvent<RouteId>).detail)
    }
    window.addEventListener('devbrain:navigate', onNavigate)
    return () => window.removeEventListener('devbrain:navigate', onNavigate)
  }, [])

  // Bootstrap project list
  const loadProjects = useCallback(async () => {
    try {
      const data = await projectsApi.list()
      setProjects(data)
    } catch {
      // server not running yet — no-op, projects page will show error
    }
  }, [setProjects])

  useEffect(() => { loadProjects() }, [loadProjects])

  // Reload projects when navigating to projects page (picks up any external changes)
  useEffect(() => {
    if (route === 'projects') loadProjects()
  }, [route, loadProjects])

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true) }
      if (e.key === '?' && !typing) { e.preventDefault(); setShortcutsOpen(s => !s) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const project = selectedProject()

  function renderRoute() {
    switch (route) {
      case 'projects':  return <ProjectsPage />
      case 'aitask':    return <AiTaskPage />
      case 'docs':      return <DocumentsPage />
      case 'chat':      return <DocChatPage />
      case 'issues':    return <IssuesPage />
      case 'tasks':     return <TasksPage />
      case 'commands':  return <CommandsPage />
      case 'releases':  return <ReleasesPage />
      case 'runbooks':  return <RunbooksPage />
      case 'dashboard': return <DashboardPage />
      case 'settings':  return <SettingsPage onLogout={() => setAuthed(false)} />
      default:
        return (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
              <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--fg)' }}>
                {NAV_ITEMS.find(n => n.id === route)?.label ?? 'Dashboard'}
              </h1>
              {project && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--fg-3)' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: project.color }} />
                  {project.name}
                </span>
              )}
              <span style={{ marginLeft: 'auto', fontSize: '11.5px', color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>
                Phase 2+
              </span>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px', color: 'var(--fg-3)' }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--accent-dim)', border: '1px solid var(--accent-line)', display: 'grid', placeItems: 'center', fontSize: '22px', color: 'var(--accent-2)' }}>
                {NAV_ITEMS.find(n => n.id === route)?.icon}
              </div>
              <p style={{ margin: 0, fontSize: '13px', color: 'var(--fg-3)' }}>
                <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>{NAV_ITEMS.find(n => n.id === route)?.label}</span>
                {' '}— coming in Phase 2
              </p>
            </div>
          </div>
        )
    }
  }

  // Auth loading splash
  if (authed === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', color: 'var(--fg-3)', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  // Login wall
  if (authed === false) {
    return (
      <ToastProvider>
        <LoginPage onLogin={() => setAuthed(true)} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider>
    <div className="app" data-density={density} data-tint={tint} data-sidebar={sidebar}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header style={{
        gridColumn: '1 / -1',
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '0 12px',
        borderBottom: '1px solid var(--line)',
        background: 'var(--bg-elev)',
        position: 'relative', zIndex: 5,
      }}>
        {/* Brand */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          width: 'var(--sidebar-w, 220px)',
          paddingRight: '12px', borderRight: '1px solid var(--line)',
          height: '100%', marginLeft: '-12px', paddingLeft: '14px',
          flexShrink: 0, transition: 'width .15s ease',
        }}>
          <div style={{
            width: 22, height: 22, background: 'var(--accent)', borderRadius: 5,
            display: 'grid', placeItems: 'center', flexShrink: 0,
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1), 0 0 0 1px rgba(99,102,241,.25), 0 0 16px rgba(99,102,241,.35)',
          }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="4" height="4" rx="1" fill="white" fillOpacity=".9"/>
              <rect x="7" y="1" width="4" height="4" rx="1" fill="white" fillOpacity=".5"/>
              <rect x="1" y="7" width="4" height="4" rx="1" fill="white" fillOpacity=".5"/>
              <rect x="7" y="7" width="4" height="4" rx="1" fill="white" fillOpacity=".9"/>
            </svg>
          </div>
          <span className="brand-name" style={{ fontWeight: 600, letterSpacing: '.005em', fontSize: '13px', whiteSpace: 'nowrap' }}>
            <b style={{ color: 'var(--fg)' }}>Dev</b><span style={{ color: 'var(--fg-3)', fontWeight: 500 }}>Brain</span>
          </span>
        </div>

        {/* Project switcher */}
        <ProjectSwitcher onNavigate={r => setRoute(r as RouteId)} />

        {/* Global search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          style={{
            flex: 1, maxWidth: '420px', height: 28,
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '0 8px 0 10px',
            borderRadius: 'var(--radius)', border: '1px solid var(--line-2)',
            background: 'var(--bg-elev-2)', color: 'var(--fg-3)',
            fontSize: '12.5px', cursor: 'default', textAlign: 'left',
          }}
        >
          <span style={{ opacity: .5 }}>⌘</span>
          <span>Search docs, issues, commands…</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '10.5px', padding: '1px 5px', border: '1px solid var(--line-2)', borderBottomWidth: 2, borderRadius: 4, background: 'var(--bg)' }}>⌘K</span>
        </button>

        {/* Top-right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: 'auto' }}>
          {/* Sidebar toggle */}
          <button onClick={() => setSidebar(s => s === 'open' ? 'collapsed' : 'open')}
            style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 'var(--radius)', color: 'var(--fg-3)' }}>
            ☰
          </button>
          {/* Avatar */}
          <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #6366F1, #EC4899)', display: 'grid', placeItems: 'center', fontSize: '11px', fontWeight: 600, color: 'white' }}>
            JV
          </div>
        </div>
      </header>

      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <nav style={{ borderRight: '1px solid var(--line)', background: 'var(--panel)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: '1px' }}>
          {NAV_ITEMS.map(item => (
            <div key={item.id}>
              {item.dividerBefore && (
                <div style={{ height: 1, background: 'var(--line)', margin: '8px 0' }} />
              )}
              <button
                onClick={() => setRoute(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  height: 28, padding: '0 10px', width: '100%',
                  borderRadius: 'var(--radius)',
                  color: route === item.id ? 'var(--fg)' : 'var(--fg-2)',
                  background: route === item.id ? 'var(--bg-elev-2)' : 'transparent',
                  boxShadow: route === item.id ? 'inset 0 0 0 1px var(--line-2)' : 'none',
                  position: 'relative', cursor: 'default', textAlign: 'left',
                  fontSize: 13,
                }}
              >
                {route === item.id && (
                  <span style={{ position: 'absolute', left: -8, top: 6, bottom: 6, width: 2, background: 'var(--accent)', borderRadius: 2 }} />
                )}
                <span className="sidebar-label" style={{ color: route === item.id ? 'var(--accent-2)' : 'var(--fg-3)', width: 16, textAlign: 'center', fontSize: 12, flexShrink: 0 }}>
                  {item.icon}
                </span>
                <span className="sidebar-label">{item.label}</span>
                {item.id === 'projects' && projects.length > 0 && (
                  <span className="sidebar-count" style={{ marginLeft: 'auto', fontSize: '10.5px', color: 'var(--fg-3)', background: 'var(--bg-elev-2)', border: '1px solid var(--line)', padding: '0 5px', borderRadius: '99px', minWidth: 18, textAlign: 'center' }}>
                    {projects.length}
                  </span>
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer */}
        <div style={{ marginTop: 'auto', padding: '10px', borderTop: '1px solid var(--line)' }}>
          <div className="sidebar-footer-content" style={{ fontSize: '11px', color: 'var(--fg-3)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>AI</span>
              <span style={{ color: project ? project.color : 'var(--fg-2)', fontWeight: 500 }}>
                {project ? project.name : 'All projects'}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Backend</span>
              <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>Ollama local</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>GPU</span>
              <span style={{ color: 'var(--fg-2)', fontWeight: 500 }}>RTX 2060</span>
            </div>
            {/* Density quick-toggle */}
            <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
              {(['compact', 'normal', 'comfy'] as Density[]).map(d => (
                <button key={d} onClick={() => setDensity(d)}
                  style={{ flex: 1, height: 18, borderRadius: 3, border: '1px solid var(--line-2)', background: density === d ? 'var(--accent)' : 'var(--bg-elev)', color: density === d ? 'white' : 'var(--fg-4)', fontSize: '9px', cursor: 'default' }}>
                  {d[0].toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main style={{ overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column', background: 'var(--bg)', minWidth: 0 }}>
        {renderRoute()}
      </main>

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={r => { setRoute(r); setSearchOpen(false) }}
      />

      {/* Keyboard shortcuts modal */}
      {shortcutsOpen && (
        <div
          onClick={() => setShortcutsOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,10,.65)', backdropFilter: 'blur(4px)', zIndex: 500, display: 'grid', placeItems: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-elev)', border: '1px solid var(--line-3)', borderRadius: 10, padding: '20px 24px', width: 360, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--fg)' }}>Keyboard shortcuts</span>
              <button onClick={() => setShortcutsOpen(false)} style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid var(--line-2)', background: 'var(--bg-elev-2)', color: 'var(--fg-3)', fontSize: 12 }}>✕</button>
            </div>
            {[
              ['Navigation', [
                ['⌘K', 'Open search'],
                ['?',  'Toggle shortcuts'],
              ]],
              ['Global', [
                ['G D', 'Go to Dashboard'],
                ['G I', 'Go to Issues'],
                ['G C', 'Go to Commands'],
                ['G R', 'Go to Runbooks'],
              ]],
            ].map(([section, shortcuts]) => (
              <div key={section as string} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--fg-4)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>{section as string}</div>
                {(shortcuts as [string, string][]).map(([key, label]) => (
                  <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--fg-3)' }}>{label}</span>
                    <kbd style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, padding: '2px 6px', border: '1px solid var(--line-2)', borderBottomWidth: 2, borderRadius: 4, background: 'var(--bg)', color: 'var(--fg-2)' }}>{key}</kbd>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
    </ToastProvider>
  )
}

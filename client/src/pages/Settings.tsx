import React, { useState, useEffect, useRef } from 'react'
import { settingsApi, authApi, projectsApi, type SettingsData, type ImportSummary, type AuthUser, type Project } from '../lib/api'
import { useToast } from '../components/Toast'
import { Row, Section } from '../components/settings/shared'
import { ROLE_COLOR } from '../components/settings/constants'
import { UserManagement } from '../components/settings/UserManagement'
import { AuditLog } from '../components/settings/AuditLog'
import { ApiTokensSection } from '../components/settings/ApiTokensSection'
import { IntegrationsSection } from '../components/settings/IntegrationsSection'
import { LdapConfigurationSection } from '../components/settings/LdapConfigurationSection'
import { ClaudeIntegrationSection } from '../components/settings/ClaudeIntegrationSection'
import { AntigravityIntegrationSection } from '../components/settings/AntigravityIntegrationSection'
import { ExportSection } from '../components/settings/ExportSection'
import { ScheduledBackupSection } from '../components/settings/ScheduledBackupSection'
import { NotificationRulesSection } from '../components/settings/NotificationRulesSection'
import { ZipImportSection } from '../components/settings/ZipImportSection'
import { NotificationHubSection } from '../components/settings/NotificationHubSection'
import { TemplatesSection } from '../components/settings/TemplatesSection'

// ── Main Settings page ────────────────────────────────────────────────────

type Density = 'compact' | 'normal' | 'comfy' | 'xl'

const FONT_SIZE_OPTIONS: { value: Density; label: string; size: string }[] = [
  { value: 'compact', label: 'Small',  size: '12px' },
  { value: 'normal',  label: 'Medium', size: '13px' },
  { value: 'comfy',   label: 'Large',  size: '15px' },
  { value: 'xl',      label: 'XL',     size: '16px' },
]

export function SettingsPage({ onLogout, currentUser, density, setDensity }: {
  onLogout: () => void
  currentUser: AuthUser | null
  density: Density
  setDensity: (d: Density) => void
}) {
  const { toast } = useToast()
  const [settings,      setSettings]      = useState<SettingsData | null>(null)
  const [loading,       setLoading]       = useState(true)
  const [backing,       setBacking]       = useState(false)
  const [reseeding,     setReseeding]     = useState(false)
  const [importFile,    setImportFile]    = useState<File | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importResult,  setImportResult]  = useState<ImportSummary | null>(null)
  const [importError,   setImportError]   = useState('')
  const [oldPwd,        setOldPwd]        = useState('')
  const [newPwd,        setNewPwd]        = useState('')
  const [pwdLoading,    setPwdLoading]    = useState(false)
  const [projects,      setProjects]      = useState<Project[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState('general')

  const isAdmin = currentUser?.role === 'admin'

  useEffect(() => {
    settingsApi.get().then(setSettings).catch(() => {}).finally(() => setLoading(false))
    projectsApi.list().then(setProjects).catch(() => {})
  }, [])

  async function handleBackup() {
    setBacking(true)
    try { await settingsApi.downloadBackup(); toast('Backup downloaded') }
    catch { toast('Backup failed', 'error') }
    finally { setBacking(false) }
  }

  async function handleSeedReset() {
    if (!confirm('Reset all projects to seed defaults? This will delete ALL projects and their data.')) return
    setReseeding(true)
    try { await projectsApi.seedReset(); toast('Seed reset complete') }
    catch (err) { toast((err as Error).message, 'error') }
    finally { setReseeding(false) }
  }

  async function handleImport(dryRun: boolean) {
    if (!importFile) return
    setImportLoading(true); setImportError(''); setImportResult(null)
    try {
      const text = await importFile.text()
      const data = JSON.parse(text) as unknown
      const result = await settingsApi.importBackup(data, dryRun)
      setImportResult(result)
      if (!dryRun) {
        const total = Object.values(result.summary).reduce((s, t) => s + t.created, 0)
        toast(`Import complete — ${total} records created`)
      }
    } catch (e) { setImportError((e as Error).message) }
    finally { setImportLoading(false) }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    if (!oldPwd || !newPwd) return
    setPwdLoading(true)
    try {
      await authApi.changePassword(oldPwd, newPwd)
      toast('Password changed')
      setOldPwd(''); setNewPwd('')
    } catch (err) { toast((err as Error).message, 'error') }
    finally { setPwdLoading(false) }
  }

  function handleLogout() { authApi.logout(); onLogout() }

  const inp: React.CSSProperties = { width: '100%', background: 'var(--bg)', border: '1px solid var(--line-2)', borderRadius: 5, padding: '6px 8px', color: 'var(--fg)', fontSize: 12.5, boxSizing: 'border-box', outline: 'none' }

  const NAV: { id: string; label: string; adminOnly?: boolean }[] = [
    { id: 'general',       label: 'General' },
    { id: 'account',       label: 'Account' },
    { id: 'users',         label: 'Users & Auth',   adminOnly: true },
    { id: 'data',          label: 'Data' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'integrations',  label: 'Integrations' },
    { id: 'templates',     label: 'Templates' },
    { id: 'audit',         label: 'Audit Log',      adminOnly: true },
  ]

  const navItems = NAV.filter(n => !n.adminOnly || isAdmin)

  const navBtn = (id: string): React.CSSProperties => ({
    display: 'block', width: '100%', textAlign: 'left',
    padding: '7px 12px', borderRadius: 6, border: 'none',
    background: tab === id ? 'rgba(99,102,241,.12)' : 'none',
    color: tab === id ? '#818CF8' : 'var(--fg-3)',
    fontSize: 13, fontWeight: tab === id ? 600 : 400,
    cursor: 'pointer',
  })

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 24px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--fg)' }}>Settings</h1>
        {currentUser && (
          <span style={{ fontSize: 11.5, color: 'var(--fg-3)' }}>
            Signed in as <b style={{ color: 'var(--fg)' }}>{currentUser.username}</b>
            <span style={{ marginLeft: 6, fontSize: 10, padding: '1px 5px', borderRadius: 3, background: `${ROLE_COLOR[currentUser.role]}18`, border: `1px solid ${ROLE_COLOR[currentUser.role]}30`, color: ROLE_COLOR[currentUser.role] }}>
              {currentUser.role}
            </span>
          </span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Sidebar nav */}
        <div style={{ width: 168, flexShrink: 0, borderRight: '1px solid var(--line)', padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {navItems.map(n => (
            <button key={n.id} onClick={() => setTab(n.id)} style={navBtn(n.id)}>
              {n.label}
            </button>
          ))}
        </div>

        {/* Content pane */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 620 }}>
          {loading ? (
            <div style={{ color: 'var(--fg-3)', fontSize: 12.5 }}>Loading…</div>
          ) : (
            <>
              {/* ── General ──────────────────────────────────────────── */}
              {tab === 'general' && (
                <>
                  <Section title="Font Size">
                    <div style={{ paddingTop: 4 }}>
                      <div style={{ fontSize: 12, color: 'var(--fg-3)', marginBottom: 10 }}>
                        Adjusts the base text size across the entire interface. Saved automatically.
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {FONT_SIZE_OPTIONS.map(opt => {
                          const active = density === opt.value
                          return (
                            <button
                              key={opt.value}
                              onClick={() => setDensity(opt.value)}
                              style={{
                                flex: 1, padding: '10px 0', borderRadius: 'var(--radius)',
                                border: `1px solid ${active ? 'var(--accent)' : 'var(--line-2)'}`,
                                background: active ? 'var(--accent-dim)' : 'var(--bg-elev)',
                                color: active ? 'var(--accent-2)' : 'var(--fg-3)',
                                cursor: 'pointer', display: 'flex', flexDirection: 'column',
                                alignItems: 'center', gap: 4,
                              }}
                            >
                              <span style={{ fontSize: opt.size, fontWeight: 600, lineHeight: 1 }}>A</span>
                              <span style={{ fontSize: 11, fontWeight: active ? 600 : 400 }}>{opt.label}</span>
                              <span style={{ fontSize: 10, color: active ? 'var(--accent-2)' : 'var(--fg-4)' }}>{opt.size}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </Section>
                  <Section title="AI Backend">
                    <Row label="Provider"    value={settings?.ai.backend    ?? '—'} />
                    <Row label="Chat model"  value={settings?.ai.chatModel  ?? '—'} mono />
                    <Row label="Embed model" value={settings?.ai.embedModel ?? '—'} mono />
                    <Row label="Ollama URL"  value={settings?.ai.ollamaUrl  ?? '—'} mono />
                  </Section>
                  <Section title="About">
                    <Row label="Version" value="1.2.0" />
                    <Row label="Stack"   value="React + Node.js + PostgreSQL + Ollama" />
                    <Row label="Auth"    value="Multi-user JWT + optional LDAP" />
                  </Section>
                </>
              )}

              {/* ── Account ──────────────────────────────────────────── */}
              {tab === 'account' && (
                <Section title="Account">
                  <Row label="Mode" value={settings?.auth.enabled ? 'Password protected' : 'Dev mode (no auth)'} />
                  {settings?.auth.enabled && (
                    <>
                      {currentUser?.id !== 'legacy' && currentUser?.id !== 'dev' && (
                        <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--fg)', marginBottom: 8 }}>Change password</div>
                          <form onSubmit={handleChangePassword} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <input type="password" value={oldPwd} onChange={e => setOldPwd(e.target.value)} placeholder="Current password" style={{ ...inp, flex: 1, minWidth: 140 }} />
                            <input type="password" value={newPwd} onChange={e => setNewPwd(e.target.value)} placeholder="New password (min 6)" style={{ ...inp, flex: 1, minWidth: 140 }} />
                            <button type="submit" disabled={pwdLoading || !oldPwd || !newPwd} style={{ height: 32, padding: '0 12px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: pwdLoading ? 0.6 : 1, cursor: 'default' }}>
                              {pwdLoading ? 'Saving…' : 'Update'}
                            </button>
                          </form>
                        </div>
                      )}
                      <div style={{ marginTop: 12 }}>
                        <button onClick={handleLogout} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.08)', color: '#F8A8A8', fontSize: 12.5, cursor: 'default' }}>
                          Sign out
                        </button>
                      </div>
                    </>
                  )}
                </Section>
              )}

              {tab === 'account' && settings?.auth.enabled && currentUser?.id !== 'legacy' && currentUser?.id !== 'dev' && (
                <Section title="API Tokens">
                  <ApiTokensSection />
                </Section>
              )}

              {/* ── Users & Auth ─────────────────────────────────────── */}
              {tab === 'users' && isAdmin && (
                <>
                  <Section title="User Management">
                    <UserManagement />
                  </Section>
                  <Section title="LDAP Configuration">
                    <LdapConfigurationSection />
                  </Section>
                </>
              )}

              {/* ── Data ─────────────────────────────────────────────── */}
              {tab === 'data' && (
                <>
                  <Section title="Backup">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Export backup</div>
                          <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Download all data as JSON (excludes document content and embeddings)</div>
                        </div>
                        <button onClick={handleBackup} disabled={backing} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: backing ? 0.6 : 1, cursor: 'default' }}>
                          {backing ? 'Exporting…' : 'Download'}
                        </button>
                      </div>
                      <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                          <div>
                            <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Import backup</div>
                            <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Restore from a JSON backup file — skips records that already exist</div>
                          </div>
                          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0] ?? null; setImportFile(f); setImportResult(null); setImportError(''); e.target.value = '' }} />
                            <button onClick={() => fileRef.current?.click()} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, whiteSpace: 'nowrap', cursor: 'default' }}>
                              {importFile ? importFile.name : 'Choose file'}
                            </button>
                          </div>
                        </div>
                        {importFile && (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => handleImport(true)} disabled={importLoading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--line-2)', background: 'var(--bg-elev)', color: 'var(--fg-2)', fontSize: 12.5, opacity: importLoading ? 0.6 : 1, cursor: 'default' }}>Dry Run</button>
                            <button onClick={() => handleImport(false)} disabled={importLoading} style={{ height: 28, padding: '0 12px', borderRadius: 'var(--radius)', border: '1px solid var(--accent)', background: 'var(--accent)', color: 'white', fontSize: 12.5, opacity: importLoading ? 0.6 : 1, cursor: 'default' }}>Import</button>
                          </div>
                        )}
                        {importError && <div style={{ fontSize: 12, color: '#EF4444', padding: '6px 10px', borderRadius: 5, background: 'rgba(239,68,68,.06)', border: '1px solid rgba(239,68,68,.2)' }}>{importError}</div>}
                        {importResult && (
                          <div style={{ borderRadius: 7, border: '1px solid var(--line)', background: 'var(--bg)', padding: '10px 12px' }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--fg-3)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>{importResult.dry_run ? 'Dry run preview' : 'Import result'}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: '4px 12px', alignItems: 'center' }}>
                              <span style={{ fontSize: 11, color: 'var(--fg-4)' }} /><span style={{ fontSize: 11, color: '#22C55E', fontWeight: 600 }}>to create</span><span style={{ fontSize: 11, color: 'var(--fg-4)', fontWeight: 600 }}>skip</span>
                              {Object.entries(importResult.summary).map(([table, tally]) => (
                                <React.Fragment key={table}>
                                  <span style={{ fontSize: 12, color: 'var(--fg-2)', fontFamily: 'var(--font-mono)' }}>{table}</span>
                                  <span style={{ fontSize: 12, color: tally.created > 0 ? '#22C55E' : 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.created}</span>
                                  <span style={{ fontSize: 12, color: 'var(--fg-4)', fontFamily: 'var(--font-mono)' }}>{tally.skipped}</span>
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Section>

                  <Section title="Scheduled Backup">
                    <ScheduledBackupSection />
                  </Section>

                  <Section title="Export by Project">
                    <ExportSection projects={projects} />
                  </Section>

                  <Section title="Import from Zip">
                    <ZipImportSection />
                  </Section>

                  {isAdmin && (
                    <Section title="Danger Zone">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                        <div>
                          <div style={{ fontSize: 13, color: 'var(--fg)', fontWeight: 500 }}>Reset to seed data</div>
                          <div style={{ fontSize: 12, color: 'var(--fg-4)', marginTop: 2 }}>Delete all projects and restore the 5 default seed projects</div>
                        </div>
                        <button onClick={handleSeedReset} disabled={reseeding} style={{ height: 28, padding: '0 14px', borderRadius: 'var(--radius)', border: '1px solid rgba(240,90,90,.25)', background: 'rgba(240,90,90,.06)', color: '#F8A8A8', fontSize: 12.5, flexShrink: 0, marginLeft: 16, opacity: reseeding ? 0.6 : 1, cursor: 'default' }}>
                          {reseeding ? 'Resetting…' : 'Reset seed'}
                        </button>
                      </div>
                    </Section>
                  )}
                </>
              )}

              {/* ── Notifications ─────────────────────────────────────── */}
              {tab === 'notifications' && (
                <>
                  <Section title="Notification Rules">
                    <NotificationRulesSection isAdmin={isAdmin} />
                  </Section>
                  <Section title="Notification Hub">
                    <NotificationHubSection projects={projects} />
                  </Section>
                </>
              )}

              {/* ── Integrations ──────────────────────────────────────── */}
              {tab === 'integrations' && (
                <>
                  {isAdmin && (
                    <Section title="External Issue Sync">
                      <IntegrationsSection projects={projects} />
                    </Section>
                  )}
                  <Section title="Claude Code">
                    <ClaudeIntegrationSection />
                  </Section>
                  <Section title="Antigravity / Gemini CLI">
                    <AntigravityIntegrationSection />
                  </Section>
                </>
              )}

              {/* ── Templates ─────────────────────────────────────────── */}
              {tab === 'templates' && (
                <Section title="Templates">
                  <TemplatesSection projects={projects} />
                </Section>
              )}

              {/* ── Audit Log ─────────────────────────────────────────── */}
              {tab === 'audit' && isAdmin && (
                <Section title="Audit Log">
                  <AuditLog />
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

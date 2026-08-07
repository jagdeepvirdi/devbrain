import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SettingsPage } from './Settings'
import type { AuthUser, User, Invite, AuditEvent, ApiToken, Integration, ScanCandidate, SettingsData, BackupConfig, Template, NotificationChannel } from '../lib/api'

const toastMock = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

// ── API mocks ────────────────────────────────────────────────────────────
const settingsGet               = vi.fn()
const getLdapSettings           = vi.fn()
const saveLdapSettings          = vi.fn()
const testLdap                  = vi.fn()
const getClaudeSettings         = vi.fn()
const saveClaudeSettings        = vi.fn()
const getAntigravitySettings    = vi.fn()
const saveAntigravitySettings   = vi.fn()
const exportProject             = vi.fn()
const exportAll                 = vi.fn()
const getBackupConfig           = vi.fn()
const saveBackupConfig          = vi.fn()
const backupNow                 = vi.fn()
const testBackupRemote          = vi.fn()
const getNotificationRules      = vi.fn()
const saveNotificationRules     = vi.fn()
const zipImport                 = vi.fn()
const getDigestSettings         = vi.fn()
const saveDigestSettings        = vi.fn()
const downloadBackup            = vi.fn()
const importBackup              = vi.fn()

const usersList        = vi.fn()
const usersListInvites = vi.fn()
const usersCreate      = vi.fn()
const usersCreateInvite = vi.fn()
const usersUpdate      = vi.fn()
const usersRemoveInvite = vi.fn()
const usersRemove      = vi.fn()

const auditList   = vi.fn()
const auditExport = vi.fn()

const apiTokensList   = vi.fn()
const apiTokensCreate = vi.fn()
const apiTokensRevoke = vi.fn()

const integrationsList   = vi.fn()
const integrationsCreate = vi.fn()
const integrationsRemove = vi.fn()
const integrationsSync   = vi.fn()

const projectsList      = vi.fn()
const projectsLink      = vi.fn()
const projectsCreate    = vi.fn()
const projectsSeedReset = vi.fn()

const claudeScan      = vi.fn()
const antigravityScan = vi.fn()

const notifyGetChannels     = vi.fn()
const notifyCreateChannel   = vi.fn()
const notifyDeleteChannel   = vi.fn()
const notifyToggleChannel   = vi.fn()
const notifyGetProjectPrefs = vi.fn()
const notifySaveProjectPref = vi.fn()
const notifyTest            = vi.fn()

const templatesList   = vi.fn()
const templatesCreate = vi.fn()
const templatesUpdate = vi.fn()
const templatesRemove = vi.fn()

const authChangePassword = vi.fn()
const authLogout         = vi.fn()

vi.mock('../lib/api', () => ({
  settingsApi: {
    get: () => settingsGet(),
    getLdapSettings: () => getLdapSettings(),
    saveLdapSettings: (...a: unknown[]) => saveLdapSettings(...a),
    testLdap: (...a: unknown[]) => testLdap(...a),
    getClaudeSettings: () => getClaudeSettings(),
    saveClaudeSettings: (...a: unknown[]) => saveClaudeSettings(...a),
    getAntigravitySettings: () => getAntigravitySettings(),
    saveAntigravitySettings: (...a: unknown[]) => saveAntigravitySettings(...a),
    exportProject: (...a: unknown[]) => exportProject(...a),
    exportAll: () => exportAll(),
    getBackupConfig: () => getBackupConfig(),
    saveBackupConfig: (...a: unknown[]) => saveBackupConfig(...a),
    backupNow: () => backupNow(),
    testBackupRemote: (...a: unknown[]) => testBackupRemote(...a),
    getNotificationRules: () => getNotificationRules(),
    saveNotificationRules: (...a: unknown[]) => saveNotificationRules(...a),
    zipImport: (...a: unknown[]) => zipImport(...a),
    getDigestSettings: () => getDigestSettings(),
    saveDigestSettings: (...a: unknown[]) => saveDigestSettings(...a),
    downloadBackup: () => downloadBackup(),
    importBackup: (...a: unknown[]) => importBackup(...a),
  },
  authApi: {
    changePassword: (...a: unknown[]) => authChangePassword(...a),
    logout: () => authLogout(),
  },
  usersApi: {
    list: () => usersList(),
    listInvites: () => usersListInvites(),
    create: (...a: unknown[]) => usersCreate(...a),
    createInvite: (...a: unknown[]) => usersCreateInvite(...a),
    update: (...a: unknown[]) => usersUpdate(...a),
    removeInvite: (...a: unknown[]) => usersRemoveInvite(...a),
    remove: (...a: unknown[]) => usersRemove(...a),
  },
  auditApi: {
    list: (...a: unknown[]) => auditList(...a),
    export: () => auditExport(),
  },
  apiTokensApi: {
    list: () => apiTokensList(),
    create: (...a: unknown[]) => apiTokensCreate(...a),
    revoke: (...a: unknown[]) => apiTokensRevoke(...a),
  },
  integrationsApi: {
    list: () => integrationsList(),
    create: (...a: unknown[]) => integrationsCreate(...a),
    remove: (...a: unknown[]) => integrationsRemove(...a),
    sync: (...a: unknown[]) => integrationsSync(...a),
  },
  projectsApi: {
    list: () => projectsList(),
    link: (...a: unknown[]) => projectsLink(...a),
    create: (...a: unknown[]) => projectsCreate(...a),
    seedReset: () => projectsSeedReset(),
  },
  claudeProjectsApi: { scan: () => claudeScan() },
  antigravityProjectsApi: { scan: () => antigravityScan() },
  notifyApi: {
    getChannels: () => notifyGetChannels(),
    createChannel: (...a: unknown[]) => notifyCreateChannel(...a),
    deleteChannel: (...a: unknown[]) => notifyDeleteChannel(...a),
    toggleChannel: (...a: unknown[]) => notifyToggleChannel(...a),
    getProjectPrefs: () => notifyGetProjectPrefs(),
    saveProjectPref: (...a: unknown[]) => notifySaveProjectPref(...a),
    testNotification: () => notifyTest(),
  },
  templatesApi: {
    list: () => templatesList(),
    create: (...a: unknown[]) => templatesCreate(...a),
    update: (...a: unknown[]) => templatesUpdate(...a),
    remove: (...a: unknown[]) => templatesRemove(...a),
  },
}))

const adminUser: AuthUser = { id: 'u1', username: 'admin', role: 'admin' }

const settingsData: SettingsData = {
  ai: { backend: 'ollama', chatModel: 'mistral', embedModel: 'nomic-embed-text', ollamaUrl: 'http://localhost:11434' },
  auth: { enabled: true, devMode: false },
}

function renderSettings(currentUser: AuthUser | null = adminUser) {
  render(<SettingsPage onLogout={vi.fn()} currentUser={currentUser} density="normal" setDensity={vi.fn()} />)
}

function goTab(label: string) {
  fireEvent.click(screen.getByText(label))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })

  settingsGet.mockResolvedValue(settingsData)
  projectsList.mockResolvedValue([])
  usersList.mockResolvedValue([])
  usersListInvites.mockResolvedValue([])
  auditList.mockResolvedValue({ items: [], total: 0 })
  apiTokensList.mockResolvedValue([])
  integrationsList.mockResolvedValue([])
  getLdapSettings.mockResolvedValue(null)
  getClaudeSettings.mockResolvedValue({ scan_root: null })
  getAntigravitySettings.mockResolvedValue({ scan_root: null })
  getBackupConfig.mockResolvedValue({
    path: null, schedule: 'off', last_backup_at: null, retention_count: 30,
    remote: { type: 'none' }, last_remote_backup_at: null, last_remote_backup_error: null,
  } satisfies BackupConfig)
  getNotificationRules.mockResolvedValue({
    stale_threshold_days: 14, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true,
  })
  notifyGetChannels.mockResolvedValue([])
  notifyGetProjectPrefs.mockResolvedValue([])
  getDigestSettings.mockResolvedValue({ enabled: false, time: '09:00' })
  templatesList.mockResolvedValue([])
})

describe('SettingsPage — General tab', () => {
  it('shows AI backend info from settingsApi.get()', async () => {
    renderSettings()
    expect(await screen.findByText('ollama')).toBeInTheDocument()
    expect(screen.getByText('mistral')).toBeInTheDocument()
  })

  it('clicking a font size option calls setDensity', async () => {
    const setDensity = vi.fn()
    render(<SettingsPage onLogout={vi.fn()} currentUser={adminUser} density="normal" setDensity={setDensity} />)
    await screen.findByText('ollama')
    fireEvent.click(screen.getByText('Large'))
    expect(setDensity).toHaveBeenCalledWith('comfy')
  })
})

describe('SettingsPage — Account tab', () => {
  it('changes password via the account form', async () => {
    authChangePassword.mockResolvedValue({ ok: true })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Account')

    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'old-pass' } })
    fireEvent.change(screen.getByPlaceholderText('New password (min 6)'), { target: { value: 'new-pass' } })
    fireEvent.click(screen.getByText('Update'))

    await waitFor(() => expect(authChangePassword).toHaveBeenCalledWith('old-pass', 'new-pass'))
  })

  it('generates an API token', async () => {
    apiTokensCreate.mockResolvedValue({ id: 't1', name: 'ci', token_prefix: 'dbrn_abc', token: 'dbrn_abcdef123', last_used_at: null, expires_at: null, created_at: '2026-01-01' } satisfies ApiToken & { token: string })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Account')

    fireEvent.click(await screen.findByText('+ Generate token'))
    fireEvent.change(screen.getByPlaceholderText('e.g. reembed script'), { target: { value: 'ci' } })
    fireEvent.click(screen.getByText('Generate'))

    await waitFor(() => expect(apiTokensCreate).toHaveBeenCalledWith({ name: 'ci', expiresInDays: undefined }))
    expect(await screen.findByText('dbrn_abcdef123')).toBeInTheDocument()
  })
})

describe('SettingsPage — Users & Auth tab', () => {
  const user: User = { id: 'user-1', username: 'jdoe', email: null, role: 'member', is_active: true, is_ldap: false, created_at: '2026-01-01' }

  it('lists active users', async () => {
    usersList.mockResolvedValue([user])
    renderSettings()
    await screen.findByText('ollama')
    goTab('Users & Auth')
    expect(await screen.findByText('jdoe')).toBeInTheDocument()
  })

  it('creates a new user directly', async () => {
    usersCreate.mockResolvedValue({ ...user, id: 'user-2', username: 'newbie' })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Users & Auth')
    await screen.findByText('+ Direct add')

    fireEvent.click(screen.getByText('+ Direct add'))
    fireEvent.change(screen.getByPlaceholderText('Username'), { target: { value: 'newbie' } })
    fireEvent.change(screen.getByPlaceholderText('Password (min 6)'), { target: { value: 'secretpw' } })
    fireEvent.click(screen.getByText('Create'))

    await waitFor(() => expect(usersCreate).toHaveBeenCalledWith({ username: 'newbie', password: 'secretpw', role: 'member', email: null }))
  })

  it('saves LDAP configuration', async () => {
    saveLdapSettings.mockResolvedValue({ ok: true })
    getLdapSettings.mockResolvedValue(null)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Users & Auth')

    fireEvent.change(await screen.findByPlaceholderText('ldap://ldap.company.com'), { target: { value: 'ldap://corp.example.com' } })
    fireEvent.click(screen.getByText('Save Config'))

    await waitFor(() => expect(saveLdapSettings).toHaveBeenCalledWith(expect.objectContaining({ url: 'ldap://corp.example.com' })))
  })
})

describe('SettingsPage — Data tab', () => {
  it('downloads a backup', async () => {
    downloadBackup.mockResolvedValue(undefined)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Data')

    fireEvent.click(screen.getByText('Download'))
    await waitFor(() => expect(downloadBackup).toHaveBeenCalled())
  })

  it('runs a dry-run import after choosing a file', async () => {
    importBackup.mockResolvedValue({ dry_run: true, summary: { documents: { created: 3, skipped: 1 } } })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Data')

    const file = new File(['{"documents":[]}'], 'backup.json', { type: 'application/json' })
    const input = document.querySelector('input[type="file"][accept=".json"]') as HTMLInputElement
    await fireEvent.change(input, { target: { files: [file] } })

    fireEvent.click(await screen.findByText('Dry Run'))
    await waitFor(() => expect(importBackup).toHaveBeenCalledWith({ documents: [] }, true))
    expect(await screen.findByText('Dry run preview')).toBeInTheDocument()
  })

  it('saves the scheduled backup path and schedule', async () => {
    saveBackupConfig.mockResolvedValue({
      path: '/backups', schedule: 'daily', last_backup_at: null, retention_count: 30,
      remote: { type: 'none' }, last_remote_backup_at: null, last_remote_backup_error: null,
    } satisfies BackupConfig)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Data')

    fireEvent.change(await screen.findByPlaceholderText('e.g. C:\\Users\\you\\Backups'), { target: { value: '/backups' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(saveBackupConfig).toHaveBeenCalledWith(expect.objectContaining({ path: '/backups' })))
  })

  it('resets to seed data from the danger zone after confirming', async () => {
    projectsSeedReset.mockResolvedValue({ message: 'done' })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Data')

    fireEvent.click(await screen.findByText('Reset seed'))
    await waitFor(() => expect(projectsSeedReset).toHaveBeenCalled())
  })
})

describe('SettingsPage — Notifications tab', () => {
  it('saves notification rules', async () => {
    saveNotificationRules.mockResolvedValue({
      stale_threshold_days: 21, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true,
    })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Notifications')

    fireEvent.click(await screen.findByText('Save Rules'))
    await waitFor(() => expect(saveNotificationRules).toHaveBeenCalled())
  })

  it('adds a notification channel', async () => {
    const created: NotificationChannel = { id: 'c1', user_id: 'u1', name: 'Discord', apprise_url: 'discord://id/token', enabled: true, created_at: '2026-01-01' }
    notifyCreateChannel.mockResolvedValue(created)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Notifications')

    fireEvent.change(await screen.findByPlaceholderText('Channel Name (e.g. Discord Alert)'), { target: { value: 'Discord' } })
    fireEvent.change(screen.getByPlaceholderText('Apprise URL (e.g. discord://id/token)'), { target: { value: 'discord://id/token' } })
    fireEvent.click(screen.getByText('Add Channel'))

    await waitFor(() => expect(notifyCreateChannel).toHaveBeenCalledWith({ name: 'Discord', apprise_url: 'discord://id/token', enabled: true }))
  })
})

describe('SettingsPage — Integrations tab', () => {
  it('adds an external issue sync integration', async () => {
    const created: Integration = { id: 'i1', provider: 'github', project_id: 'p1', external_project_id: 'org/repo', has_token: false, last_synced_at: null, config: {} }
    projectsList.mockResolvedValue([{ id: 'p1', name: 'PlayCru', short_name: 'playcru', description: '', color: '#000', status: 'active', tech_stack: [], type: 'mobile', repo_url: null, fs_path: null, created_at: '2026-01-01', doc_count: 0, issue_count: 0, command_count: 0, release_count: 0 }])
    integrationsCreate.mockResolvedValue(created)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Integrations')

    fireEvent.click(await screen.findByText('+ Add integration'))
    fireEvent.change(screen.getByText('Select project...').closest('select') as HTMLSelectElement, { target: { value: 'p1' } })
    fireEvent.change(screen.getByPlaceholderText('facebook/react'), { target: { value: 'org/repo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Integration' }))

    await waitFor(() => expect(integrationsCreate).toHaveBeenCalledWith(expect.objectContaining({ project_id: 'p1', external_project_id: 'org/repo' })))
  })

  it('scans for Claude Code projects and shows candidates', async () => {
    getClaudeSettings.mockResolvedValue({ scan_root: '/home/me/projects' })
    const candidate: ScanCandidate = { path: '/home/me/projects/foo', name: 'Foo', lastUpdated: null, lastSessionDate: null, phases: [], overallPct: 40 }
    claudeScan.mockResolvedValue({ candidates: [candidate] })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Integrations')

    const scanButtons = await screen.findAllByText('Scan Now')
    fireEvent.click(scanButtons[0]) // Claude Code section renders before Antigravity's
    expect(await screen.findByText('Foo')).toBeInTheDocument()
  })
})

describe('SettingsPage — Templates tab', () => {
  it('creates a new issue template', async () => {
    const created: Template = { id: 'tpl-1', project_id: null, type: 'issue', name: 'Bug report', description: '', body: {}, is_builtin: false, created_at: '2026-01-01', project_name: null, project_color: null }
    templatesCreate.mockResolvedValue(created)
    renderSettings()
    await screen.findByText('ollama')
    goTab('Templates')

    fireEvent.click(await screen.findByText('+ New Template'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Frontend Bug Report'), { target: { value: 'Bug report' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(templatesCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Bug report', type: 'issue' })))
  })
})

describe('SettingsPage — Audit Log tab', () => {
  it('lists audit events and exports CSV', async () => {
    const event: AuditEvent = { id: 'e1', user_id: 'u1', username: 'admin', entity_type: 'project', entity_id: 'p1', entity_name: 'PlayCru', action: 'update', metadata: null, created_at: '2026-01-01T00:00:00Z' }
    auditList.mockResolvedValue({ items: [event], total: 1 })
    renderSettings()
    await screen.findByText('ollama')
    goTab('Audit Log')

    expect(await screen.findByText('PlayCru')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Export CSV'))
    await waitFor(() => expect(auditExport).toHaveBeenCalled())
  })
})

describe('SettingsPage — non-admin user', () => {
  it('hides admin-only tabs', async () => {
    const invite: Invite = { id: 'inv-1', email: 'x@y.com', role: 'member', expires_at: '2026-02-01', created_at: '2026-01-01' }
    usersListInvites.mockResolvedValue([invite])
    renderSettings({ id: 'u2', username: 'viewer', role: 'viewer' })
    await screen.findByText('ollama')
    expect(screen.queryByText('Users & Auth')).not.toBeInTheDocument()
    expect(screen.queryByText('Audit Log')).not.toBeInTheDocument()
  })
})

// Typed fetch wrapper. All API calls go through here.

export type Paged<T> = { items: T[]; total: number }

const BASE = '/api'

const TOKEN_KEY = 'devbrain_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t) }
function clearToken()        { localStorage.removeItem(TOKEN_KEY) }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    ...init,
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('devbrain:unauthorized'))
    throw new Error('Unauthorized')
  }
  const json = await res.json() as { data?: T; error?: string }
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`)
  return json.data as T
}

// ── Auth ──────────────────────────────────────────────────────────────────

export type AuthUser = { id: string; username: string; role: 'admin' | 'editor' | 'viewer' }

const USER_KEY = 'devbrain_user'
export function getCachedUser(): AuthUser | null {
  try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') } catch { return null }
}
function setCachedUser(u: AuthUser) { localStorage.setItem(USER_KEY, JSON.stringify(u)) }
function clearCachedUser()          { localStorage.removeItem(USER_KEY) }

export const authApi = {
  login: async (username: string, password: string): Promise<{ devMode: boolean; user: AuthUser }> => {
    const res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const json = await res.json() as { data?: { token: string; devMode: boolean; user: AuthUser }; error?: string }
    if (!res.ok) throw new Error(json.error ?? 'Login failed')
    setToken(json.data!.token)
    setCachedUser(json.data!.user)
    return { devMode: json.data!.devMode, user: json.data!.user }
  },

  register: async (username: string, password: string, role?: string): Promise<{ user: AuthUser }> => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    })
    const json = await res.json() as { data?: { token: string; user: AuthUser }; error?: string }
    if (!res.ok) throw new Error(json.error ?? 'Registration failed')
    setToken(json.data!.token)
    setCachedUser(json.data!.user)
    return { user: json.data!.user }
  },

  me: async (): Promise<{ authed: boolean; devMode: boolean; user?: AuthUser }> => {
    const token = getToken()
    const res = await fetch(`${BASE}/auth/me`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) return { authed: false, devMode: false }
    const json = await res.json() as { data?: { authed: boolean; devMode: boolean; user?: AuthUser } }
    if (json.data?.user) setCachedUser(json.data.user)
    return json.data ?? { authed: false, devMode: false }
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  logout: () => { clearToken(); clearCachedUser() },
}

// ── Users ─────────────────────────────────────────────────────────────────

export type User = {
  id:          string
  username:    string
  email:       string | null
  role:        'admin' | 'editor' | 'viewer'
  is_ldap:     boolean
  created_at:  string
}

export type UserInput = Pick<User, 'username' | 'role'> & { password: string; email?: string }

export type ProjectMember = {
  id:          string
  username:    string
  email:       string | null
  global_role: string
  member_role: 'admin' | 'editor' | 'viewer'
  added_at:    string
}

export const usersApi = {
  list:   ()                               => request<User[]>('/users'),
  create: (body: UserInput)               => request<User>('/users', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<UserInput> & { password?: string }) =>
    request<User>(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string)                    => request<{ deleted: { id: string; username: string } }>(`/users/${id}`, { method: 'DELETE' }),
  listProjectMembers: (projectId: string) => request<ProjectMember[]>(`/projects/${projectId}/members`),
  addProjectMember:   (projectId: string, userId: string, role: string) =>
    request<ProjectMember>(`/projects/${projectId}/members`, { method: 'POST', body: JSON.stringify({ user_id: userId, role }) }),
  updateProjectMember: (projectId: string, userId: string, role: string) =>
    request<ProjectMember>(`/projects/${projectId}/members/${userId}`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeProjectMember: (projectId: string, userId: string) =>
    request<{ deleted: object }>(`/projects/${projectId}/members/${userId}`, { method: 'DELETE' }),
}

// ── Audit ─────────────────────────────────────────────────────────────────

export type AuditEvent = {
  id:          string
  user_id:     string | null
  username:    string | null
  entity_type: string
  entity_id:   string
  entity_name: string | null
  action:      'create' | 'update' | 'delete'
  metadata:    Record<string, unknown> | null
  created_at:  string
}

export const auditApi = {
  list: (params?: { entityType?: string; entityId?: string; userId?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.entityType) qs.set('entityType', params.entityType)
    if (params?.entityId)   qs.set('entityId',   params.entityId)
    if (params?.userId)     qs.set('userId',      params.userId)
    if (params?.limit  != null) qs.set('limit',  String(params.limit))
    if (params?.offset != null) qs.set('offset', String(params.offset))
    const q = qs.toString()
    return request<Paged<AuditEvent>>(`/audit${q ? `?${q}` : ''}`)
  },
}

// ── Projects ──────────────────────────────────────────────────────────────

export type Project = {
  id:            string
  name:          string
  short_name:    string
  description:   string
  color:         string
  status:        'active' | 'paused' | 'planning'
  tech_stack:    string[]
  type:          'mobile' | 'web' | 'desktop' | 'fintech' | 'tool'
  repo_url:      string | null
  created_at:    string
  doc_count:     number
  issue_count:   number
  command_count: number
  release_count: number
}

export type ProjectInput = Omit<Project, 'id' | 'created_at' | 'doc_count' | 'issue_count' | 'command_count' | 'release_count'>

export const projectsApi = {
  list:      ()                              => request<Project[]>('/projects'),
  get:       (id: string)                   => request<Project>(`/projects/${id}`),
  create:    (body: ProjectInput)            => request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  update:    (id: string, body: Partial<ProjectInput>) =>
    request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:    (id: string)                   => request<{ deleted: { id: string; name: string } }>(`/projects/${id}`, { method: 'DELETE' }),
  seedReset: ()                             => request<{ message: string }>('/projects/seed/reset', { method: 'POST' }),
}

// ── Documents ─────────────────────────────────────────────────────────────

export type DocMeta = {
  id:             string
  project_id:     string | null
  title:          string
  file_type:      'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'url'
  tags:           string[]
  source:         string
  content_hash:   string | null
  created_at:     string
  content_length: number
  chunk_count:    number
  project_name:   string | null
  project_color:  string | null
}

export type DocDetail = DocMeta & { content: string }

export const documentsApi = {
  list: (params?: { projectId?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.projectId)        qs.set('projectId', params.projectId)
    if (params?.search)           qs.set('search', params.search)
    if (params?.limit  != null)   qs.set('limit',  String(params.limit))
    if (params?.offset != null)   qs.set('offset', String(params.offset))
    const q = qs.toString()
    return request<Paged<DocMeta>>(`/documents${q ? `?${q}` : ''}`)
  },
  get: (id: string) => request<DocDetail>(`/documents/${id}`),

  upload: async (file: File, projectId?: string, tags: string[] = []): Promise<DocMeta> => {
    const fd = new FormData()
    fd.append('file', file)
    if (projectId) fd.append('projectId', projectId)
    fd.append('tags', JSON.stringify(tags))
    const res = await fetch('/api/documents', { method: 'POST', body: fd })
    const json = await res.json() as { data?: DocMeta; error?: string; existingId?: string }
    if (!res.ok) {
      const err = new Error(json.error ?? `Upload failed: ${res.status}`) as Error & { existingId?: string }
      err.existingId = json.existingId
      throw err
    }
    return json.data!
  },

  importUrl: (url: string, projectId?: string, tags: string[] = []) =>
    request<DocMeta>('/documents/url', {
      method: 'POST',
      body: JSON.stringify({ url, projectId: projectId ?? null, tags }),
    }),

  patch: (id: string, body: { title?: string; tags?: string[]; projectId?: string | null }) =>
    request<DocDetail>(`/documents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string) =>
    request<{ deleted: { id: string; title: string } }>(`/documents/${id}`, { method: 'DELETE' }),
}

// ── Issues ────────────────────────────────────────────────────────────────

export type IssueStep = {
  id:          string
  order:       number
  instruction: string
  done:        boolean
}

export type IssueNote = {
  id:         string
  content:    string
  created_at: string
}

export type Issue = {
  id:                  string
  project_id:          string | null
  title:               string
  description:         string
  status:              'open' | 'investigating' | 'resolved' | 'wont-fix'
  priority:            'low' | 'medium' | 'high' | 'critical'
  investigation_steps: IssueStep[]
  notes:               IssueNote[]
  linked_docs:         string[]
  linked_commands:     string[]
  resolution:          string
  tags:                string[]
  created_at:          string
  resolved_at:         string | null
  project_name:        string | null
  project_color:       string | null
}

export type IssueInput = Pick<Issue, 'title' | 'description' | 'status' | 'priority' | 'tags'> & {
  project_id?: string | null
  investigation_steps?: IssueStep[]
}

export type RelatedIssue = {
  id:            string
  title:         string
  status:        string
  priority:      string
  project_name:  string | null
  project_color: string | null
}

export type RelatedDoc = {
  doc_id:        string
  doc_title:     string
  excerpt:       string
  score:         number
  project_name:  string | null
  project_color: string | null
  file_type:     string
}

export type RelatedCommand = {
  id:            string
  title:         string
  command:       string
  language:      string
  description:   string
  score:         number
  project_name:  string | null
  project_color: string | null
}

export const issuesApi = {
  list: (params?: { projectId?: string; status?: string; priority?: string; search?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.projectId)      qs.set('projectId', params.projectId)
    if (params?.status)         qs.set('status',    params.status)
    if (params?.priority)       qs.set('priority',  params.priority)
    if (params?.search)         qs.set('search',    params.search)
    if (params?.limit  != null) qs.set('limit',     String(params.limit))
    if (params?.offset != null) qs.set('offset',    String(params.offset))
    const q = qs.toString()
    return request<Paged<Issue>>(`/issues${q ? `?${q}` : ''}`)
  },
  related: (q: string) =>
    request<RelatedIssue[]>(`/issues/related?q=${encodeURIComponent(q)}`),
  get:       (id: string)                             => request<Issue>(`/issues/${id}`),
  create:    (body: IssueInput)                       => request<Issue>('/issues', { method: 'POST', body: JSON.stringify(body) }),
  update:    (id: string, body: Partial<IssueInput> & { investigation_steps?: IssueStep[]; resolution?: string }) =>
    request<Issue>(`/issues/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:    (id: string)                             => request<{ deleted: { id: string; title: string } }>(`/issues/${id}`, { method: 'DELETE' }),
  addNote:   (id: string, content: string)            => request<Issue>(`/issues/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteNote:(id: string, noteId: string)             => request<Issue>(`/issues/${id}/notes/${noteId}`, { method: 'DELETE' }),
  summarize:       (id: string) => request<{ summary: string }>(`/issues/${id}/summarize`, { method: 'POST' }),
  suggestSteps:    (id: string) => request<{ steps: string[] }>(`/issues/${id}/suggest-steps`, { method: 'POST' }),
  relatedDocs:     (id: string) => request<RelatedDoc[]>(`/issues/${id}/related-docs`),
  relatedCommands: (id: string) => request<RelatedCommand[]>(`/issues/${id}/related-commands`),
}

// ── Tasks ─────────────────────────────────────────────────────────────────

export type Task = {
  id:            string
  project_id:    string | null
  title:         string
  description:   string
  status:        'todo' | 'in_progress' | 'done' | 'cancelled'
  priority:      'low' | 'medium' | 'high' | 'critical'
  due_date:      string | null
  tags:          string[]
  created_at:    string
  done_at:       string | null
  project_name:  string | null
  project_color: string | null
}

export type TaskInput = Pick<Task, 'title' | 'description' | 'status' | 'priority' | 'tags'> & {
  project_id?: string | null
  due_date?:   string | null
}

// ── Runbooks ──────────────────────────────────────────────────────────────

export type RunbookStep = {
  id:          string
  order:       number
  instruction: string
  command?:    string
  note?:       string
}

export type Runbook = {
  id:            string
  project_id:    string | null
  title:         string
  steps:         RunbookStep[]
  tags:          string[]
  last_used_at:  string | null
  created_at:    string
  project_name:  string | null
  project_color: string | null
}

export type RunbookInput = Pick<Runbook, 'title' | 'tags' | 'steps'> & {
  project_id?: string | null
}

export const runbooksApi = {
  list: (params?: { projectId?: string; search?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    if (params?.search)    qs.set('search',    params.search)
    const q = qs.toString()
    return request<Runbook[]>(`/runbooks${q ? `?${q}` : ''}`)
  },
  get:    (id: string)                          => request<Runbook>(`/runbooks/${id}`),
  create: (body: RunbookInput)                  => request<Runbook>('/runbooks', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<RunbookInput>) =>
    request<Runbook>(`/runbooks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove: (id: string)                          => request<{ deleted: { id: string; title: string } }>(`/runbooks/${id}`, { method: 'DELETE' }),
  use:    (id: string)                          => request<Runbook>(`/runbooks/${id}/use`, { method: 'POST' }),
}

export const tasksApi = {
  list: (params?: { projectId?: string; status?: string; priority?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    if (params?.status)    qs.set('status',    params.status)
    if (params?.priority)  qs.set('priority',  params.priority)
    const q = qs.toString()
    return request<Task[]>(`/tasks${q ? `?${q}` : ''}`)
  },
  create: (body: TaskInput)                       => request<Task>('/tasks',       { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<TaskInput>)  => request<Task>(`/tasks/${id}`, { method: 'PUT',  body: JSON.stringify(body) }),
  remove:   (id: string)                            => request<{ deleted: { id: string; title: string } }>(`/tasks/${id}`, { method: 'DELETE' }),
  importMd: (content: string, projectId?: string)  =>
    request<{ created: number; skipped: number; total: number }>('/tasks/import-md', {
      method: 'POST',
      body: JSON.stringify({ content, projectId }),
    }),
}

// ── Commands ──────────────────────────────────────────────────────────────

export type Command = {
  id:            string
  project_id:    string | null
  title:         string
  command:       string
  language:      string
  description:   string
  tags:          string[]
  is_favorite:   boolean
  namespace:     'personal' | 'team'
  created_by:    string | null
  last_used:     string | null
  created_at:    string
  project_name:  string | null
  project_color: string | null
}

export type CommandInput = Pick<Command, 'title' | 'command' | 'language' | 'description' | 'tags' | 'is_favorite' | 'namespace'> & {
  project_id?: string | null
}

export const commandsApi = {
  list: (params?: { projectId?: string; language?: string; search?: string; favorite?: boolean; namespace?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams()
    if (params?.projectId)         qs.set('projectId', params.projectId)
    if (params?.language)          qs.set('language',  params.language)
    if (params?.search)            qs.set('search',    params.search)
    if (params?.namespace)         qs.set('namespace', params.namespace)
    if (params?.favorite === true) qs.set('favorite',  'true')
    if (params?.limit  != null)    qs.set('limit',     String(params.limit))
    if (params?.offset != null)    qs.set('offset',    String(params.offset))
    const q = qs.toString()
    return request<Paged<Command>>(`/commands${q ? `?${q}` : ''}`)
  },
  get:     (id: string)                       => request<Command>(`/commands/${id}`),
  create:  (body: CommandInput)               => request<Command>('/commands', { method: 'POST', body: JSON.stringify(body) }),
  update:  (id: string, body: Partial<CommandInput>) =>
    request<Command>(`/commands/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:  (id: string)                       => request<{ deleted: { id: string; title: string } }>(`/commands/${id}`, { method: 'DELETE' }),
  use:     (id: string)                       => request<Command>(`/commands/${id}/use`, { method: 'POST' }),
  explain: (id: string)                       => request<{ explanation: string }>(`/commands/${id}/explain`, { method: 'POST' }),
}

// ── Releases ──────────────────────────────────────────────────────────────

export type Release = {
  id:               string
  project_id:       string
  version:          string
  date:             string   // YYYY-MM-DD
  type:             'major' | 'minor' | 'patch' | 'hotfix'
  features:         string[]
  fixes:            string[]
  breaking_changes: string[]
  notes:            string
  linked_issues:    string[]
  created_at:       string
  project_name:     string
  project_color:    string
}

export type ReleaseInput = Omit<Release, 'id' | 'created_at' | 'project_name' | 'project_color'>

export type AiReleaseNotes = {
  features:         string[]
  fixes:            string[]
  breaking_changes: string[]
  notes:            string
}

export const releasesApi = {
  list:       (params?: { projectId?: string }) => {
    const qs = new URLSearchParams()
    if (params?.projectId) qs.set('projectId', params.projectId)
    const q = qs.toString()
    return request<Release[]>(`/releases${q ? `?${q}` : ''}`)
  },
  get:        (id: string)                          => request<Release>(`/releases/${id}`),
  create:     (body: ReleaseInput)                  => request<Release>('/releases', { method: 'POST', body: JSON.stringify(body) }),
  update:     (id: string, body: Partial<Omit<ReleaseInput, 'project_id'>>) =>
    request<Release>(`/releases/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:     (id: string)                          => request<{ deleted: { id: string; version: string } }>(`/releases/${id}`, { method: 'DELETE' }),
  aiGenerate: (commits: string)                     => request<AiReleaseNotes>('/releases/ai-generate', { method: 'POST', body: JSON.stringify({ commits }) }),
  qa:         (id: string, question: string)        => request<{ answer: string }>(`/releases/${id}/qa`, { method: 'POST', body: JSON.stringify({ question }) }),
  compare:    (id1: string, id2: string)            => request<{ summary: string }>('/releases/compare',  { method: 'POST', body: JSON.stringify({ id1, id2 }) }),
  importGit:  (body: { commits: string; project_id: string; version: string; date?: string; type?: string }) =>
    request<Release>('/releases/import-git', { method: 'POST', body: JSON.stringify(body) }),
}

// ── Search ────────────────────────────────────────────────────────────────

export type SearchResult = {
  type:          'doc' | 'issue' | 'command' | 'release' | 'runbook'
  id:            string
  title:         string
  subtype:       string | null
  project_name:  string | null
  project_color: string | null
  body?:         string
}

export type SearchResults = {
  docs:     SearchResult[]
  issues:   SearchResult[]
  commands: SearchResult[]
  releases: SearchResult[]
  runbooks: SearchResult[]
}

export const searchApi = {
  search: (q: string, projectId?: string | null) => {
    const qs = new URLSearchParams({ q })
    if (projectId) qs.set('projectId', projectId)
    return request<SearchResults>(`/search?${qs}`)
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export type DashboardStats = {
  docs:        number
  openIssues:  number
  totalIssues: number
  commands:    number
  releases:    number
  runbooks:    number
}

export type DashboardIssue = {
  id:            string
  title:         string
  status:        string
  priority:      string
  created_at:    string
  step_count:    number
  project_name:  string | null
  project_color: string | null
}

export type DashboardCommand = {
  id:            string
  title:         string
  command:       string
  language:      string
  project_name:  string | null
  project_color: string | null
}

export type DashboardRelease = {
  id:            string
  version:       string
  date:          string
  type:          string
  feature_count: number
  fix_count:     number
  project_id:    string
  project_name:  string
  project_color: string
}

export type DashboardProject = {
  id:               string
  name:             string
  color:            string
  status:           string
  type:             string
  description:      string
  doc_count:        number
  open_issue_count: number
  command_count:    number
  release_count:    number
}

export type DashboardActivity = {
  type:          'doc' | 'issue' | 'command' | 'release' | 'runbook'
  id:            string
  label:         string
  project_name:  string | null
  project_color: string | null
  created_at:    string
}

export type DashboardData = {
  stats:            DashboardStats
  openIssues:       DashboardIssue[]
  favoriteCommands: DashboardCommand[]
  recentReleases:   DashboardRelease[]
  projects:         DashboardProject[]
  activity:         DashboardActivity[]
}

export const dashboardApi = {
  get: (projectId?: string | null) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    return request<DashboardData>(`/dashboard${qs}`)
  }
}

// ── Chat / RAG ────────────────────────────────────────────────────────────

export type ChatCitation = {
  index:         number
  documentId:    string
  documentTitle: string
  chunkIndex:    number
  score:         number
  excerpt:       string
}

export type ChatScope = 'all' | 'project' | 'document'

export async function chatStream(
  question:   string,
  scope:      ChatScope,
  projectId?: string | null,
  documentId?: string | null,
  onCitations?: (citations: ChatCitation[]) => void,
  onChunk?:     (text: string) => void,
): Promise<void> {
  const token = getToken()
  const res = await fetch('/api/chat', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:    JSON.stringify({
      question,
      projectId:  scope === 'all' ? null : (projectId ?? null),
      documentId: scope === 'document' ? (documentId ?? null) : null,
    }),
  })

  if (!res.ok || !res.body) throw new Error(`Chat request failed: ${res.status}`)

  const reader  = res.body.getReader()
  const decoder = new TextDecoder()
  let   buf     = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    const lines = buf.split('\n')
    buf = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') return
      try {
        const evt = JSON.parse(raw) as { type: string; [k: string]: unknown }
        if (evt.type === 'citations') onCitations?.(evt.citations as ChatCitation[])
        if (evt.type === 'chunk')     onChunk?.(evt.text as string)
        if (evt.type === 'error')     throw new Error(evt.message as string)
      } catch { /* skip malformed */ }
    }
  }
}

// ── AI Task ───────────────────────────────────────────────────────────────

export type OutputFormat = 'markdown' | 'json' | 'bullets' | 'table' | 'code' | 'summary' | 'plaintext'

export const aitaskApi = {
  run: (task: string, format: OutputFormat) =>
    request<{ result: string; format: OutputFormat }>('/aitask', {
      method: 'POST',
      body: JSON.stringify({ task, format, stream: false }),
    }),
}

// ── Settings ──────────────────────────────────────────────────────────────

export type SettingsData = {
  ai: {
    backend:    string
    chatModel:  string
    embedModel: string
    ollamaUrl:  string
  }
  auth: {
    enabled: boolean
    devMode: boolean
  }
}

export type ImportSummary = {
  dry_run: boolean
  summary: Record<string, { created: number; skipped: number }>
}

export const settingsApi = {
  get: () => request<SettingsData>('/settings'),
  importBackup: (body: unknown, dryRun = false) =>
    request<ImportSummary>(`/settings/import${dryRun ? '?dry_run=true' : ''}`, { method: 'POST', body: JSON.stringify(body) }),

  downloadBackup: async () => {
    const token = getToken()
    const res = await fetch(`${BASE}/settings/backup`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    if (!res.ok) throw new Error('Backup failed')
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `devbrain-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  },
}

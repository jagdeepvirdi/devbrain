// Typed fetch wrapper. All API calls go through here.

export type Paged<T> = { items: T[]; total: number }

const BASE = '/api'

// In-flight cache: deduplicate identical concurrent GET requests
const inflight = new Map<string, Promise<unknown>>()

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
    ...init,
  })
  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent('devbrain:unauthorized'))
    throw new Error('Unauthorized')
  }
  let json: { data?: T; error?: string }
  try {
    json = await res.json() as { data?: T; error?: string }
  } catch {
    throw new Error('Unexpected server response')
  }
  if (!res.ok) throw new Error(json.error ?? `Request failed: ${res.status}`)
  return json.data as T
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only deduplicate GETs with no abort signal (signal means the caller manages lifecycle)
  if ((!init?.method || init.method === 'GET') && !init?.signal) {
    const existing = inflight.get(path)
    if (existing) return existing as Promise<T>
    const p = _fetch<T>(path, init).finally(() => inflight.delete(path))
    inflight.set(path, p)
    return p
  }
  return _fetch<T>(path, init)
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
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    const json = await res.json() as { data?: { devMode: boolean; user: AuthUser }; error?: string }
    if (!res.ok) throw new Error(json.error ?? 'Login failed')
    setCachedUser(json.data!.user)
    return { devMode: json.data!.devMode, user: json.data!.user }
  },

  register: async (username: string, password: string, role?: string): Promise<{ user: AuthUser }> => {
    const res = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    })
    const json = await res.json() as { data?: { user: AuthUser }; error?: string }
    if (!res.ok) throw new Error(json.error ?? 'Registration failed')
    setCachedUser(json.data!.user)
    return { user: json.data!.user }
  },

  me: async (): Promise<{ authed: boolean; devMode: boolean; user?: AuthUser }> => {
    const res = await fetch(`${BASE}/auth/me`, { credentials: 'include' })
    if (!res.ok) return { authed: false, devMode: false }
    const json = await res.json() as { data?: { authed: boolean; devMode: boolean; user?: AuthUser } }
    if (json.data?.user) setCachedUser(json.data.user)
    return json.data ?? { authed: false, devMode: false }
  },

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),

  logout: () => {
    fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {})
    clearCachedUser()
  },
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
  fs_path:       string | null
  created_at:    string
  doc_count:     number
  issue_count:   number
  command_count: number
  release_count: number
}

export type ProjectInput = Omit<Project, 'id' | 'created_at' | 'doc_count' | 'issue_count' | 'command_count' | 'release_count' | 'fs_path'>

export const projectsApi = {
  list:      ()                              => request<Project[]>('/projects'),
  get:       (id: string)                   => request<Project>(`/projects/${id}`),
  create:    (body: ProjectInput)            => request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  update:    (id: string, body: Partial<ProjectInput>) =>
    request<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:    (id: string)                   => request<{ deleted: { id: string; name: string } }>(`/projects/${id}`, { method: 'DELETE' }),
  seedReset: ()                             => request<{ message: string }>('/projects/seed/reset', { method: 'POST' }),
  link:      (id: string, fsPath: string | null) =>
    request<Project>(`/projects/${id}/link`, { method: 'PUT', body: JSON.stringify({ fs_path: fsPath }) }),
}

// ── Claude Projects / TASKS.md sync ──────────────────────────────────────

export type TaskItemData = {
  text:      string
  status:    'todo' | 'done' | 'in_progress' | 'blocked'
  doneDate?: string
}

export type TaskPhaseData = {
  name:  string
  total: number
  done:  number
  pct:   number
  items: TaskItemData[]
}

export type TaskTreeData = {
  projectId:   string
  lastUpdated: string | null
  phases:      TaskPhaseData[]
  overallPct:  number
  totalDone:   number
  totalItems:  number
}

export type ScanCandidate = {
  path:               string
  name:               string
  lastUpdated:        string | null
  lastSessionDate:    string | null
  phases:             { name: string; total: number; done: number; pct: number }[]
  overallPct:         number
  matchedProjectId?:  string
  matchedProjectName?: string
}

export type SessionStatus = 'active' | 'completed'

export type SessionSummaryData = {
  sessionId:     string
  folderName:    string
  date:          string
  started:       string
  ended?:        string
  status:        SessionStatus
  goals:         string[]
  workDone:      string[]
  decisions:     string[]
  openItems:     string[]
  workDoneCount: number
}

export type SessionDetailData = SessionSummaryData & { rawMarkdown: string }

export type SessionsPage = {
  sessions: SessionSummaryData[]
  total:    number
  page:     number
  limit:    number
}

export const claudeProjectsApi = {
  scan: () =>
    request<{ root: string; count: number; candidates: ScanCandidate[] }>('/claude-projects/scan', { method: 'POST' }),

  getTasks: (id: string) =>
    request<TaskTreeData>(`/claude-projects/${id}/tasks`),

  getSessions: (
    id:      string,
    params?: { status?: SessionStatus; q?: string; page?: number; limit?: number },
  ) => {
    const qs = new URLSearchParams()
    if (params?.status) qs.set('status', params.status)
    if (params?.q)      qs.set('q',      params.q)
    if (params?.page)   qs.set('page',   String(params.page))
    if (params?.limit)  qs.set('limit',  String(params.limit))
    const suffix = qs.toString() ? `?${qs}` : ''
    return request<SessionsPage>(`/claude-projects/${id}/sessions${suffix}`)
  },

  getSession: (id: string, sessionId: string) =>
    request<SessionDetailData>(`/claude-projects/${id}/sessions/${sessionId}`),

  watchTasks: (
    id:       string,
    onUpdate: (tree: TaskTreeData) => void,
  ): (() => void) => {
    const ctrl  = new AbortController()

    ;(async () => {
      try {
        const res = await fetch(`${BASE}/claude-projects/${id}/tasks/watch`, {
          credentials: 'include',
          signal:      ctrl.signal,
        })
        if (!res.ok || !res.body) return

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
            try { onUpdate(JSON.parse(line.slice(6)) as TaskTreeData) } catch { /* skip */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') console.error('watchTasks error', err)
      }
    })()

    return () => ctrl.abort()
  },
}

// ── Documents ─────────────────────────────────────────────────────────────

export type EmbeddingStatus = 'pending' | 'processing' | 'done' | 'failed'

export type DocMeta = {
  id:               string
  project_id:       string | null
  title:            string
  file_type:        'pdf' | 'docx' | 'md' | 'txt' | 'xlsx' | 'url'
  tags:             string[]
  source:           string
  content_hash:     string | null
  embedding_status: EmbeddingStatus
  created_at:       string
  content_length:   number
  chunk_count:      number
  project_name:     string | null
  project_color:    string | null
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
    const res = await fetch('/api/documents', { method: 'POST', credentials: 'include', body: fd })
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

  reembed: (id: string) =>
    request<{ id: string; embedding_status: EmbeddingStatus }>(`/documents/${id}/reembed`, { method: 'POST' }),

  suggestTags: (title: string, hint?: string) =>
    request<{ tags: string[] }>('/documents/suggest-tags', { method: 'POST', body: JSON.stringify({ title, hint }) }),
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
  linked_commits:      string[]
  resolution:          string
  pr_url:              string | null
  tags:                string[]
  summary:             string | null
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
  list: (params?: { projectId?: string; status?: string; priority?: string; search?: string; limit?: number; offset?: number; signal?: AbortSignal }) => {
    const qs = new URLSearchParams()
    if (params?.projectId)      qs.set('projectId', params.projectId)
    if (params?.status)         qs.set('status',    params.status)
    if (params?.priority)       qs.set('priority',  params.priority)
    if (params?.search)         qs.set('search',    params.search)
    if (params?.limit  != null) qs.set('limit',     String(params.limit))
    if (params?.offset != null) qs.set('offset',    String(params.offset))
    const q = qs.toString()
    return request<Paged<Issue>>(`/issues${q ? `?${q}` : ''}`, params?.signal ? { signal: params.signal } : undefined)
  },
  related: (q: string) =>
    request<RelatedIssue[]>(`/issues/related?q=${encodeURIComponent(q)}`),
  get:       (id: string)                             => request<Issue>(`/issues/${id}`),
  create:    (body: IssueInput)                       => request<Issue>('/issues', { method: 'POST', body: JSON.stringify(body) }),
  update:    (id: string, body: Partial<IssueInput> & { investigation_steps?: IssueStep[]; resolution?: string; pr_url?: string | null }) =>
    request<Issue>(`/issues/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:    (id: string)                             => request<{ deleted: { id: string; title: string } }>(`/issues/${id}`, { method: 'DELETE' }),
  addNote:   (id: string, content: string)            => request<Issue>(`/issues/${id}/notes`, { method: 'POST', body: JSON.stringify({ content }) }),
  deleteNote:(id: string, noteId: string)             => request<Issue>(`/issues/${id}/notes/${noteId}`, { method: 'DELETE' }),
  linkCommit:   (id: string, sha: string)             => request<string[]>(`/issues/${id}/commits`, { method: 'POST', body: JSON.stringify({ sha }) }),
  unlinkCommit: (id: string, sha: string)             => request<string[]>(`/issues/${id}/commits/${sha}`, { method: 'DELETE' }),
  summarize:       (id: string) => request<{ summary: string }>(`/issues/${id}/summarize`, { method: 'POST' }),
  suggestTags:     (title: string, description?: string) => request<{ tags: string[] }>('/issues/suggest-tags', { method: 'POST', body: JSON.stringify({ title, description }) }),
  suggestSteps:    (id: string) => request<{ steps: string[] }>(`/issues/${id}/suggest-steps`, { method: 'POST' }),
  relatedDocs:     (id: string) => request<RelatedDoc[]>(`/issues/${id}/related-docs`),
  relatedCommands: (id: string) => request<RelatedCommand[]>(`/issues/${id}/related-commands`),
  reembed:         (id: string) => request<{ id: string; embedding_status: EmbeddingStatus }>(`/issues/${id}/reembed`, { method: 'POST' }),
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
  explanation:   string | null
  created_at:    string
  project_name:  string | null
  project_color: string | null
}

export type CommandInput = Pick<Command, 'title' | 'command' | 'language' | 'description' | 'tags' | 'is_favorite' | 'namespace'> & {
  project_id?: string | null
}

export const commandsApi = {
  list: (params?: { projectId?: string; language?: string; search?: string; favorite?: boolean; namespace?: string; limit?: number; offset?: number; signal?: AbortSignal }) => {
    const qs = new URLSearchParams()
    if (params?.projectId)         qs.set('projectId', params.projectId)
    if (params?.language)          qs.set('language',  params.language)
    if (params?.search)            qs.set('search',    params.search)
    if (params?.namespace)         qs.set('namespace', params.namespace)
    if (params?.favorite === true) qs.set('favorite',  'true')
    if (params?.limit  != null)    qs.set('limit',     String(params.limit))
    if (params?.offset != null)    qs.set('offset',    String(params.offset))
    const q = qs.toString()
    return request<Paged<Command>>(`/commands${q ? `?${q}` : ''}`, params?.signal ? { signal: params.signal } : undefined)
  },
  get:     (id: string)                       => request<Command>(`/commands/${id}`),
  create:  (body: CommandInput)               => request<Command>('/commands', { method: 'POST', body: JSON.stringify(body) }),
  update:  (id: string, body: Partial<CommandInput>) =>
    request<Command>(`/commands/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  remove:  (id: string)                       => request<{ deleted: { id: string; title: string } }>(`/commands/${id}`, { method: 'DELETE' }),
  use:     (id: string)                       => request<Command>(`/commands/${id}/use`, { method: 'POST' }),
  explain: (id: string) => request<{ explanation: string }>(`/commands/${id}/explain`, { method: 'POST' }),
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
  draft: (body: { projectId: string; from: string; to: string; issueIds?: string[] }) =>
    request<ReleaseInput>('/releases/draft', { method: 'POST', body: JSON.stringify(body) }),
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

export type SearchSuggestion = {
  type:          'issue' | 'doc'
  id:            string
  title:         string
  project_name:  string | null
  project_color: string | null
}

export const searchApi = {
  search: (q: string, projectId?: string | null, limit?: number) => {
    const qs = new URLSearchParams({ q })
    if (projectId) qs.set('projectId', projectId)
    if (limit != null) qs.set('limit', String(limit))
    return request<SearchResults>(`/search?${qs}`)
  },
  suggestions: (projectId?: string | null) => {
    const qs = new URLSearchParams()
    if (projectId) qs.set('projectId', projectId)
    const q = qs.toString()
    return request<SearchSuggestion[]>(`/search/suggestions${q ? `?${q}` : ''}`)
  },
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

export type DashboardStatsV2 = {
  openByProject:    { id: string; name: string; color: string; open_count: number }[]
  avgResolution:    { id: string; name: string; color: string; avg_days: number }[]
  embeddingHealth:  { done: number; pending: number; failed: number; failedIds: string[] }
  commandsThisWeek: number
  staleIssues:      { id: string; title: string; priority: string; created_at: string; project_name: string | null; project_color: string | null }[]
}

export type DashboardActivityDay = {
  date:             string
  issues_opened:    number
  issues_resolved:  number
  docs_added:       number
  commands_added:   number
  total:            number
}

export const dashboardApi = {
  get: (projectId?: string | null) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    return request<DashboardData>(`/dashboard${qs}`)
  },
  statsV2: (projectId?: string | null) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    return request<DashboardStatsV2>(`/dashboard/stats${qs}`)
  },
  activity: (projectId?: string | null) => {
    const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
    return request<DashboardActivityDay[]>(`/dashboard/activity${qs}`)
  },
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
  const res = await fetch('/api/chat', {
    method:      'POST',
    credentials: 'include',
    headers:     { 'Content-Type': 'application/json' },
    body:        JSON.stringify({
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

// ── Git Integration ───────────────────────────────────────────────────────

export type GitCommit = {
  sha:      string
  full_sha: string
  message:  string
  author:   string
  date:     string
  url:      string
}

export type GitRepoConfig = {
  id:      string
  repo_url: string | null
  has_pat:  boolean
}

export const gitApi = {
  getRepo:    (projectId: string)                                           => request<GitRepoConfig>(`/git/${projectId}/repo`),
  saveRepo:   (projectId: string, body: { repo_url?: string; github_pat?: string }) =>
    request<GitRepoConfig>(`/git/${projectId}/repo`, { method: 'POST', body: JSON.stringify(body) }),
  listCommits: (projectId: string, limit = 20)                             =>
    request<GitCommit[]>(`/git/${projectId}/commits?limit=${limit}`),
  compare:     (projectId: string, base: string, head: string)             =>
    request<{ commits: string; count: number }>(`/git/${projectId}/compare?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`),
}

// ── Integrations ──────────────────────────────────────────────────────────

export type IntegrationsConfig = {
  jira:   { baseUrl: string; email: string; hasToken: boolean } | null
  linear: { hasKey: boolean } | null
}

export type JiraIssuePreview = { key: string; summary: string; priority: string; status: string }
export type LinearIssuePreview = { id: string; title: string; state: string }

export const integrationsApi = {
  getConfig: () => request<IntegrationsConfig>('/integrations/config'),

  saveJira: (body: { baseUrl: string; email: string; apiToken: string }) =>
    request<{ ok: boolean }>('/integrations/config/jira', { method: 'PUT', body: JSON.stringify(body) }),

  saveLinear: (apiKey: string) =>
    request<{ ok: boolean }>('/integrations/config/linear', { method: 'PUT', body: JSON.stringify({ apiKey }) }),

  jiraPreview: (body: { project_id?: string; jql?: string; max_results?: number }) =>
    request<{ total: number; issues: JiraIssuePreview[] }>('/integrations/jira/preview', { method: 'POST', body: JSON.stringify(body) }),

  jiraImport: (body: { project_id?: string; jql?: string; max_results?: number }) =>
    request<{ created: number; skipped: number; total: number }>('/integrations/jira/import', { method: 'POST', body: JSON.stringify(body) }),

  linearPreview: (body: { project_id?: string; team_key: string; max_results?: number }) =>
    request<{ total: number; issues: LinearIssuePreview[] }>('/integrations/linear/preview', { method: 'POST', body: JSON.stringify(body) }),

  linearImport: (body: { project_id?: string; team_key: string; max_results?: number }) =>
    request<{ created: number; skipped: number; total: number }>('/integrations/linear/import', { method: 'POST', body: JSON.stringify(body) }),
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

export type BackupConfig = {
  path:           string | null
  schedule:       'daily' | 'weekly' | 'off'
  last_backup_at: string | null
}

export const settingsApi = {
  get: () => request<SettingsData>('/settings'),

  getClaudeSettings: () =>
    request<{ scan_root: string | null }>('/settings/claude'),

  saveClaudeSettings: (scan_root: string | null) =>
    request<{ scan_root: string | null }>('/settings/claude', {
      method: 'PUT',
      body: JSON.stringify({ scan_root }),
    }),

  importBackup: (body: unknown, dryRun = false) =>
    request<ImportSummary>(`/settings/import${dryRun ? '?dry_run=true' : ''}`, { method: 'POST', body: JSON.stringify(body) }),

  downloadBackup: async () => {
    const res = await fetch(`${BASE}/settings/backup`, { credentials: 'include' })
    if (!res.ok) throw new Error('Backup failed')
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `devbrain-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  },

  // ── Phase 21 export ──────────────────────────────────────────────────────

  exportProject: async (projectId: string, projectSlug: string) => {
    const res = await fetch(`${BASE}/export/project/${projectId}`, { credentials: 'include' })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `devbrain-${projectSlug}-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  },

  exportAll: async () => {
    const res = await fetch(`${BASE}/export/all`, { credentials: 'include' })
    if (!res.ok) throw new Error('Export failed')
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `devbrain-export-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  },

  // ── Phase 21 backup config ───────────────────────────────────────────────

  getBackupConfig: () =>
    request<BackupConfig>('/settings/backup-config'),

  saveBackupConfig: (cfg: Pick<BackupConfig, 'path' | 'schedule'>) =>
    request<BackupConfig>('/settings/backup-config', { method: 'PUT', body: JSON.stringify(cfg) }),

  backupNow: () =>
    request<{ ok: boolean; path: string }>('/settings/backup-now', { method: 'POST' }),

  // ── Phase 21 zip import ──────────────────────────────────────────────────

  zipImport: async (file: File, dryRun = false): Promise<ImportSummary> => {
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${BASE}/settings/zip-import${dryRun ? '?dry_run=true' : ''}`, {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    const json = await res.json() as { data?: ImportSummary; error?: string }
    if (!res.ok) throw new Error(json.error ?? `Import failed: ${res.status}`)
    return json.data!
  },
}

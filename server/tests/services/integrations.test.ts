import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before anything else
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../services/crypto.js', () => ({
  decrypt: vi.fn(s => s.replace('enc:', '')),
}))

// Import service after mocks are registered
const { syncGitHub, syncJira, syncLinear } = await import('../../services/integrations.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

describe('syncGitHub', () => {
  it('creates a new issue, skips a PR, and reports total including the PR', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse([
      { id: 101, title: 'I1', body: 'D1', state: 'open', labels: [] },
      { id: 102, title: 'I2', body: 'D2', state: 'open', labels: [], pull_request: {} },
    ]))
    vi.stubGlobal('fetch', mockFetch)
    mockQuery.mockResolvedValue({ rowCount: 1 } as never)

    const result = await syncGitHub({ project_id: 'p1', external_project_id: 'o/r' }, 'token')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1) // only the non-PR issue is inserted
    expect(result).toEqual({ created: 1, skipped: 0, total: 2 })
  })

  it('counts an existing issue (ON CONFLICT, rowCount 0) as skipped, and maps closed -> resolved', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse([
      { id: 201, title: 'Closed one', body: null, state: 'closed', labels: [{ name: 'bug' }] },
    ]))
    vi.stubGlobal('fetch', mockFetch)
    mockQuery.mockResolvedValue({ rowCount: 0 } as never)

    const result = await syncGitHub({ project_id: 'p1', external_project_id: 'o/r' }, 'token')

    expect(result).toEqual({ created: 0, skipped: 1, total: 1 })
    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['p1', 'Closed one', '', 'resolved', 'medium', ['github', 'bug'], 'github', 'github:201'])
  })

  it('omits the Authorization header when no token is provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', mockFetch)

    await syncGitHub({ project_id: 'p1', external_project_id: 'o/r' }, null)

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('throws when the GitHub API responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('nope', false, 403)))

    await expect(syncGitHub({ project_id: 'p1', external_project_id: 'o/r' }, 'token'))
      .rejects.toThrow(/GitHub API error: 403/)
  })
})

describe('syncJira', () => {
  const integration = { project_id: 'p1', external_project_id: 'PROJ', config: { baseUrl: 'https://jira.example.com', email: 'a@b.com' } }

  it('syncs issues, mapping status/priority, extracting description text, and building the Basic auth header', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({
      issues: [
        {
          id: '1', key: 'PROJ-1',
          fields: {
            summary: 'Done one', status: { name: 'Done' }, priority: { name: 'Blocker' },
            description: { content: [{ content: [{ text: 'the description' }] }] },
          },
        },
        {
          id: '2', key: 'PROJ-2',
          fields: { summary: 'In review', status: { name: 'In Review' }, priority: { name: 'Major' } },
        },
        {
          id: '3', key: 'PROJ-3',
          fields: { summary: 'Backlog item', status: { name: 'To Do' }, priority: { name: 'Minor' } },
        },
        {
          id: '4', key: 'PROJ-4',
          fields: { summary: 'No priority set', status: { name: 'Open' } },
        },
      ],
    }))
    vi.stubGlobal('fetch', mockFetch)
    mockQuery.mockResolvedValue({ rowCount: 1 } as never)

    const result = await syncJira(integration, 'api-token')

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('https://jira.example.com/rest/api/3/search')
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('a@b.com:api-token').toString('base64')}`
    )

    expect(mockQuery).toHaveBeenCalledTimes(4)
    const [, done]     = mockQuery.mock.calls[0]
    const [, inReview]  = mockQuery.mock.calls[1]
    const [, backlog]   = mockQuery.mock.calls[2]
    const [, noPrio]    = mockQuery.mock.calls[3]

    expect(done).toEqual(['p1', 'Done one', 'the description', 'resolved', 'critical', ['jira', 'PROJ-1'], 'jira', 'jira:1'])
    expect(inReview[2]).toBe('') // no description -> falls back to ''
    expect(inReview[3]).toBe('investigating')
    expect(inReview[4]).toBe('high')
    expect(backlog[3]).toBe('open')
    expect(backlog[4]).toBe('low')
    expect(noPrio[4]).toBe('medium') // priority absent -> default medium

    expect(result).toEqual({ created: 4, skipped: 0, total: 4 })
  })

  it('throws when the Jira API responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('nope', false, 401)))

    await expect(syncJira(integration, 'bad-token')).rejects.toThrow(/Jira API error: 401/)
  })

  it('counts an existing issue (ON CONFLICT, rowCount 0) as skipped', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      issues: [{ id: '1', key: 'PROJ-1', fields: { summary: 'S', status: { name: 'Open' } } }],
    })))
    mockQuery.mockResolvedValue({ rowCount: 0 } as never)

    const result = await syncJira(integration, 'api-token')

    expect(result).toEqual({ created: 0, skipped: 1, total: 1 })
  })

  it('defaults to an empty config when the integration has none configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ issues: [] })))

    await expect(syncJira({ project_id: 'p1', external_project_id: 'PROJ' }, 'tok')).resolves.toEqual({ created: 0, skipped: 0, total: 0 })
  })
})

describe('syncLinear', () => {
  const integration = { project_id: 'p1', external_project_id: 'TEAM' }

  it('maps priority 2 (high) and an "In Progress" state to investigating', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({
      data: { issues: { nodes: [
        { id: 'l1', title: 'L1', description: '', priority: 2, state: { name: 'In Progress' }, labels: { nodes: [] } },
      ] } },
    }))
    vi.stubGlobal('fetch', mockFetch)
    mockQuery.mockResolvedValue({ rowCount: 1 } as never)

    await syncLinear(integration, 'key')

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO issues'),
      expect.arrayContaining(['high', 'investigating', 'linear:l1'])
    )
  })

  it('maps the remaining priority levels and a "Done" state to resolved, and counts an unchanged row as skipped', async () => {
    const mockFetch = vi.fn().mockResolvedValue(jsonResponse({
      data: { issues: { nodes: [
        { id: 'l1', title: 'Urgent', description: null, priority: 1, state: { name: 'Todo' }, labels: { nodes: [{ name: 'bug' }] } },
        { id: 'l2', title: 'Low prio', description: 'desc', priority: 4, state: { name: 'Done' }, labels: { nodes: [] } },
        { id: 'l3', title: 'No priority', description: '', priority: 0, state: { name: 'Backlog' }, labels: { nodes: [] } },
      ] } },
    }))
    vi.stubGlobal('fetch', mockFetch)
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 1 } as never)
      .mockResolvedValueOnce({ rowCount: 0 } as never) // unchanged -> skipped

    const result = await syncLinear(integration, 'key')

    const [, urgent]   = mockQuery.mock.calls[0]
    const [, lowPrio]  = mockQuery.mock.calls[1]
    const [, noPrio]   = mockQuery.mock.calls[2]

    expect(urgent).toEqual(['p1', 'Urgent', '', 'open', 'critical', ['linear', 'bug'], 'linear', 'linear:l1'])
    expect(lowPrio[3]).toBe('resolved')
    expect(lowPrio[4]).toBe('low')
    expect(noPrio[4]).toBe('medium')
    expect(result).toEqual({ created: 2, skipped: 1, total: 3 })
  })

  it('throws when the Linear API responds non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('nope', false, 500)))

    await expect(syncLinear(integration, 'key')).rejects.toThrow(/Linear API error: 500/)
  })

  it('throws with the GraphQL error message when the response body carries errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'Team not found' }], data: { issues: { nodes: [] } } })))

    await expect(syncLinear(integration, 'key')).rejects.toThrow('Team not found')
  })
})

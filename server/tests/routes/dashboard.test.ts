import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

import dashboardRouter from '../../routes/dashboard.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get') {
  const layer = (dashboardRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function fakeReq(query: Record<string, string> = {}) {
  return { query }
}

describe('GET /api/dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  function mockAllQueries(overrides: Partial<{
    stats: unknown; openIssues: unknown[]; favCmds: unknown[]; releases: unknown[]; projects: unknown[]; activity: unknown[]
  }> = {}) {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('AS runbooks')) return { rows: [overrides.stats ?? { docs: 1, open_issues: 2, total_issues: 3, commands: 4, releases: 5, runbooks: 6 }] }
      if (text.includes('step_count')) return { rows: overrides.openIssues ?? [] }
      if (text.includes('is_favorite = true')) return { rows: overrides.favCmds ?? [] }
      if (text.includes('feature_count')) return { rows: overrides.releases ?? [] }
      if (text.includes('doc_count')) return { rows: overrides.projects ?? [] }
      if (text.includes('UNION ALL')) return { rows: overrides.activity ?? [] }
      throw new Error(`unexpected query: ${text}`)
    })
  }

  it('aggregates all six panels with no project filter', async () => {
    mockAllQueries({
      openIssues: [{ id: 'i1' }],
      favCmds: [{ id: 'c1' }],
      releases: [{ id: 'r1' }],
      projects: [{ id: 'p1' }],
      activity: [{ id: 'a1', type: 'doc' }],
    })
    const res = fakeRes()

    await getHandler('/', 'get')(fakeReq(), res, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(6) // includes the real projects query, since no project filter
    expect(res.json).toHaveBeenCalledWith({
      data: {
        stats: { docs: 1, openIssues: 2, totalIssues: 3, commands: 4, releases: 5, runbooks: 6 },
        openIssues: [{ id: 'i1' }],
        favoriteCommands: [{ id: 'c1' }],
        recentReleases: [{ id: 'r1' }],
        projects: [{ id: 'p1' }],
        activity: [{ id: 'a1', type: 'doc' }],
      },
    })
  })

  it('filters by projectId, passing it as $1 to every real query, and skips the projects listing query', async () => {
    mockAllQueries()
    const res = fakeRes()

    await getHandler('/', 'get')(fakeReq({ projectId: 'p1' }), res, () => {})

    // 5 real queries (projects listing is Promise.resolve({rows:[]}) when a project is selected)
    expect(mockQuery).toHaveBeenCalledTimes(5)
    for (const call of mockQuery.mock.calls) {
      expect(call[1]).toEqual(['p1'])
    }
    const data = (res.json.mock.calls[0][0] as { data: { projects: unknown[] } }).data
    expect(data.projects).toEqual([])
  })

  it('responds 500 when any panel query fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/', 'get')(fakeReq(), res, () => {})

    expect(errSpy).toHaveBeenCalledWith('dashboard error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Dashboard failed' })
    errSpy.mockRestore()
  })
})

describe('GET /api/dashboard/stats', () => {
  beforeEach(() => vi.clearAllMocks())

  function mockAllQueries(overrides: Partial<{
    openByProject: unknown[]; avgResolution: unknown[]; embeddingHealth: unknown; commandsThisWeek: unknown; staleIssues: unknown[]
  }> = {}) {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('open_count'))  return { rows: overrides.openByProject ?? [] }
      if (text.includes('avg_days'))    return { rows: overrides.avgResolution ?? [] }
      if (text.includes('embedding_status')) return { rows: overrides.embeddingHealth === undefined ? [] : [overrides.embeddingHealth] }
      if (text.includes("interval '7 days'")) return { rows: overrides.commandsThisWeek === undefined ? [] : [overrides.commandsThisWeek] }
      if (text.includes('issue_notes'))  return { rows: overrides.staleIssues ?? [] }
      throw new Error(`unexpected query: ${text}`)
    })
  }

  it('returns all five analytics panels with defaults when embedding health / commandsThisWeek have no rows', async () => {
    mockAllQueries()
    const res = fakeRes()

    await getHandler('/stats', 'get')(fakeReq(), res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: {
        openByProject: [],
        avgResolution: [],
        embeddingHealth: { done: 0, pending: 0, failed: 0, failedIds: [] },
        commandsThisWeek: 0,
        staleIssues: [],
      },
    })
  })

  it('maps embeddingHealth and commandsThisWeek when rows are present', async () => {
    mockAllQueries({
      embeddingHealth: { done: 10, pending: 2, failed: 1, failed_ids: ['d1'] },
      commandsThisWeek: { count: 7 },
    })
    const res = fakeRes()

    await getHandler('/stats', 'get')(fakeReq(), res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { embeddingHealth: unknown; commandsThisWeek: number } }).data
    expect(data.embeddingHealth).toEqual({ done: 10, pending: 2, failed: 1, failedIds: ['d1'] })
    expect(data.commandsThisWeek).toBe(7)
  })

  it('passes the project filter to every query', async () => {
    mockAllQueries()
    const res = fakeRes()

    await getHandler('/stats', 'get')(fakeReq({ projectId: 'p1' }), res, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(5)
    for (const call of mockQuery.mock.calls) {
      expect(call[1]).toEqual(['p1'])
    }
  })

  it('responds 500 when any panel query fails', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/stats', 'get')(fakeReq(), res, () => {})

    expect(errSpy).toHaveBeenCalledWith('dashboard/stats error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Dashboard stats failed' })
    errSpy.mockRestore()
  })
})

describe('GET /api/dashboard/activity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the daily activity series with no project filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ date: '2026-01-01', total: 3 }] } as never)
    const res = fakeRes()

    await getHandler('/activity', 'get')(fakeReq(), res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: [{ date: '2026-01-01', total: 3 }] })
  })

  it('filters by projectId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/activity', 'get')(fakeReq({ projectId: 'p1' }), res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['p1'])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/activity', 'get')(fakeReq(), res, () => {})

    expect(errSpy).toHaveBeenCalledWith('dashboard/activity error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Dashboard activity failed' })
    errSpy.mockRestore()
  })
})

describe('GET /api/dashboard/issue-throughput', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the weekly opened/resolved series with no project filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ week: '2026-05-04', opened: 3, resolved: 1 }] } as never)
    const res = fakeRes()

    await getHandler('/issue-throughput', 'get')(fakeReq(), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('AND project_id')
    expect(values).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: [{ week: '2026-05-04', opened: 3, resolved: 1 }] })
  })

  it('filters by projectId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/issue-throughput', 'get')(fakeReq({ projectId: 'p1' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('AND project_id = $1')
    expect(values).toEqual(['p1'])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/issue-throughput', 'get')(fakeReq(), res, () => {})

    expect(errSpy).toHaveBeenCalledWith('dashboard/issue-throughput error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Issue throughput failed' })
    errSpy.mockRestore()
  })
})

describe('GET /api/dashboard/embedding-health-trend', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the last 30 days of snapshots, oldest first, with no params', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ captured_at: '2026-07-01T00:00:00Z', pending: 1, processing: 0, done: 10, failed: 0 }],
    } as never)
    const res = fakeRes()

    await getHandler('/embedding-health-trend', 'get')({ query: {} }, res, () => {})

    expect(mockQuery.mock.calls[0][0]).toContain('FROM embedding_health_snapshots')
    expect(mockQuery.mock.calls[0][1]).toBeUndefined()
    expect(res.json).toHaveBeenCalledWith({
      data: [{ captured_at: '2026-07-01T00:00:00Z', pending: 1, processing: 0, done: 10, failed: 0 }],
    })
  })

  it('returns an empty array when no snapshots exist yet', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/embedding-health-trend', 'get')({ query: {} }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/embedding-health-trend', 'get')({ query: {} }, res, () => {})

    expect(errSpy).toHaveBeenCalledWith('dashboard/embedding-health-trend error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Embedding health trend failed' })
    errSpy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/claude-discovery.js', () => ({
  discoverProjects: vi.fn(),
}))

vi.mock('../../services/tasks-watcher.js', () => ({
  readTaskTree: vi.fn(),
  subscribe: vi.fn(),
}))

vi.mock('../../services/session-reader.js', () => ({
  readSessions: vi.fn(),
  readSessionDetail: vi.fn(),
}))

import claudeProjectsRouter from '../../routes/claude-projects.js'
import { pool } from '../../db/pool.js'
import { discoverProjects } from '../../services/claude-discovery.js'
import { readTaskTree, subscribe } from '../../services/tasks-watcher.js'
import { readSessions, readSessionDetail, type SessionSummary } from '../../services/session-reader.js'

const mockQuery            = vi.mocked(pool.query)
const mockDiscoverProjects = vi.mocked(discoverProjects)
const mockReadTaskTree     = vi.mocked(readTaskTree)
const mockSubscribe        = vi.mocked(subscribe)
const mockReadSessions       = vi.mocked(readSessions)
const mockReadSessionDetail  = vi.mocked(readSessionDetail)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post') {
  const layer = (claudeProjectsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function fakeSseRes() {
  return {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    status: vi.fn().mockReturnThis(),
    headersSent: false,
  }
}

function fakeReq(params: Record<string, string> = {}, query: Record<string, string> = {}) {
  const handlers: Record<string, () => void> = {}
  return {
    params, query,
    on: vi.fn((event: string, cb: () => void) => { handlers[event] = cb }),
    trigger: (event: string) => handlers[event]?.(),
  }
}

describe('POST /api/claude-projects/scan', () => {
  beforeEach(() => vi.clearAllMocks())

  it('422s when no scan root is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/scan', 'post')(fakeReq(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockDiscoverProjects).not.toHaveBeenCalled()
  })

  it('scans and returns discovered candidates', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { scan_root: '/repos' } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'PlayCru', short_name: 'playcru' }] } as never)
    mockDiscoverProjects.mockResolvedValueOnce([{ path: '/repos/x', name: 'x', lastUpdated: null, lastSessionDate: null, phases: [], overallPct: 0 }])
    const res = fakeRes()

    await getHandler('/scan', 'post')(fakeReq(), res, () => {})

    expect(mockDiscoverProjects).toHaveBeenCalledWith('/repos', expect.any(AbortSignal), [{ id: 'p1', name: 'PlayCru', short_name: 'playcru' }])
    expect(res.json).toHaveBeenCalledWith({ data: { root: '/repos', count: 1, candidates: expect.any(Array) } })
  })

  it('aborts an in-flight scan when a second scan request comes in', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('scan_root')) return { rows: [{ value: { scan_root: '/repos' } }] }
      if (text.includes('FROM projects')) return { rows: [] }
      throw new Error(`unexpected query: ${text}`)
    })

    let capturedSignal: AbortSignal | undefined
    let resolveFirst: (v: Awaited<ReturnType<typeof discoverProjects>>) => void = () => {}
    mockDiscoverProjects.mockImplementationOnce((_root, signal) => {
      capturedSignal = signal
      return new Promise(resolve => { resolveFirst = resolve })
    })

    const res1 = fakeRes()
    const firstCall = getHandler('/scan', 'post')(fakeReq(), res1, () => {})
    await vi.waitFor(() => expect(mockDiscoverProjects).toHaveBeenCalledTimes(1))

    mockDiscoverProjects.mockResolvedValueOnce([])
    const res2 = fakeRes()
    await getHandler('/scan', 'post')(fakeReq(), res2, () => {})

    expect(capturedSignal?.aborted).toBe(true)

    resolveFirst([])
    await firstCall
  })

  it('responds 500 when the scan itself fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { scan_root: '/repos' } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockDiscoverProjects.mockRejectedValueOnce(new Error('fs error'))
    const res = fakeRes()

    await getHandler('/scan', 'post')(fakeReq(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/claude-projects/:id/tasks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/tasks', 'get')(fakeReq({ id: 'missing' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('422s when the project has no linked filesystem path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeRes()

    await getHandler('/:id/tasks', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('returns the task tree', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadTaskTree.mockResolvedValueOnce({ projectId: 'p1', lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 })
    const res = fakeRes()

    await getHandler('/:id/tasks', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(mockReadTaskTree).toHaveBeenCalledWith('p1', '/repos/p1')
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: 'p1' }) })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id/tasks', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/claude-projects/:id/tasks/watch (SSE)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('ends with 404 (no body) when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeSseRes()

    await getHandler('/:id/tasks/watch', 'get')(fakeReq({ id: 'missing' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.end).toHaveBeenCalled()
    expect(res.setHeader).not.toHaveBeenCalled()
  })

  it('ends with 422 when the project has no filesystem path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeSseRes()

    await getHandler('/:id/tasks/watch', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.end).toHaveBeenCalled()
  })

  it('sets SSE headers, writes the initial tree, subscribes, and unsubscribes on close', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadTaskTree.mockResolvedValueOnce({ projectId: 'p1', lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 })
    const unsubscribeMock = vi.fn()
    mockSubscribe.mockReturnValueOnce(unsubscribeMock)
    const res = fakeSseRes()
    const req = fakeReq({ id: 'p1' })

    await getHandler('/:id/tasks/watch', 'get')(req, res, () => {})

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.flushHeaders).toHaveBeenCalled()
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('"projectId":"p1"'))
    expect(mockSubscribe).toHaveBeenCalledWith('p1', res)

    req.trigger('close')
    expect(unsubscribeMock).toHaveBeenCalledTimes(1)
  })

  it('writes a timeout event and ends the response after 5 minutes of inactivity', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadTaskTree.mockResolvedValueOnce({ projectId: 'p1', lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 })
    mockSubscribe.mockReturnValueOnce(vi.fn())
    const res = fakeSseRes()

    await getHandler('/:id/tasks/watch', 'get')(fakeReq({ id: 'p1' }), res, () => {})
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)

    expect(res.write).toHaveBeenCalledWith('data: {"type":"timeout"}\n\n')
    expect(res.end).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('logs and responds 500 when headers have not been sent yet', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeSseRes()

    await getHandler('/:id/tasks/watch', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(errSpy).toHaveBeenCalledWith('Claude Code task-watch error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })

  it('does not attempt to set a status once headers are already sent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadTaskTree.mockRejectedValueOnce(new Error('read failed after headers sent'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeSseRes()
    // simulate headers already flushed by the time the failure happens
    res.flushHeaders = vi.fn(() => { res.headersSent = true })

    await getHandler('/:id/tasks/watch', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('GET /api/claude-projects/:id/sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
    return {
      sessionId: 's1', folderName: '2026-01-01_09-00_a', date: '2026-01-01', started: '2026-01-01',
      status: 'active', goals: [], workDone: [], decisions: [], openItems: [], workDoneCount: 0,
      ...overrides,
    }
  }

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'missing' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('422s when the project has no filesystem path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('returns all sessions with default pagination when no filters are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce([session({ sessionId: 's1' }), session({ sessionId: 's2' })])
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { sessions: expect.any(Array), total: 2, page: 1, limit: 20 } })
    expect((res.json.mock.calls[0][0] as { data: { sessions: unknown[] } }).data.sessions).toHaveLength(2)
  })

  it('filters by status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce([session({ sessionId: 'a', status: 'active' }), session({ sessionId: 'b', status: 'completed' })])
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }, { status: 'completed' }), res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { sessions: { sessionId: string }[] } }).data
    expect(data.sessions.map(s => s.sessionId)).toEqual(['b'])
  })

  it('ignores an invalid status value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce([session(), session()])
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }, { status: 'bogus' }), res, () => {})

    expect((res.json.mock.calls[0][0] as { data: { total: number } }).data.total).toBe(2)
  })

  it('searches across goals, workDone, decisions, openItems, and folderName', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce([
      session({ sessionId: 'by-goal', goals: ['Ship the Widget'] }),
      session({ sessionId: 'by-workdone', workDone: ['Fixed the Widget bug'] }),
      session({ sessionId: 'by-decision', decisions: ['Use Widget approach'] }),
      session({ sessionId: 'by-openitem', openItems: ['Follow up on Widget'] }),
      session({ sessionId: 'by-folder', folderName: '2026-01-01_09-00_widget' }),
      session({ sessionId: 'no-match' }),
    ])
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }, { q: 'WIDGET' }), res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { sessions: { sessionId: string }[] } }).data
    expect(data.sessions.map(s => s.sessionId).sort()).toEqual(
      ['by-decision', 'by-folder', 'by-goal', 'by-openitem', 'by-workdone'].sort()
    )
  })

  it('paginates and clamps limit to 50, defaulting invalid page/limit values', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce(Array.from({ length: 60 }, (_, i) => session({ sessionId: `s${i}` })))
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }, { limit: '999' }), res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { sessions: unknown[]; limit: number; page: number } }).data
    expect(data.limit).toBe(50)
    expect(data.page).toBe(1)
    expect(data.sessions).toHaveLength(50)
  })

  it('applies the requested page offset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessions.mockResolvedValueOnce(Array.from({ length: 5 }, (_, i) => session({ sessionId: `s${i}` })))
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }, { page: '2', limit: '2' }), res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { sessions: { sessionId: string }[] } }).data
    expect(data.sessions.map(s => s.sessionId)).toEqual(['s2', 's3'])
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id/sessions', 'get')(fakeReq({ id: 'p1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/claude-projects/:id/sessions/:sessionId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/sessions/:sessionId', 'get')(fakeReq({ id: 'missing', sessionId: 's1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('422s when the project has no filesystem path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeRes()

    await getHandler('/:id/sessions/:sessionId', 'get')(fakeReq({ id: 'p1', sessionId: 's1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('404s with "Session not found" when the session detail is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessionDetail.mockResolvedValueOnce(null)
    const res = fakeRes()

    await getHandler('/:id/sessions/:sessionId', 'get')(fakeReq({ id: 'p1', sessionId: 'missing' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Session not found' })
  })

  it('returns the session detail', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repos/p1' }] } as never)
    mockReadSessionDetail.mockResolvedValueOnce({
      sessionId: 's1', folderName: 'f', date: 'd', started: 'd', status: 'active',
      goals: [], workDone: [], decisions: [], openItems: [], workDoneCount: 0, rawMarkdown: '# raw',
    })
    const res = fakeRes()

    await getHandler('/:id/sessions/:sessionId', 'get')(fakeReq({ id: 'p1', sessionId: 's1' }), res, () => {})

    expect(mockReadSessionDetail).toHaveBeenCalledWith('/repos/p1', 's1')
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ rawMarkdown: '# raw' }) })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id/sessions/:sessionId', 'get')(fakeReq({ id: 'p1', sessionId: 's1' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

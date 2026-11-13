import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../services/timeTracking.js', () => ({
  getTimeReport: vi.fn(), importActivityWatch: vi.fn(), importSessions: vi.fn(), estimateGitHours: vi.fn(),
  todayLocal: () => '2026-11-13',
}))

import timeRouter from '../../routes/time.js'
import { pool } from '../../db/pool.js'
import { getTimeReport, importActivityWatch, importSessions, estimateGitHours } from '../../services/timeTracking.js'

const mockQuery  = vi.mocked(pool.query)
const mockReport = vi.mocked(getTimeReport)
const mockAw     = vi.mocked(importActivityWatch)
const mockSess   = vi.mocked(importSessions)
const mockGit    = vi.mocked(estimateGitHours)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }
function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (timeRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method],
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}
const fakeRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() })

beforeEach(() => { vi.resetAllMocks() })

describe('GET /api/time', () => {
  const REPORT = { rows: [], by_source: [] }

  it('defaults to the last 30 days, grouped by day', async () => {
    mockReport.mockResolvedValueOnce(REPORT)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    const arg = mockReport.mock.calls[0][0]
    expect(arg).toMatchObject({ group: 'day', projectId: undefined })
    expect(arg.to).toBe('2026-11-13')
    expect(arg.from < arg.to).toBe(true)
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ group: 'day', ...REPORT }) })
  })

  it('passes explicit range, project and grouping through', async () => {
    mockReport.mockResolvedValueOnce(REPORT)
    await getHandler('/', 'get')({ query: { from: '2026-10-01', to: '2026-10-31', project_id: 'p1', group: 'month' } }, fakeRes(), () => {})
    expect(mockReport).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31', projectId: 'p1', group: 'month' })
  })

  it.each([
    [{ from: 'nope' }, 'malformed date'],
    [{ from: '2026-13-45' }, 'impossible date'],
    [{ group: 'year' }, 'unknown group (also guards the SQL date_trunc interpolation)'],
    [{ from: '2026-11-10', to: '2026-11-01' }, 'from after to'],
    [{ from: '2020-01-01', to: '2026-11-01' }, 'range over a year'],
  ])('400s on %j (%s)', async (query, _why) => {
    const res = fakeRes()
    await getHandler('/', 'get')({ query }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockReport).not.toHaveBeenCalled()
  })

  it('500s when the report query fails', async () => {
    mockReport.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/time/import', () => {
  it('runs every source by default, ActivityWatch first', async () => {
    const order: string[] = []
    mockAw.mockImplementation(async () => { order.push('aw'); return { days: 1, entries: 2 } })
    mockSess.mockImplementation(async () => { order.push('sess'); return [] })
    mockGit.mockImplementation(async () => { order.push('git'); return [] })

    const res = fakeRes()
    await getHandler('/import', 'post')({ body: {} }, res, () => {})

    expect(order).toEqual(['aw', 'sess', 'git'])
    expect(res.json).toHaveBeenCalledWith({ data: { activitywatch: { days: 1, entries: 2 }, 'claude-session': [], 'git-estimate': [] } })
  })

  it('runs only the requested sources and converts gap/credit units to ms', async () => {
    mockGit.mockResolvedValueOnce([])
    await getHandler('/import', 'post')({ body: { sources: ['git-estimate'], gap_hours: 3, credit_minutes: 15 } }, fakeRes(), () => {})
    expect(mockGit).toHaveBeenCalledWith({ gapMs: 3 * 3_600_000, creditMs: 15 * 60_000 })
    expect(mockAw).not.toHaveBeenCalled()
    expect(mockSess).not.toHaveBeenCalled()
  })

  it('reports ActivityWatch being down as a result error and still runs the other sources', async () => {
    mockAw.mockRejectedValueOnce(new Error('ActivityWatch not reachable at http://localhost:5600'))
    mockSess.mockResolvedValueOnce([])
    mockGit.mockResolvedValueOnce([])
    const res = fakeRes()
    await getHandler('/import', 'post')({ body: {} }, res, () => {})
    const body = res.json.mock.calls[0][0] as { data: { activitywatch: { error: string } } }
    expect(body.data.activitywatch.error).toContain('not reachable')
    expect(mockGit).toHaveBeenCalled()
  })

  it('does not accept an ActivityWatch URL from the request (SSRF guard)', async () => {
    mockAw.mockResolvedValueOnce({ days: 0, entries: 0 })
    mockSess.mockResolvedValueOnce([]); mockGit.mockResolvedValueOnce([])
    await getHandler('/import', 'post')({ body: { aw_url: 'http://169.254.169.254/' } }, fakeRes(), () => {})
    expect(mockAw).toHaveBeenCalledTimes(1)
    expect(mockAw.mock.calls[0]).toHaveLength(2)   // (from, to) only
  })

  it.each([
    [{ sources: [] }], [{ sources: ['evil'] }], [{ from: 'x' }], [{ gap_hours: 0 }], [{ credit_minutes: -1 }],
    [{ from: '2026-11-10', to: '2026-11-01' }], [{ from: '2020-01-01', to: '2026-11-01' }],
  ])('400s on invalid body %j', async (body) => {
    const res = fakeRes()
    await getHandler('/import', 'post')({ body }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockSess).not.toHaveBeenCalled()
  })

  it('500s when a non-AW source throws unexpectedly', async () => {
    mockAw.mockResolvedValueOnce({ days: 0, entries: 0 })
    mockSess.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/import', 'post')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('mapping rules', () => {
  const RULE = { project_id: 'p1', kind: 'app', pattern: ' Code.exe ', priority: 5 }

  it('GET lists rules with project names', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()
    await getHandler('/rules', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'r1' }] })
  })

  it('GET 500s on a db error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/rules', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('POST validates, trims the pattern and creates the rule', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()
    await getHandler('/rules', 'post')({ body: RULE }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', 'app', 'Code.exe', 5])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it.each([
    [{ ...RULE, kind: 'regex' }], [{ ...RULE, pattern: '   ' }], [{ ...RULE, pattern: 'x'.repeat(501) }],
    [{ ...RULE, priority: 5000 }], [{ ...RULE, project_id: '' }], [{}],
  ])('POST 400s on invalid body %j', async (body) => {
    const res = fakeRes()
    await getHandler('/rules', 'post')({ body }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('POST 404s for an unknown project (FK violation) and 500s on other errors', async () => {
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('fk'), { code: '23503' }))
    const res = fakeRes()
    await getHandler('/rules', 'post')({ body: RULE }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)

    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res2 = fakeRes()
    await getHandler('/rules', 'post')({ body: RULE }, res2, () => {})
    expect(res2.status).toHaveBeenCalledWith(500)
  })

  it('DELETE removes a rule, 404s when it does not exist, 500s on error', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = fakeRes()
    await getHandler('/rules/:id', 'delete')({ params: { id: 'r1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'r1' } })

    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never)
    const res2 = fakeRes()
    await getHandler('/rules/:id', 'delete')({ params: { id: 'nope' } }, res2, () => {})
    expect(res2.status).toHaveBeenCalledWith(404)

    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res3 = fakeRes()
    await getHandler('/rules/:id', 'delete')({ params: { id: 'r1' } }, res3, () => {})
    expect(res3.status).toHaveBeenCalledWith(500)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

import settingsNotificationsRouter from '../../routes/settings-notifications.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put') {
  const layer = (settingsNotificationsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET/PUT /api/settings/notifications', () => {
  it('GET returns defaults when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/notifications', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({
      data: { stale_threshold_days: 14, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true },
    })
  })

  it('GET responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/notifications', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: { stale_threshold_days: 0 } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores validated rules with defaults applied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: { stale_threshold_days: 30 } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({
      data: { stale_threshold_days: 30, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true },
    })
  })

  it('PUT responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET/PUT /api/settings/digest', () => {
  it('GET returns defaults when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/digest', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { enabled: false, time: '09:00' } })
  })

  it('GET responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid time format', async () => {
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: { enabled: true, time: '9am' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores validated digest settings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: { enabled: true, time: '18:30' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { enabled: true, time: '18:30' } })
  })

  it('PUT responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

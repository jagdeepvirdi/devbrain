import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import router from '../../routes/notifications.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(method: 'get' | 'patch', path: string) {
  const route = router.stack.find(s => s.route?.path === path && (s.route as any)?.methods[method])
  return route!.route!.stack[route!.route!.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('GET /api/notifications', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns notifications and unread_count using the given limit/offset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 10 }] } as any)
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] } as any)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'Test' }] } as any)

    const req = { user: { id: 'u1' }, query: { limit: '25', offset: '0' } }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(mockQuery.mock.calls[2][1]).toEqual(['u1', 25, 0])
    expect(res.json).toHaveBeenCalledWith({ data: { items: [{ id: 'n1', title: 'Test' }], total: 10, unread_count: 3 } })
  })

  it('defaults limit to 50 and offset to 0 when omitted', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as any)
    const req = { user: { id: 'u1' }, query: {} }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})
    expect(mockQuery.mock.calls[2][1]).toEqual(['u1', 50, 0])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { user: { id: 'u1' }, query: {} }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/notifications/read-all', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks all read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req = { user: { id: 'u1' } }
    const res = fakeRes()
    await getHandler('patch', '/read-all')(req as any, res, () => {})
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE notifications'), ['u1'])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { user: { id: 'u1' } }
    const res = fakeRes()
    await getHandler('patch', '/read-all')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/notifications/:id/read', () => {
  beforeEach(() => vi.clearAllMocks())

  it('marks one notification read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', read: true }] } as any)
    const req = { user: { id: 'u1' }, params: { id: 'n1' } }
    const res = fakeRes()
    await getHandler('patch', '/:id/read')(req as any, res, () => {})
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE notifications'), ['n1', 'u1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'n1', read: true } })
  })

  it('404s when the notification does not exist or is not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req = { user: { id: 'u1' }, params: { id: 'missing' } }
    const res = fakeRes()
    await getHandler('patch', '/:id/read')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { user: { id: 'u1' }, params: { id: 'n1' } }
    const res = fakeRes()
    await getHandler('patch', '/:id/read')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

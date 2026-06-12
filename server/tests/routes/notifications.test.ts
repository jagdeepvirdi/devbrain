import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

import router from '../../routes/notifications.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

describe('Notifications Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET / — returns notifications and unread_count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 10 }] } as any) // total count
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 3 }] } as any)  // unread count
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', title: 'Test' }] } as any) // notifications

    const req = { user: { id: 'u1' }, query: { limit: '25', offset: '0' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(res.json).toHaveBeenCalledWith({
      data: {
        items: [{ id: 'n1', title: 'Test' }],
        total: 10,
        unread_count: 3
      }
    })
  })

  it('PATCH /read-all — marks all read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req = { user: { id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/read-all') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifications'),
      ['u1']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('PATCH /:id/read — marks one notification read', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', read: true }] } as any)

    const req = { user: { id: 'u1' }, params: { id: 'n1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/:id/read') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE notifications'),
      ['n1', 'u1']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'n1', read: true } })
  })
})

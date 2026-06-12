import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}))

import issuesRouter from '../../routes/issues.js'
import documentsRouter from '../../routes/documents.js'
import commandsRouter from '../../routes/commands.js'
import { pool } from '../../db/pool.js'

const mockConnect = vi.mocked(pool.connect)

describe('Bulk Operations Route Handlers', () => {
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = {
      query: vi.fn(),
      release: vi.fn(),
    }
    mockConnect.mockResolvedValue(mockClient)
  })

  it('PATCH /issues/bulk — updates issue statuses', async () => {
    const req = {
      user: { id: 'u1', role: 'admin' },
      body: { ids: ['i1', 'i2'], action: 'status', value: 'resolved' },
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = issuesRouter.stack.find(s => s.route?.path === '/bulk') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE issues SET status = $1'),
      ['resolved', ['i1', 'i2']]
    )
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('PATCH /documents/bulk — deletes documents', async () => {
    const req = {
      user: { id: 'u1', role: 'admin' },
      body: { ids: ['d1', 'd2'], action: 'delete' },
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = documentsRouter.stack.find(s => s.route?.path === '/bulk') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM documents'),
      [['d1', 'd2']]
    )
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('PATCH /commands/bulk — updates favorite status', async () => {
    const req = {
      user: { id: 'u1', role: 'admin' },
      body: { ids: ['c1', 'c2'], action: 'favorite', value: 'true' },
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = commandsRouter.stack.find(s => s.route?.path === '/bulk') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockClient.query).toHaveBeenCalledWith('BEGIN')
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE commands SET is_favorite = $1'),
      [true, ['c1', 'c2']]
    )
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT')
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })
})

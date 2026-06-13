import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../services/ai.js', () => ({
  aiEmbed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

import router from '../../routes/search.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

describe('Search and Filter Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /history — returns last 20 queries', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'h1', query: 'test query', created_at: '2026-06-12T00:00:00Z' }
      ]
    } as any)

    const req = { user: { id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/history') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM search_history'),
      ['u1']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: 'h1', query: 'test query', created_at: '2026-06-12T00:00:00Z' }]
    })
  })

  it('GET /filters — returns saved filters', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'f1', name: 'My Filter', entity_type: 'issues', filter_json: { status: ['open'] } }
      ]
    } as any)

    const req = { user: { id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/filters') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM saved_filters'),
      ['u1']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: [{ id: 'f1', name: 'My Filter', entity_type: 'issues', filter_json: { status: ['open'] } }]
    })
  })

  it('POST /filters — creates a new saved filter', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'f1', name: 'New Filter', entity_type: 'issues', filter_json: { status: ['open'] } }
      ]
    } as any)

    const req = {
      user: { id: 'u1' },
      body: { name: 'New Filter', entity_type: 'issues', filter_json: { status: ['open'] } }
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/filters' && (s.route as any)?.methods.post) as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO saved_filters'),
      ['u1', 'New Filter', 'issues', '{"status":["open"]}']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: { id: 'f1', name: 'New Filter', entity_type: 'issues', filter_json: { status: ['open'] } }
    })
  })

  it('DELETE /filters/:id — deletes a saved filter', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any)

    const req = { user: { id: 'u1' }, params: { id: 'f1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/filters/:id') as any
    const handler = routeStack.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM saved_filters'),
      ['f1', 'u1']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: { success: true }
    })
  })
})

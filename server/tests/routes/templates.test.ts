import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => (req: any, res: any, next: any) => next(),
}))

import router from '../../routes/templates.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

describe('Templates Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET / — returns templates filtered by project and type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 't1', name: 'Bug Report', type: 'issue', is_builtin: true },
        { id: 't2', name: 'Custom Runbook', type: 'runbook', is_builtin: false }
      ]
    } as any)

    const req = { query: { type: 'issue', projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/' && s.route?.methods.get)?.route.stack[0].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalled()
    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('FROM templates')
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { id: 't1', name: 'Bug Report', type: 'issue', is_builtin: true },
        { id: 't2', name: 'Custom Runbook', type: 'runbook', is_builtin: false }
      ]
    })
  })

  it('POST / — creates custom template', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 't3', name: 'My Doc Template', type: 'document', is_builtin: false }
      ]
    } as any)

    const req = {
      body: {
        name: 'My Doc Template',
        type: 'document',
        description: 'A custom doc template',
        body: { content: 'test content' },
        project_id: 'p1'
      }
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/' && s.route?.methods.post) as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO templates'),
      ['p1', 'document', 'My Doc Template', 'A custom doc template', '{"content":"test content"}']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: { id: 't3', name: 'My Doc Template', type: 'document', is_builtin: false }
    })
  })

  it('PUT /:id — updates custom template, rejects built-in with 403', async () => {
    // 1. Test custom template update
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any) // Check existing
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't3', name: 'Updated Name' }] } as any) // Update execution

    const req = {
      params: { id: 't3' },
      body: { name: 'Updated Name' }
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/:id' && s.route?.methods.put) as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE templates'),
      ['t3', 'Updated Name']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: { id: 't3', name: 'Updated Name' }
    })

    // 2. Test built-in rejection
    vi.clearAllMocks()
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: true }] } as any) // Check existing

    const reqBuiltin = {
      params: { id: 't_builtin' },
      body: { name: 'Trying to rename built-in' }
    }
    const resBuiltin = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await handler(reqBuiltin as any, resBuiltin as any, () => {})
    expect(resBuiltin.status).toHaveBeenCalledWith(403)
    expect(resBuiltin.json).toHaveBeenCalledWith({ error: 'Cannot modify built-in templates' })
  })

  it('DELETE /:id — deletes custom template, rejects built-in with 403', async () => {
    // 1. Test custom template delete
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any) // Check existing
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as any) // Delete execution

    const req = { params: { id: 't3' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/:id' && s.route?.methods.delete) as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('DELETE FROM templates WHERE id = $1'),
      ['t3']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })

    // 2. Test built-in rejection
    vi.clearAllMocks()
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: true }] } as any) // Check existing

    const reqBuiltin = { params: { id: 't_builtin' } }
    const resBuiltin = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await handler(reqBuiltin as any, resBuiltin as any, () => {})
    expect(resBuiltin.status).toHaveBeenCalledWith(403)
    expect(resBuiltin.json).toHaveBeenCalledWith({ error: 'Cannot delete built-in templates' })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import router from '../../routes/templates.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(method: 'get' | 'post' | 'put' | 'delete', path: string) {
  const route = router.stack.find(s => s.route?.path === path && (s.route as any)?.methods[method])
  return route!.route!.stack[route!.route!.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('GET /api/templates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns templates filtered by project and type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 't1', name: 'Bug Report', type: 'issue', is_builtin: true },
        { id: 't2', name: 'Custom Runbook', type: 'runbook', is_builtin: false },
      ],
    } as any)

    const req = { query: { type: 'issue', projectId: 'p1' } }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})

    const sql = mockQuery.mock.calls[0][0] as string
    expect(sql).toContain('t.project_id = $1')
    expect(sql).toContain('t.type = $2')
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', 'issue'])
    expect(res.json).toHaveBeenCalledWith({ data: expect.any(Array) })
  })

  it('scopes to global/built-in templates when projectId is "global" or omitted, and applies no type filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req = { query: {} }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('(t.project_id IS NULL OR t.is_builtin = true)')
    expect(values).toEqual([])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { query: {} }
    const res = fakeRes()
    await getHandler('get', '/')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/templates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a custom template', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 't3', name: 'My Doc Template', type: 'document', is_builtin: false }],
    } as any)

    const req = {
      body: { name: 'My Doc Template', type: 'document', description: 'A custom doc template', body: { content: 'test content' }, project_id: 'p1' },
    }
    const res = fakeRes()
    await getHandler('post', '/')(req as any, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO templates'),
      ['p1', 'document', 'My Doc Template', 'A custom doc template', '{"content":"test content"}']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { id: 't3', name: 'My Doc Template', type: 'document', is_builtin: false } })
  })

  it('400s on an invalid body (ZodError)', async () => {
    const req = { body: { name: '', type: 'document', body: {} } }
    const res = fakeRes()
    await getHandler('post', '/')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('responds 500 on a non-validation failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { body: { name: 'X', type: 'document', body: {} } }
    const res = fakeRes()
    await getHandler('post', '/')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/templates/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates a custom template', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 't3', name: 'Updated Name' }] } as any)

    const req = { params: { id: 't3' }, body: { name: 'Updated Name' } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE templates'), ['t3', 'Updated Name'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 't3', name: 'Updated Name' } })
  })

  it('updates project_id (including clearing to null), description, and body together', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 't3' }] } as any)

    const req = { params: { id: 't3' }, body: { project_id: null, description: 'New desc', body: { steps: [] } } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})

    const [sql, values] = mockQuery.mock.calls[1]
    expect(sql).toContain('project_id = $2, description = $3, body = $4')
    expect(values).toEqual(['t3', null, 'New desc', '{"steps":[]}'])
  })

  it('403s when trying to modify a built-in template', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: true }] } as any)
    const req = { params: { id: 't_builtin' }, body: { name: 'Trying to rename built-in' } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot modify built-in templates' })
  })

  it('404s when the template does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req = { params: { id: 'missing' }, body: { name: 'X' } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('400s with "No fields to update" for an empty body', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any)
    const req = { params: { id: 't3' }, body: {} }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No fields to update' })
  })

  it('400s on an invalid body (ZodError)', async () => {
    const req = { params: { id: 't3' }, body: { name: '' } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('responds 500 on a non-validation failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { params: { id: 't3' }, body: { name: 'X' } }
    const res = fakeRes()
    await getHandler('put', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/templates/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes a custom template', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ is_builtin: false }] } as any)
      .mockResolvedValueOnce({ rowCount: 1 } as any)

    const req = { params: { id: 't3' } }
    const res = fakeRes()
    await getHandler('delete', '/:id')(req as any, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(2, expect.stringContaining('DELETE FROM templates WHERE id = $1'), ['t3'])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('403s when trying to delete a built-in template', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ is_builtin: true }] } as any)
    const req = { params: { id: 't_builtin' } }
    const res = fakeRes()
    await getHandler('delete', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot delete built-in templates' })
  })

  it('404s when the template does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req = { params: { id: 'missing' } }
    const res = fakeRes()
    await getHandler('delete', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { params: { id: 't3' } }
    const res = fakeRes()
    await getHandler('delete', '/:id')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

import runbooksRouter from '../../routes/runbooks.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (runbooksRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('GET /api/runbooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists runbooks with no filters applied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: {} }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(values).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'r1' }] })
  })

  it('filters for global (no project) runbooks without a bound value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { projectId: 'global' } }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('WHERE r.project_id IS NULL')
    expect(values).toEqual([])
  })

  it('filters by a specific project id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { projectId: 'p1' } }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('WHERE r.project_id = $1')
    expect(values).toEqual(['p1'])
  })

  it('filters by search term with an ILIKE wildcard', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { search: 'restart' } }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('WHERE r.title ILIKE $1')
    expect(values).toEqual(['%restart%'])
  })

  it('combines project and search filters with correct parameter indices', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { projectId: 'p1', search: 'restart' } }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('r.project_id = $1 AND r.title ILIKE $2')
    expect(values).toEqual(['p1', '%restart%'])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/', 'get')({ query: {} }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/runbooks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the runbook when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', title: 'Restart service' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'get')({ params: { id: 'r1' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { id: 'r1', title: 'Restart service' } })
  })

  it('404s when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'get')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id', 'get')({ params: { id: 'r1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/runbooks', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('creates a runbook with defaulted tags/steps and a null project_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { title: 'Restart service' } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO runbooks')
    expect(params).toEqual([null, 'Restart service', [], '[]'])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('creates a runbook with a project id, tags, and JSON-stringified steps', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r2' }] } as never)
    const res = fakeRes()
    const steps = [{ id: 's1', order: 1, instruction: 'SSH in', command: 'ssh host' }]

    await getHandler('/', 'post')({
      body: { title: 'Deploy', project_id: 'p1', tags: ['ops'], steps },
    }, res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['p1', 'Deploy', ['ops'], JSON.stringify(steps)])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { title: 'X' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/runbooks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on an invalid partial body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('updates simple fields with sequential parameter placeholders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', title: 'New title' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { title: 'New title', tags: ['ops'] } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('title = $2, tags = $3')
    expect(params).toEqual(['r1', 'New title', ['ops']])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'r1', title: 'New title' } })
  })

  it('casts steps to jsonb and JSON-stringifies the value', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()
    const steps = [{ id: 's1', order: 1, instruction: 'Do it' }]

    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { steps } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('steps = $2::jsonb')
    expect(params).toEqual(['r1', JSON.stringify(steps)])
  })

  it('404s when the runbook does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { title: 'X' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { title: 'X' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/runbooks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes and returns the removed runbook', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', title: 'Restart service' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'r1' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'r1', title: 'Restart service' } } })
  })

  it('404s when the runbook does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'r1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/runbooks/:id/use', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stamps last_used_at and returns the updated runbook', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', last_used_at: 't1' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/use', 'post')({ params: { id: 'r1' } }, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('last_used_at = now()'), ['r1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'r1', last_used_at: 't1' } })
  })

  it('404s when the runbook does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/use', 'post')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id/use', 'post')({ params: { id: 'r1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

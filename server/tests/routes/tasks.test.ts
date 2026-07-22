import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/links.js', () => ({
  deleteLinksFor: vi.fn(),
}))

import tasksRouter from '../../routes/tasks.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (tasksRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/tasks', () => {
  it('applies no filters when none are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(values).toEqual([])
  })

  it('filters for global (no project) tasks', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: { projectId: 'global' } }, res, () => {})
    expect(String(mockQuery.mock.calls[0][0])).toContain('t.project_id IS NULL')
  })

  it('filters by project id, status, and priority with sequential placeholders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: { projectId: 'p1', status: 'todo', priority: 'high' } }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('t.project_id = $1 AND t.status = $2 AND t.priority = $3')
    expect(values).toEqual(['p1', 'todo', 'high'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 't1' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/tasks/:id', () => {
  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 't1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/tasks/import-md', () => {
  it('400s when content is missing or blank', async () => {
    const res = fakeRes()
    await getHandler('/import-md', 'post')({ body: { content: '   ' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s when no checkboxes are found', async () => {
    const res = fakeRes()
    await getHandler('/import-md', 'post')({ body: { content: '# Just a heading\nSome prose.' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No checkboxes found in the file' })
  })

  it('parses ## sections as tags and both checked/unchecked items, tallying created vs. skipped', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never) // created
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never) // skipped (already exists)
    const res = fakeRes()
    const content = [
      '## Phase 1',
      '- [ ] Todo item',
      '- [x] Done item',
    ].join('\n')

    await getHandler('/import-md', 'post')({ body: { content, projectId: 'p1' } }, res, () => {})

    const [, todoParams] = mockQuery.mock.calls[0]
    expect(todoParams).toEqual(['p1', 'Todo item', 'todo', ['Phase 1'], null])
    const [, doneParams] = mockQuery.mock.calls[1]
    expect(doneParams).toEqual(['p1', 'Done item', 'done', ['Phase 1'], expect.any(Date)])
    expect(res.json).toHaveBeenCalledWith({ data: { created: 1, skipped: 1, total: 2 } })
  })

  it('defaults the section tag to "Imported" before any ## heading, and defaults projectId to null', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = fakeRes()

    await getHandler('/import-md', 'post')({ body: { content: '- [ ] No heading above me' } }, res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual([null, 'No heading above me', 'todo', ['Imported'], null])
  })

  it('counts a per-item insert failure as skipped rather than aborting the batch', async () => {
    mockQuery.mockRejectedValueOnce(new Error('constraint violation'))
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    const res = fakeRes()

    await getHandler('/import-md', 'post')({ body: { content: '- [ ] First\n- [ ] Second' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { created: 1, skipped: 1, total: 2 } })
  })

  it('counts a null rowCount as skipped (the ?? 0 fallback)', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: null } as never)
    const res = fakeRes()

    await getHandler('/import-md', 'post')({ body: { content: '- [ ] Only item' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { created: 0, skipped: 1, total: 1 } })
  })
})

describe('POST /api/tasks', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a task with defaults applied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: 'Ship it' } }, res, () => {})
    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual([null, 'Ship it', '', 'todo', 'medium', null, []])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('passes through explicit fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({
      body: { title: 'X', description: 'D', status: 'in_progress', priority: 'high', project_id: 'p1', due_date: '2026-02-01', tags: ['a'] },
    }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', 'X', 'D', 'in_progress', 'high', '2026-02-01', ['a']])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/tasks/:id', () => {
  it('400s on an invalid partial body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
  })

  it('sets done_at when marking status done', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { status: 'done' } }, res, () => {})
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('done_at = now()')
    expect(params).toEqual(['t1', 'done'])
  })

  it('clears done_at when marking a non-done status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { status: 'todo' } }, res, () => {})
    expect(String(mockQuery.mock.calls[0][0])).toContain('done_at = NULL')
  })

  it('leaves done_at untouched when status is not part of the update', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { title: 'New title' } }, res, () => {})
    const sql = String(mockQuery.mock.calls[0][0])
    expect(sql).not.toContain('done_at')
    expect(sql).toContain('title = $2')
  })

  it('maps project_id and due_date columns through the colMap', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { project_id: 'p2', due_date: '2026-03-01' } }, res, () => {})
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('project_id = $2, due_date = $3')
    expect(params).toEqual(['t1', 'p2', '2026-03-01'])
  })

  it('404s when the task does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 't1' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/tasks/:id', () => {
  it('404s without deleting links when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 't1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

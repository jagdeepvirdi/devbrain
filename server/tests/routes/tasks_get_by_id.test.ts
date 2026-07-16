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

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (tasksRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('GET /api/tasks/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the task does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { params: { id: 'missing' } }
    const res = fakeRes()
    await getHandler('/:id', 'get')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns the task regardless of project, for deep-link support', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Ship it', project_id: 'other-project' }] } as any)
    const req: any = { params: { id: 'task-1' } }
    const res = fakeRes()
    await getHandler('/:id', 'get')(req, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['task-1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'task-1', title: 'Ship it', project_id: 'other-project' } })
  })
})

describe('DELETE /api/tasks/:id — cleans up entity links', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls deleteLinksFor after a successful delete', async () => {
    const { deleteLinksFor } = await import('../../services/links.js')
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'task-1', title: 'Ship it' }] } as any)
    const req: any = { params: { id: 'task-1' } }
    const res = fakeRes()
    await getHandler('/:id', 'delete')(req, res, () => {})
    expect(deleteLinksFor).toHaveBeenCalledWith('task', 'task-1')
  })
})

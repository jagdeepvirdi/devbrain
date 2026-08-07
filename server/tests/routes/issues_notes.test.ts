import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

import issuesNotesRouter from '../../routes/issues-notes.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete' | 'patch') {
  const layer = (issuesNotesRouter as unknown as { stack: RouteLayer[] }).stack.find(
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

describe('POST /api/issues/:id/notes', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'missing' }, body: { content: 'note' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('adds a note and returns the full issue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never) // existence check
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', notes: [{ content: 'note' }] }] } as never) // fetch
    const res = fakeRes()

    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: 'note' } }, res, () => {})

    const insertCall = mockQuery.mock.calls[1]
    expect(String(insertCall[0])).toContain('INSERT INTO issue_notes')
    expect((insertCall[1] as unknown[])[1]).toBe('i1')
    expect((insertCall[1] as unknown[])[2]).toBe('note')
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1', notes: [{ content: 'note' }] } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: 'note' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/issues/:id/notes/:noteId', () => {
  it('404s when the note does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never)
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('deletes the note and returns the full issue', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['n1', 'i1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1' } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/:id/commits', () => {
  it('400s on an invalid sha', async () => {
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'zz' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'missing' }, body: { sha: 'abc123' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('links the commit and returns the sha list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 'p1' }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ sha: 'abc123' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'abc123' } }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['i1', 'abc123', 'p1'])
    expect(res.json).toHaveBeenCalledWith({ data: ['abc123'] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'abc123' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/issues/:id/commits/:sha', () => {
  it('unlinks the commit and returns the remaining sha list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/commits/:sha', 'delete')({ params: { id: 'i1', sha: 'abc123' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['i1', 'abc123'])
    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/commits/:sha', 'delete')({ params: { id: 'i1', sha: 'abc123' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

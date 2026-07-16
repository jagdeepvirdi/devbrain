import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(routePath: string) {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods.get
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('GET /api/documents/:id/chunks/:chunkIndex', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the target chunk plus its immediate neighbors', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { chunkIndex: 2, content: 'prev chunk' },
        { chunkIndex: 3, content: 'target chunk' },
        { chunkIndex: 4, content: 'next chunk' },
      ],
    } as any)

    const req: any = { params: { id: 'doc-1', chunkIndex: '3' } }
    const res = fakeRes()

    await getHandler('/:id/chunks/:chunkIndex')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('chunk_index BETWEEN $2 AND $3'),
      ['doc-1', 2, 4]
    )
    expect(res.json).toHaveBeenCalledWith({
      data: {
        chunkIndex: 3,
        chunks: [
          { chunkIndex: 2, content: 'prev chunk' },
          { chunkIndex: 3, content: 'target chunk' },
          { chunkIndex: 4, content: 'next chunk' },
        ],
      },
    })
  })

  it('clamps the lower neighbor bound at 0 for the first chunk', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { chunkIndex: 0, content: 'first chunk' },
        { chunkIndex: 1, content: 'second chunk' },
      ],
    } as any)

    const req: any = { params: { id: 'doc-1', chunkIndex: '0' } }
    const res = fakeRes()

    await getHandler('/:id/chunks/:chunkIndex')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('chunk_index BETWEEN $2 AND $3'),
      ['doc-1', 0, 1]
    )
  })

  it('404s when the target chunk does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { params: { id: 'doc-1', chunkIndex: '99' } }
    const res = fakeRes()

    await getHandler('/:id/chunks/:chunkIndex')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('400s on a non-numeric chunkIndex', async () => {
    const req: any = { params: { id: 'doc-1', chunkIndex: 'not-a-number' } }
    const res = fakeRes()

    await getHandler('/:id/chunks/:chunkIndex')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('400s on a negative chunkIndex', async () => {
    const req: any = { params: { id: 'doc-1', chunkIndex: '-1' } }
    const res = fakeRes()

    await getHandler('/:id/chunks/:chunkIndex')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })
})

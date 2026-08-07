import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { embedDocument } from '../../services/embedder.js'

const mockQuery = vi.mocked(pool.query)
const mockEmbed = vi.mocked(embedDocument)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('PATCH /api/documents/:id/content', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on empty content', async () => {
    const req: any = { params: { id: 'doc-1' }, body: { content: '' } }
    const res = fakeRes()

    await getHandler('/:id/content', 'patch')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('400s when content is missing entirely', async () => {
    const req: any = { params: { id: 'doc-1' }, body: {} }
    const res = fakeRes()

    await getHandler('/:id/content', 'patch')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { params: { id: 'missing' }, body: { content: 'new code' } }
    const res = fakeRes()

    await getHandler('/:id/content', 'patch')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('updates content/hash in place, leaves language/file_type untouched, and re-embeds', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'index.ts', language: 'typescript' }] } as any) // existing lookup
      .mockResolvedValueOnce({ rows: [] } as any)                                               // UPDATE content
      .mockResolvedValueOnce({ rows: [] } as any)                                               // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'index.ts', language: 'typescript', explanation_stale: true }] } as any) // final select
    mockEmbed.mockResolvedValue(3)

    const req: any = { params: { id: 'doc-1' }, body: { content: 'const x = 1' } }
    const res = fakeRes()

    await getHandler('/:id/content', 'patch')(req, res, () => {})

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE documents')
    expect(updateCall[0]).not.toContain('file_type')
    expect(updateCall[0]).not.toContain('language')
    expect(updateCall[1]).toEqual(['doc-1', 'const x = 1', expect.any(String)])

    expect(mockEmbed).toHaveBeenCalledWith('doc-1', 'const x = 1', { title: 'index.ts', language: 'typescript' })
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'doc-1', chunk_count: 3, explanation_stale: true }) })
  })

  it('marks embedding_status failed if something throws mid-update', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'index.ts', language: 'typescript' }] } as any) // existing lookup
      .mockRejectedValueOnce(new Error('boom'))                                                 // UPDATE content throws
      .mockResolvedValueOnce({ rows: [] } as any)                                                // embedding_status = failed cleanup

    const req: any = { params: { id: 'doc-1' }, body: { content: 'const x = 1' } }
    const res = fakeRes()

    await getHandler('/:id/content', 'patch')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(mockQuery.mock.calls[2][0]).toContain(`embedding_status = 'failed'`)
  })
})

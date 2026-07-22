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

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { parseFile } from '../../services/parser.js'
import { embedDocument } from '../../services/embedder.js'

const mockQuery     = vi.mocked(pool.query)
const mockParseFile = vi.mocked(parseFile)
const mockEmbed     = vi.mocked(embedDocument)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/:id/update-content', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when no file is uploaded', async () => {
    const req: any = { params: { id: 'doc-1' }, file: undefined }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { params: { id: 'missing' }, file: { path: '/tmp/fake', originalname: 'index.ts' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockParseFile).not.toHaveBeenCalled()
  })

  it('422s when no text could be extracted from the replacement file', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any) // existence check
    mockParseFile.mockResolvedValueOnce({ text: '', fileType: 'txt', title: 'empty' } as any)
    const req: any = { params: { id: 'doc-1' }, file: { path: '/tmp/fake', originalname: 'empty.txt' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('stores a null language when the replacement file has none', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ title: 'notes.txt' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)
    mockParseFile.mockResolvedValue({ text: 'plain text', fileType: 'txt', title: 'notes' } as any)
    mockEmbed.mockResolvedValue(1)

    const req: any = { params: { id: 'doc-1' }, file: { path: '/tmp/fake', originalname: 'notes.txt' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[1]).toEqual(['doc-1', 'plain text', expect.any(String), 'txt', null, 'notes.txt'])
  })

  it('swallows a failure in the failed-status cleanup update itself', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any) // existence check
      .mockRejectedValueOnce(new Error('boom'))                   // UPDATE content throws
      .mockRejectedValueOnce(new Error('cleanup also fails'))     // embedding_status = failed cleanup also throws
    mockParseFile.mockResolvedValue({ text: 'content', fileType: 'code', title: 'index', language: 'python' } as any)

    const req: any = { params: { id: 'doc-1' }, file: { path: '/tmp/fake', originalname: 'index.py' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('replaces content/hash/language in place and re-embeds with the new content', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)                          // existence check
      .mockResolvedValueOnce({ rows: [] } as any)                                          // UPDATE content
      .mockResolvedValueOnce({ rows: [{ title: 'index.ts' }] } as any)                     // SELECT title
      .mockResolvedValueOnce({ rows: [] } as any)                                          // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'index.ts', language: 'python', explanation_stale: true }] } as any) // final select
    mockParseFile.mockResolvedValue({ text: 'def new_version(): pass', fileType: 'code', title: 'index', language: 'python' })
    mockEmbed.mockResolvedValue(2)

    const req: any = { params: { id: 'doc-1' }, file: { path: '/tmp/fake', originalname: 'index.py' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    const updateCall = mockQuery.mock.calls[1]
    expect(updateCall[0]).toContain('UPDATE documents')
    expect(updateCall[1]).toEqual(['doc-1', 'def new_version(): pass', expect.any(String), 'code', 'python', 'index.py'])

    expect(mockEmbed).toHaveBeenCalledWith('doc-1', 'def new_version(): pass', { title: 'index.ts', language: 'python' })
    expect(mockQuery.mock.calls[4][0]).toContain('explanation_stale')
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'doc-1', chunk_count: 2, explanation_stale: true }) })
  })

  it('marks embedding_status failed if something throws mid-update', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)  // existence check
      .mockRejectedValueOnce(new Error('boom'))                    // UPDATE content throws
      .mockResolvedValueOnce({ rows: [] } as any)                  // embedding_status = failed (catch block)
    mockParseFile.mockResolvedValue({ text: 'content', fileType: 'code', title: 'index', language: 'python' })

    const req: any = { params: { id: 'doc-1' }, file: { path: '/tmp/fake', originalname: 'index.py' } }
    const res = fakeRes()

    await getHandler('/:id/update-content', 'post')(req, res, () => {})

    expect(mockQuery.mock.calls[2][0]).toContain(`embedding_status = 'failed'`)
  })
})

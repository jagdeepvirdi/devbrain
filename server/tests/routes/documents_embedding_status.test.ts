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

// isPrivateUrl() does a real DNS lookup — stub it to a public address so the
// URL-import test doesn't depend on network access in the test sandbox.
vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { parseFile, parseUrl } from '../../services/parser.js'
import { embedDocument } from '../../services/embedder.js'

const mockQuery     = vi.mocked(pool.query)
const mockParseFile = vi.mocked(parseFile)
const mockParseUrl  = vi.mocked(parseUrl)
const mockEmbed     = vi.mocked(embedDocument)

function getHandler(routePath: string) {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods.post
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents — embedding_status is finalized on upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the document done after a successful upload + embed', async () => {
    mockParseFile.mockResolvedValue({ text: 'hello world', fileType: 'txt', title: 'notes' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)                                   // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)                    // insert
      .mockResolvedValueOnce({ rows: [] } as any)                                   // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', embedding_status: 'done' }] } as any) // final select
    mockEmbed.mockResolvedValue(3)

    const req: any = { body: {}, file: { path: '/tmp/fake', originalname: 'notes.txt' } }
    const res = fakeRes()

    await getHandler('/')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE documents SET embedding_status = 'done'"),
      ['doc-1']
    )
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('rolls back the document row on embed failure and never marks it done', async () => {
    mockParseFile.mockResolvedValue({ text: 'hello world', fileType: 'txt', title: 'notes' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)                 // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'doc-2' }] } as any)  // insert
      .mockResolvedValueOnce({ rows: [] } as any)                 // delete rollback
    mockEmbed.mockRejectedValue(new Error('ollama down'))

    const req: any = { body: {}, file: { path: '/tmp/fake', originalname: 'notes.txt' } }
    const res = fakeRes()

    await getHandler('/')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM documents WHERE id = $1', ['doc-2'])
    expect(mockQuery).not.toHaveBeenCalledWith(
      expect.stringContaining("embedding_status = 'done'"),
      expect.anything()
    )
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/documents/url — embedding_status is finalized on import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the document done after a successful URL import + embed', async () => {
    mockParseUrl.mockResolvedValue({ text: 'page content', fileType: 'url', title: 'example.com' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)                                   // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'doc-3' }] } as any)                    // insert
      .mockResolvedValueOnce({ rows: [] } as any)                                   // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'doc-3', embedding_status: 'done' }] } as any) // final select
    mockEmbed.mockResolvedValue(2)

    const req: any = { body: { url: 'https://example.com', tags: [] } }
    const res = fakeRes()

    await getHandler('/url')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE documents SET embedding_status = 'done'"),
      ['doc-3']
    )
    expect(res.status).toHaveBeenCalledWith(201)
  })
})

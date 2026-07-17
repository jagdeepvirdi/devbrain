import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument:      vi.fn(),
  embedDocumentsBatch: vi.fn(),
  searchChunks:       vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { embedDocumentsBatch } from '../../services/embedder.js'

const mockConnect = vi.mocked(pool.connect)
const mockQuery   = vi.mocked(pool.query)
const mockBatch    = vi.mocked(embedDocumentsBatch)

function getHandler() {
  const layer = (documentsRouter as any).stack.find((s: any) => s.route?.path === '/bulk' && s.route.methods.patch)
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

// Lets the fire-and-forget embedDocumentsBatch().then(...) chain settle
// before assertions run, since the route responds before it resolves.
const flush = () => new Promise(r => setImmediate(r))

describe('PATCH /api/documents/bulk — re-embed action', () => {
  let mockClient: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockClient = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
    mockConnect.mockResolvedValue(mockClient)
    mockQuery.mockResolvedValue({ rows: [] } as any)
  })

  it('fires one embedDocumentsBatch call, not one embedDocument call per document', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)  // BEGIN
      .mockResolvedValueOnce({ rows: [ // SELECT
        { id: 'd1', content: 'text one', title: 'Doc 1', language: null },
        { id: 'd2', content: 'text two', title: 'Doc 2', language: 'typescript' },
      ] })
      .mockResolvedValueOnce(undefined) // UPDATE processing
      .mockResolvedValueOnce(undefined) // COMMIT
    mockBatch.mockResolvedValue([
      { id: 'd1', chunkCount: 3 },
      { id: 'd2', chunkCount: 5 },
    ])

    const req: any = { body: { ids: ['d1', 'd2'], action: 're-embed' } }
    const res = fakeRes()

    await getHandler()(req, res, () => {})
    await flush()

    expect(mockBatch).toHaveBeenCalledTimes(1)
    expect(mockBatch).toHaveBeenCalledWith([
      { id: 'd1', content: 'text one', title: 'Doc 1', language: null },
      { id: 'd2', content: 'text two', title: 'Doc 2', language: 'typescript' },
    ])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('marks each document done or failed according to its own BatchResult', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [
        { id: 'd1', content: 'good', title: null, language: null },
        { id: 'd2', content: 'bad',  title: null, language: null },
      ] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    mockBatch.mockResolvedValue([
      { id: 'd1', chunkCount: 2 },
      { id: 'd2', chunkCount: 0, error: 'ollama down' },
    ])

    const req: any = { body: { ids: ['d1', 'd2'], action: 're-embed' } }
    const res = fakeRes()

    await getHandler()(req, res, () => {})
    await flush()

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('embedding_status = $2'), ['d1', 'done'])
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('embedding_status = $2'), ['d2', 'failed'])
  })

  it('marks every document failed if the batch call itself rejects', async () => {
    mockClient.query
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rows: [{ id: 'd1', content: 'text', title: null, language: null }] })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
    mockBatch.mockRejectedValue(new Error('ollama unreachable'))

    const req: any = { body: { ids: ['d1'], action: 're-embed' } }
    const res = fakeRes()

    await getHandler()(req, res, () => {})
    await flush()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("embedding_status = 'failed' WHERE id = ANY"),
      [['d1']]
    )
  })
})

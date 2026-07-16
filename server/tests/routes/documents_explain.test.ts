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

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { aiChat } from '../../services/ai.js'

const mockQuery  = vi.mocked(pool.query)
const mockAiChat = vi.mocked(aiChat)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/:id/explain', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { params: { id: 'missing' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('rejects non-code documents', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'notes', content: 'hello', file_type: 'txt', language: null, content_hash: 'h1' }],
    } as any)

    const req: any = { params: { id: 'doc-1' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('generates and persists an explanation for a code document, stamped with the current content_hash', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-abc' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE

    mockAiChat.mockResolvedValue('This file exports a constant.')

    const req: any = { params: { id: 'doc-2' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('typescript')
    expect(mockAiChat.mock.calls[0][0]).toContain('index.ts')
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE documents SET explanation = $2, explanation_hash = $3 WHERE id = $1',
      ['doc-2', 'This file exports a constant.', 'hash-abc']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { explanation: 'This file exports a constant.' } })
  })

  it('falls back to a generic "code" label when language is unknown', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'mystery.xyz', content: 'garbled', file_type: 'code', language: null, content_hash: 'h2' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('Some explanation.')

    const req: any = { params: { id: 'doc-3' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('```code')
  })
})

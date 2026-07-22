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

describe('POST /api/documents/:id/diagram', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { params: { id: 'missing' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('rejects non-code documents', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'notes', content: 'hello', file_type: 'txt', language: null, content_hash: 'h1' }],
    } as any)

    const req: any = { params: { id: 'doc-1' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('generates and persists a diagram, stamped with the current content_hash', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-abc' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE

    mockAiChat.mockResolvedValue('flowchart TD\n  A["x"] --> B["export"]')

    const req: any = { params: { id: 'doc-2' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('typescript')
    expect(mockAiChat.mock.calls[0][0]).toContain('Mermaid diagram')
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE documents SET diagram = $2, diagram_hash = $3 WHERE id = $1',
      ['doc-2', 'flowchart TD\n  A["x"] --> B["export"]', 'hash-abc']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { diagram: 'flowchart TD\n  A["x"] --> B["export"]' } })
  })

  it('strips a ```mermaid code fence if the model wraps the response in one', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'x', file_type: 'code', language: 'typescript', content_hash: 'h3' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('```mermaid\nflowchart TD\n  A --> B\n```')

    const req: any = { params: { id: 'doc-3' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { diagram: 'flowchart TD\n  A --> B' } })
  })

  it('strips a plain ``` fence with no language tag too', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'x', file_type: 'code', language: 'typescript', content_hash: 'h4' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('```\nflowchart TD\n  A --> B\n```')

    const req: any = { params: { id: 'doc-4' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { diagram: 'flowchart TD\n  A --> B' } })
  })

  it('falls back to a generic "code" label when language is unknown', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'mystery.xyz', content: 'garbled', file_type: 'code', language: null, content_hash: 'h5' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('flowchart TD\n  A["?"]')

    const req: any = { params: { id: 'doc-5' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('```code')
  })

  it('notes truncation in the prompt when content exceeds the source-char cap', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'big.ts', content: 'x'.repeat(12001), file_type: 'code', language: 'typescript', content_hash: 'h6' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('flowchart TD\n  A["big"]')

    const req: any = { params: { id: 'doc-6' } }
    const res = fakeRes()

    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('File was truncated for length')
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req: any = { params: { id: 'doc-1' } }
    const res = fakeRes()
    await getHandler('/:id/diagram', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

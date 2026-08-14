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

import documentsAiRouter from '../../routes/documents-ai.js'
import { pool } from '../../db/pool.js'
import { aiChat } from '../../services/ai.js'

const mockQuery  = vi.mocked(pool.query)
const mockAiChat = vi.mocked(aiChat)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsAiRouter as any).stack.find(
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

  it('uses the app-wide default chat model (no per-call override)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'x', file_type: 'code', language: 'typescript', content_hash: 'h7' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
    mockAiChat.mockResolvedValue('flowchart TD\n  A["x"]')

    const req: any = { params: { id: 'doc-7' } }
    const res = fakeRes()
    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    // Exactly 2 args (prompt, system) — no third options arg. A larger/
    // code-specialized model was tried as a fix and rejected after real
    // hardware testing (too large or too slow on this app's 6GB-VRAM
    // target — see the comment above this route).
    expect(mockAiChat).toHaveBeenCalledWith(expect.any(String), expect.any(String))
  })

  it('accepts classDiagram/sequenceDiagram, not just flowchart', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'model.ts', content: 'x', file_type: 'code', language: 'typescript', content_hash: 'h8' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
    mockAiChat.mockResolvedValue('classDiagram\n  class Foo')

    const req: any = { params: { id: 'doc-8' } }
    const res = fakeRes()
    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { diagram: 'classDiagram\n  class Foo' } })
  })

  it('retries once when the model returns prose instead of a diagram, and succeeds on the second attempt', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'big.sql', content: 'x', file_type: 'code', language: 'sql', content_hash: 'h9' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
    mockAiChat
      .mockResolvedValueOnce('This procedure updates the accounts table and rolls back on error.')
      .mockResolvedValueOnce('flowchart TD\n  A["proc"] --> B["accounts"]')

    const req: any = { params: { id: 'doc-9' } }
    const res = fakeRes()
    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(mockAiChat).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith({ data: { diagram: 'flowchart TD\n  A["proc"] --> B["accounts"]' } })
  })

  it('gives up with a 502 (and no DB write) after two consecutive non-diagram responses', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'big.sql', content: 'x', file_type: 'code', language: 'sql', content_hash: 'h10' }],
    } as any)
    mockAiChat
      .mockResolvedValueOnce('This is an explanation, not a diagram.')
      .mockResolvedValueOnce('Still just prose the second time.')

    const req: any = { params: { id: 'doc-10' } }
    const res = fakeRes()
    await getHandler('/:id/diagram', 'post')(req, res, () => {})

    expect(mockAiChat).toHaveBeenCalledTimes(2)
    expect(res.status).toHaveBeenCalledWith(502)
    // Only the initial SELECT ran — no UPDATE attempted, so a previously-good
    // diagram (if any) is never clobbered by a failed regenerate.
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})

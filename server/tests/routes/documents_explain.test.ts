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

vi.mock('../../services/codeChunker.js', () => ({
  extractSymbolOutline: vi.fn(),
}))

vi.mock('../../services/codeIntel/parsers/pythonBridgeParser.js', () => ({
  extractSqlOutline: vi.fn(),
}))

import documentsAiRouter from '../../routes/documents-ai.js'
import { pool } from '../../db/pool.js'
import { aiChat } from '../../services/ai.js'
import { extractSymbolOutline } from '../../services/codeChunker.js'
import { extractSqlOutline } from '../../services/codeIntel/parsers/pythonBridgeParser.js'

const mockQuery      = vi.mocked(pool.query)
const mockAiChat     = vi.mocked(aiChat)
const mockOutline    = vi.mocked(extractSymbolOutline)
const mockSqlOutline = vi.mocked(extractSqlOutline)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsAiRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/:id/explain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOutline.mockResolvedValue(null)
    mockSqlOutline.mockResolvedValue(null)
  })

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

  it('includes the static-analysis symbol outline in the prompt when available', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'sync.py', content: 'def run(): pass', file_type: 'code', language: 'python', content_hash: 'hash-py' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(['def run()'])
    mockAiChat.mockResolvedValue('Runs a sync job.')

    const req: any = { params: { id: 'doc-4' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockOutline).toHaveBeenCalledWith('def run(): pass', 'python')
    expect(mockAiChat.mock.calls[0][0]).toContain('Symbol outline')
    expect(mockAiChat.mock.calls[0][0]).toContain('def run()')
  })

  it('falls back to sql_bridge.py for the outline when language is plsql (tree-sitter has no SQL grammar)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'small.plsql', content: 'CREATE PROCEDURE getstartdate(...) IS BEGIN NULL; END;', file_type: 'code', language: 'plsql', content_hash: 'hash-plsql' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null) // tree-sitter: no sql/plsql grammar
    mockSqlOutline.mockResolvedValue(['PROCEDURE getstartdate(...) (lines 12-88) — writes: totadjustment_inv_temp'])
    mockAiChat.mockResolvedValue('Explanation covering the whole file.')

    const req: any = { params: { id: 'doc-sql' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockSqlOutline).toHaveBeenCalledWith('CREATE PROCEDURE getstartdate(...) IS BEGIN NULL; END;', 'plsql')
    expect(mockAiChat.mock.calls[0][0]).toContain('Symbol outline')
    expect(mockAiChat.mock.calls[0][0]).toContain('getstartdate')
  })

  it('drops the raw truncated source and prompts from the outline alone for a large SQL/PLSQL file (verified: models ignore the outline when both are given together)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'TOT_SAPREVENUE', content: 'x'.repeat(211424), file_type: 'code', language: 'plsql', content_hash: 'hash-big-plsql' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null)
    mockSqlOutline.mockResolvedValue([
      'PROCEDURE getstartdate(...) (lines 12-88) — writes: totadjustment_inv_temp',
      'PROCEDURE proc_zero_invoice(...) (lines 788-967) — writes: totsapinvoicefeeddata_tmp1',
    ])
    mockAiChat.mockResolvedValue('Explanation covering all procedures.')

    const req: any = { params: { id: 'doc-big-sql' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const prompt = mockAiChat.mock.calls[0][0] as string
    expect(prompt).toContain('proc_zero_invoice')
    expect(prompt).toContain('Cover ALL of the procedures/functions listed above')
    // The raw truncated source (a run of 12000 'x' characters) must NOT appear —
    // that's the excerpt models were observed fixating on instead of the outline.
    expect(prompt).not.toContain('x'.repeat(12000))
  })

  it('does not call the sql_bridge.py fallback for non-sql languages', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-ts' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null)
    mockAiChat.mockResolvedValue('Explanation.')

    const req: any = { params: { id: 'doc-ts' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockSqlOutline).not.toHaveBeenCalled()
  })

  it('asks for parameters, data sources, and output in the system prompt', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'migrate.sh', content: 'echo hi', file_type: 'code', language: 'bash', content_hash: 'hash-sh' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockAiChat.mockResolvedValue('Runs a migration.')

    const req: any = { params: { id: 'doc-5' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const systemPrompt = mockAiChat.mock.calls[0][1]
    expect(systemPrompt).toContain('Parameters & Inputs')
    expect(systemPrompt).toContain('Output')
  })

  it('notes truncation in the prompt when content exceeds the source-char cap', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'big.ts', content: 'x'.repeat(12001), file_type: 'code', language: 'typescript', content_hash: 'h6' }],
    } as any)
    mockAiChat.mockResolvedValue('Explanation of a big file.')

    const req: any = { params: { id: 'doc-6' } }
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockAiChat.mock.calls[0][0]).toContain('Source was truncated for length')
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req: any = { params: { id: 'doc-1' } }
    const res = fakeRes()
    await getHandler('/:id/explain', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

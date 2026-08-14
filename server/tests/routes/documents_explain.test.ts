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
  aiChat:       vi.fn(),
  aiChatStream: vi.fn(),
}))

vi.mock('../../services/codeChunker.js', () => ({
  extractSymbolOutline: vi.fn(),
}))

vi.mock('../../services/codeIntel/parsers/pythonBridgeParser.js', () => ({
  extractSqlOutline: vi.fn(),
}))

import documentsAiRouter from '../../routes/documents-ai.js'
import { pool } from '../../db/pool.js'
import { aiChatStream } from '../../services/ai.js'
import { extractSymbolOutline } from '../../services/codeChunker.js'
import { extractSqlOutline } from '../../services/codeIntel/parsers/pythonBridgeParser.js'

const mockQuery       = vi.mocked(pool.query)
const mockAiChatStream = vi.mocked(aiChatStream)
const mockOutline     = vi.mocked(extractSymbolOutline)
const mockSqlOutline  = vi.mocked(extractSqlOutline)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsAiRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeReq(params: Record<string, string>) {
  return { params, on: vi.fn() } as any
}

// Explain streams over SSE now, not a single JSON response — fakeRes captures
// every res.write() call so tests can inspect the emitted `data: {...}` frames,
// alongside the plain status/json mocks still used for the pre-stream 404/400/500
// paths (document lookup + validation happens before SSE headers are sent).
function fakeRes() {
  const writes: string[] = []
  return {
    json:          vi.fn(),
    status:        vi.fn().mockReturnThis(),
    setHeader:     vi.fn(),
    flushHeaders:  vi.fn(),
    write:         vi.fn((chunk: string) => { writes.push(chunk) }),
    end:           vi.fn(),
    writes,
  } as any
}

function sseEvents(res: ReturnType<typeof fakeRes>): any[] {
  return res.writes
    .filter((w: string) => w.startsWith('data: ') && w.trim() !== 'data: [DONE]')
    .map((w: string) => JSON.parse(w.slice(6).trim()))
}

describe('POST /api/documents/:id/explain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOutline.mockResolvedValue(null)
    mockSqlOutline.mockResolvedValue(null)
    // Default: stream a single chunk back, matching most tests' needs.
    mockAiChatStream.mockImplementation(async (_messages, onChunk) => {
      onChunk('Explanation text.')
    })
  })

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req = fakeReq({ id: 'missing' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiChatStream).not.toHaveBeenCalled()
  })

  it('rejects non-code documents', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'notes', content: 'hello', file_type: 'txt', language: null, content_hash: 'h1' }],
    } as any)

    const req = fakeReq({ id: 'doc-1' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChatStream).not.toHaveBeenCalled()
  })

  it('streams and persists an explanation for a code document, stamped with the current content_hash', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-abc' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE

    mockAiChatStream.mockImplementation(async (_messages, onChunk) => {
      onChunk('This file ')
      onChunk('exports a constant.')
    })

    const req = fakeReq({ id: 'doc-2' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    expect(messages[1].content).toContain('typescript')
    expect(messages[1].content).toContain('index.ts')

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'UPDATE documents SET explanation = $2, explanation_hash = $3 WHERE id = $1',
      ['doc-2', 'This file exports a constant.', 'hash-abc']
    )

    const events = sseEvents(res)
    expect(events).toContainEqual({ type: 'chunk', text: 'This file ' })
    expect(events).toContainEqual({ type: 'chunk', text: 'exports a constant.' })
    expect(res.writes[res.writes.length - 1]).toBe('data: [DONE]\n\n')
  })

  it('falls back to a generic "code" label when language is unknown', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'mystery.xyz', content: 'garbled', file_type: 'code', language: null, content_hash: 'h2' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const req = fakeReq({ id: 'doc-3' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    expect(messages[1].content).toContain('```code')
  })

  it('includes the static-analysis symbol outline in the prompt when available', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'sync.py', content: 'def run(): pass', file_type: 'code', language: 'python', content_hash: 'hash-py' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(['def run()'])

    const req = fakeReq({ id: 'doc-4' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockOutline).toHaveBeenCalledWith('def run(): pass', 'python')
    const messages = mockAiChatStream.mock.calls[0][0]
    expect(messages[1].content).toContain('Symbol outline')
    expect(messages[1].content).toContain('def run()')
  })

  it('falls back to sql_bridge.py for the outline when language is plsql (tree-sitter has no SQL grammar)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'small.plsql', content: 'CREATE PROCEDURE getstartdate(...) IS BEGIN NULL; END;', file_type: 'code', language: 'plsql', content_hash: 'hash-plsql' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null) // tree-sitter: no sql/plsql grammar
    mockSqlOutline.mockResolvedValue(['PROCEDURE getstartdate(...) (lines 12-88) — writes: totadjustment_inv_temp'])

    const req = fakeReq({ id: 'doc-sql' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockSqlOutline).toHaveBeenCalledWith('CREATE PROCEDURE getstartdate(...) IS BEGIN NULL; END;', 'plsql')
    const messages = mockAiChatStream.mock.calls[0][0]
    expect(messages[1].content).toContain('Symbol outline')
    expect(messages[1].content).toContain('getstartdate')
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

    const req = fakeReq({ id: 'doc-big-sql' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    const prompt = messages[1].content as string
    expect(prompt).toContain('proc_zero_invoice')
    expect(prompt).toContain('Cover ALL of the items listed above')
    // The raw truncated source (a run of 12000 'x' characters) must NOT appear —
    // that's the excerpt models were observed fixating on instead of the outline.
    expect(prompt).not.toContain('x'.repeat(12000))
  })

  it('drops the raw truncated source for a large non-SQL file too, when a tree-sitter outline is available (not SQL-specific)', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'big_module.py', content: 'x'.repeat(20000), file_type: 'code', language: 'python', content_hash: 'hash-big-py' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(['def run_pipeline()', 'def load_config()'])

    const req = fakeReq({ id: 'doc-big-py' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    expect(mockSqlOutline).not.toHaveBeenCalled()
    const messages = mockAiChatStream.mock.calls[0][0]
    const prompt = messages[1].content as string
    expect(prompt).toContain('Cover ALL of the items listed above')
    expect(prompt).not.toContain('x'.repeat(12000))
  })

  it('uses the compact system prompt for a large outline (>15 items), asking for full coverage rather than a word-count target', async () => {
    const bigOutline = Array.from({ length: 20 }, (_, i) => `PROCEDURE proc_${i}() (lines 1-2)`)
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'TOT_SAPREVENUE', content: 'x'.repeat(211424), file_type: 'code', language: 'plsql', content_hash: 'hash-huge' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null)
    mockSqlOutline.mockResolvedValue(bigOutline)

    const req = fakeReq({ id: 'doc-huge-sql' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    const systemPrompt = messages[0].content as string
    expect(systemPrompt).toContain('list every single item from the outline')
    expect(systemPrompt).not.toContain('400-600 words')
    expect(systemPrompt).not.toContain('200-300 words')

    expect(mockAiChatStream.mock.calls[0][2]).toEqual({ maxTokens: 3000 })
  })

  it('uses the full system prompt for a small outline (<=15 procedures)', async () => {
    const smallOutline = Array.from({ length: 3 }, (_, i) => `PROCEDURE proc_${i}() (lines 1-2)`)
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'small_pkg', content: 'x'.repeat(12001), file_type: 'code', language: 'plsql', content_hash: 'hash-small' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null)
    mockSqlOutline.mockResolvedValue(smallOutline)

    const req = fakeReq({ id: 'doc-small-sql' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    const systemPrompt = messages[0].content as string
    expect(systemPrompt).toContain('400-600 words')
  })

  it('does not call the sql_bridge.py fallback for non-sql languages', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'index.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-ts' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    mockOutline.mockResolvedValue(null)

    const req = fakeReq({ id: 'doc-ts' })
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

    const req = fakeReq({ id: 'doc-5' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    const systemPrompt = messages[0].content as string
    expect(systemPrompt).toContain('Parameters & Inputs')
    expect(systemPrompt).toContain('Output')
  })

  it('notes truncation in the prompt when content exceeds the source-char cap', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ title: 'big.ts', content: 'x'.repeat(12001), file_type: 'code', language: 'typescript', content_hash: 'h6' }],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const req = fakeReq({ id: 'doc-6' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const messages = mockAiChatStream.mock.calls[0][0]
    expect(messages[1].content).toContain('Source was truncated for length')
  })

  it('responds 500 on a failure before the stream opens', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = fakeReq({ id: 'doc-1' })
    const res = fakeRes()
    await getHandler('/:id/explain', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('sends an SSE error event and ends the stream (without a DB write) when generation fails mid-stream', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'flaky.ts', content: 'export const x = 1', file_type: 'code', language: 'typescript', content_hash: 'hash-flaky' }],
    } as any)

    mockAiChatStream.mockRejectedValueOnce(new Error('Ollama chat error 500: model unloaded'))

    const req = fakeReq({ id: 'doc-flaky' })
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')(req, res, () => {})

    const events = sseEvents(res)
    expect(events).toContainEqual({ type: 'error', message: 'Ollama chat error 500: model unloaded' })
    expect(res.writes[res.writes.length - 1]).toBe('data: [DONE]\n\n')
    // Only the initial SELECT ran — no UPDATE, since generation never produced text to persist.
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})

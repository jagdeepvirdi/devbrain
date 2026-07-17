import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env so ai.ts doesn't call process.exit on load
vi.mock('../../lib/env.js', () => ({
  env: {
    OLLAMA_URL:        'http://localhost:11434',
    OLLAMA_CHAT_MODEL: 'test-model',
    AI_PROVIDER:       'ollama',
    ANTHROPIC_API_KEY: undefined,
    GEMINI_API_KEY:    undefined,
    GEMINI_CHAT_MODEL: 'gemini-2.0-flash',
  },
}))

// Mock the DB pool — embedder.ts calls pool.query for DELETE + INSERT
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  },
}))

// Mock aiEmbed — returns a small fixed vector. aiChat defaults to rejecting
// (as if unconfigured/unavailable) so existing tests that don't care about
// summarization see the same "no summary chunk" behavior as before this
// feature existed — summarizeDocument() treats a failure as non-fatal.
vi.mock('../../services/ai.js', () => ({
  aiEmbed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  aiChat:  vi.fn().mockRejectedValue(new Error('not mocked')),
}))

// Mock the reranker — real reranking loads an ONNX model over the network,
// far too slow/flaky for a unit test. Default to a plain pass-through
// truncation so RRF-fusion-focused tests aren't affected by it.
vi.mock('../../services/reranker.js', () => ({
  rerank: vi.fn((_query: string, items: unknown[], _getText: unknown, topN: number) => items.slice(0, topN)),
}))

const { embedDocument, embedDocumentsBatch, searchChunks } = await import('../../services/embedder.js')
const { pool }               = await import('../../db/pool.js')
const { aiEmbed, aiChat }    = await import('../../services/ai.js')
const { rerank }             = await import('../../services/reranker.js')
const mockPool               = pool as unknown as { query: ReturnType<typeof vi.fn> }
const mockAiEmbed            = aiEmbed as unknown as ReturnType<typeof vi.fn>
const mockAiChat             = aiChat as unknown as ReturnType<typeof vi.fn>
const mockRerank             = rerank as unknown as ReturnType<typeof vi.fn>

// Repeated realistic prose (not a repeated single character) so the
// tokenizer's BPE merges don't make length assumptions unreliable.
const LONG_SENTENCE = 'The quick brown fox jumps over the lazy dog near the riverbank. '
const longText = (repeats: number) => LONG_SENTENCE.repeat(repeats)

describe('embedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 })
    mockAiEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockAiChat.mockRejectedValue(new Error('not mocked')) // no summary chunk unless a test opts in
  })

  it('deletes existing chunks before embedding', async () => {
    await embedDocument('doc-1', 'short text')

    const deleteCall = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(deleteCall[0]).toContain('DELETE FROM document_chunks')
    expect(deleteCall[1]).toEqual(['doc-1'])
  })

  it('creates one chunk for short text, even though it is below the min-chunk-token floor', async () => {
    // Regression test: a short-but-real document must not get filtered down
    // to zero chunks (that would make it unsearchable in RAG entirely).
    await embedDocument('doc-1', 'short text')

    expect(mockAiEmbed).toHaveBeenCalledOnce()
    expect(mockAiEmbed).toHaveBeenCalledWith('short text')
  })

  it('returns the chunk count', async () => {
    const count = await embedDocument('doc-1', 'hello world')
    expect(count).toBe(1)
  })

  it('splits long text into multiple token-sized chunks', async () => {
    // ~512 target tokens per chunk; this is comfortably over that.
    const count = await embedDocument('doc-2', longText(80))

    expect(count).toBeGreaterThanOrEqual(2)
    expect(mockAiEmbed).toHaveBeenCalledTimes(count)
  })

  it('inserts one row per chunk into document_chunks', async () => {
    const text  = 'word '.repeat(100)  // short enough for 1 chunk
    await embedDocument('doc-3', text)

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    expect(insertCalls).toHaveLength(1)
    const [, args] = insertCalls[0] as [string, unknown[]]
    expect(args[0]).toBe('doc-3')        // documentId
    expect(args[2]).toBe(0)              // chunk_index
    expect(args[3]).toBe(JSON.stringify([0.1, 0.2, 0.3]))  // embedding
  })

  it('calls onProgress callback for each chunk', async () => {
    const onProgress = vi.fn()
    const count       = await embedDocument('doc-4', longText(80), { onProgress })

    expect(onProgress).toHaveBeenCalledTimes(count)
    // Last call should report done/total correctly
    const lastCall = onProgress.mock.calls[count - 1] as [number, number]
    expect(lastCall[0]).toBe(count)
    expect(lastCall[1]).toBe(count)
  })

  it('prepends the document title as a metadata header on every stored chunk', async () => {
    await embedDocument('doc-5', 'hello world', { title: 'SAP Invoice Feed' })

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    const [, args] = insertCalls[0] as [string, unknown[]]
    expect(args[1]).toBe('[SAP Invoice Feed]\n\nhello world')
  })

  it('does not prepend a header when no title is given', async () => {
    await embedDocument('doc-6', 'hello world')

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    const [, args] = insertCalls[0] as [string, unknown[]]
    expect(args[1]).toBe('hello world')
  })

  it('splits Markdown-headed text at header boundaries', async () => {
    const md = `# Section One\n\n${longText(40)}\n\n# Section Two\n\n${longText(40)}`
    await embedDocument('doc-7', md)

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    const storedChunks = insertCalls.map(c => (c[1] as unknown[])[1] as string)

    expect(storedChunks.some(c => c.startsWith('# Section One'))).toBe(true)
    expect(storedChunks.some(c => c.startsWith('# Section Two'))).toBe(true)
  })

  it('stores a document-level summary as a chunk_index = -1 sentinel row when summarization succeeds', async () => {
    mockAiChat.mockResolvedValueOnce('This document describes the SAP invoice feed integration.')

    await embedDocument('doc-8', 'hello world', { title: 'SAP Invoice Feed' })

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    const summaryInsert = insertCalls.find(c => (c[1] as unknown[])[2] === -1)
    expect(summaryInsert).toBeDefined()
    expect((summaryInsert![1] as unknown[])[1]).toBe(
      '[SAP Invoice Feed]\n\nThis document describes the SAP invoice feed integration.'
    )
  })

  it('does not store a summary row when summarization fails, and still embeds the real chunks', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ollama down'))

    const count = await embedDocument('doc-9', 'hello world')

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    expect(insertCalls.some(c => (c[1] as unknown[])[2] === -1)).toBe(false)
    expect(insertCalls).toHaveLength(count) // only real content chunks, no extra summary row
  })

  it('does not count the summary row in the returned chunk count', async () => {
    mockAiChat.mockResolvedValueOnce('A short summary.')

    const count = await embedDocument('doc-10', 'hello world')

    expect(count).toBe(1) // just the one real chunk for this short text
  })
})

describe('embedDocumentsBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 })
    mockAiEmbed.mockResolvedValue([0.1, 0.2, 0.3])
    mockAiChat.mockRejectedValue(new Error('not mocked'))
  })

  it('returns an empty array and makes no calls for an empty batch', async () => {
    const results = await embedDocumentsBatch([])
    expect(results).toEqual([])
    expect(mockPool.query).not.toHaveBeenCalled()
  })

  it('deletes existing chunks for every doc in the batch with one query', async () => {
    await embedDocumentsBatch([
      { id: 'doc-1', content: 'hello' },
      { id: 'doc-2', content: 'world' },
    ])

    const deleteCall = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(deleteCall[0]).toContain('DELETE FROM document_chunks')
    expect(deleteCall[1]).toEqual([['doc-1', 'doc-2']])
  })

  it('runs every document\'s summary (chat) call before any chunk (embed) call — the whole point of batching', async () => {
    mockAiChat.mockResolvedValue('a summary')
    const order: string[] = []
    mockAiChat.mockImplementation(async () => { order.push('chat'); return 'a summary' })
    mockAiEmbed.mockImplementation(async () => { order.push('embed'); return [0.1, 0.2, 0.3] })

    await embedDocumentsBatch([
      { id: 'doc-1', content: 'first document text' },
      { id: 'doc-2', content: 'second document text' },
      { id: 'doc-3', content: 'third document text' },
    ])

    const firstEmbedIndex = order.indexOf('embed')
    const lastChatIndex   = order.lastIndexOf('chat')
    expect(order.filter(o => o === 'chat')).toHaveLength(3) // one summary per doc
    expect(lastChatIndex).toBeLessThan(firstEmbedIndex) // all chats before any embed
  })

  it('returns a chunk count per document', async () => {
    const results = await embedDocumentsBatch([
      { id: 'doc-1', content: 'hello world' },
      { id: 'doc-2', content: 'goodbye world' },
    ])

    expect(results).toEqual([
      { id: 'doc-1', chunkCount: 1 },
      { id: 'doc-2', chunkCount: 1 },
    ])
  })

  it('reports title-header chunk text, keyed correctly per document', async () => {
    await embedDocumentsBatch([
      { id: 'doc-1', content: 'hello', title: 'Doc One' },
      { id: 'doc-2', content: 'world' },
    ])

    const insertCalls = mockPool.query.mock.calls.filter(
      (c: unknown[]) => (c[0] as string).includes('INSERT INTO document_chunks')
    )
    const doc1Chunk = insertCalls.find(c => (c[1] as unknown[])[0] === 'doc-1')!
    const doc2Chunk = insertCalls.find(c => (c[1] as unknown[])[0] === 'doc-2')!
    expect((doc1Chunk[1] as unknown[])[1]).toBe('[Doc One]\n\nhello')
    expect((doc2Chunk[1] as unknown[])[1]).toBe('world')
  })

  it('isolates one document\'s embed failure — reports its error without aborting the rest of the batch', async () => {
    mockAiEmbed.mockImplementation(async (text: string) => {
      if (text === 'bad content') throw new Error('ollama unavailable')
      return [0.1, 0.2, 0.3]
    })

    const results = await embedDocumentsBatch([
      { id: 'doc-1', content: 'bad content' },
      { id: 'doc-2', content: 'good content' },
    ])

    expect(results).toEqual([
      { id: 'doc-1', chunkCount: 0, error: 'ollama unavailable' },
      { id: 'doc-2', chunkCount: 1 },
    ])
  }, 10_000) // embedWithRetry's 3 attempts with backoff delays push past the default 5s timeout

  it('fires onProgress per document with the document id', async () => {
    const onProgress = vi.fn()
    await embedDocumentsBatch(
      [{ id: 'doc-1', content: 'hello world' }, { id: 'doc-2', content: 'goodbye world' }],
      onProgress
    )

    expect(onProgress).toHaveBeenCalledWith('doc-1', 1, 1)
    expect(onProgress).toHaveBeenCalledWith('doc-2', 1, 1)
  })
})

describe('searchChunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.query.mockResolvedValue({ rows: [] })
  })

  it('scopes to documentId alone, ignoring projectId/component when documentId is given', async () => {
    await searchChunks([0.1, 0.2], 'what is SAP invoice feed?', { documentId: 'doc-1', projectId: 'proj-1', component: 'SAP' })

    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('dc.document_id = $4')
    expect(sql).not.toContain('d.project_id')
    expect(sql).not.toContain('d.component')
    // Final param is the widened rerank-candidate pool size (20), not the
    // caller's requested `limit` (5) — reranking cuts it down afterward.
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 'what is SAP invoice feed?', 20, 'doc-1', 20])
  })

  it('combines projectId and component with AND when both are given', async () => {
    await searchChunks([0.1, 0.2], 'question', { projectId: 'proj-1', component: 'SAP' })

    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('d.project_id = $4')
    expect(sql).toContain('d.component = $5')
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 'question', 20, 'proj-1', 'SAP', 20])
  })

  it('scopes to component alone when no project is selected', async () => {
    await searchChunks([0.1, 0.2], 'question', { component: 'BPP' })

    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('d.project_id')
    expect(sql).toContain('d.component = $4')
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 'question', 20, 'BPP', 20])
  })

  it('applies no scoping condition when nothing is given', async () => {
    await searchChunks([0.1, 0.2], 'question', {})

    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('d.project_id')
    expect(sql).not.toContain('d.component')
    expect(sql).not.toContain('dc.document_id =')
    expect(params).toEqual([JSON.stringify([0.1, 0.2]), 'question', 20, 20])
  })

  it('passes the score-filtered candidates to the reranker, cut to the requested limit', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { chunk: 'a', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 },
        { chunk: 'b', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 1, score: 0.5 },
      ],
    })

    await searchChunks([0.1, 0.2], 'sap invoice', { limit: 3 })

    expect(mockRerank).toHaveBeenCalledWith(
      'sap invoice',
      expect.arrayContaining([expect.objectContaining({ chunk: 'a' }), expect.objectContaining({ chunk: 'b' })]),
      expect.any(Function),
      3
    )
  })

  it('fuses vector and full-text ranks via RRF, passing the question text to plainto_tsquery', async () => {
    await searchChunks([0.1, 0.2], 'sap payment reconciliation', {})

    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('vector_hits')
    expect(sql).toContain('text_hits')
    expect(sql).toContain("plainto_tsquery('english', $2)")
    expect(sql).toContain('ts_rank_cd')
    expect(sql).toContain('UNION ALL')
    expect(sql).toContain('SUM(1.0 / (60 + rank))')
    expect(params[1]).toBe('sap payment reconciliation')
  })

  it('drops results below the minimum relevance score', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { chunk: 'strong match',  documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.8 },
        { chunk: 'weak match',    documentId: 'd1', documentTitle: 'Doc', chunkIndex: 1, score: 0.1 },
      ],
    })

    const results = await searchChunks([0.1, 0.2], 'question', {})

    expect(results).toHaveLength(1)
    expect(results[0].chunk).toBe('strong match')
  })

  it('backfills from given chunk ids when fused candidates are thin', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ id: 'c1', chunk: 'main result', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 }],
      } as any) // main hybrid query — 1 candidate, below BACKFILL_THRESHOLD (3)
      .mockResolvedValueOnce({
        rows: [{ id: 'c2', chunk: 'backfilled result', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 5, score: 0.6 }],
      } as any) // backfill query

    const results = await searchChunks([0.1, 0.2], 'question', { backfillChunkIds: ['c2', 'c3'] })

    const [backfillSql, backfillParams] = mockPool.query.mock.calls[1] as [string, unknown[]]
    expect(backfillSql).toContain('dc.id = ANY($1)')
    expect(backfillParams[0]).toEqual(['c2', 'c3'])
    expect(results.map(r => r.chunk)).toEqual(expect.arrayContaining(['main result', 'backfilled result']))
  })

  it('does not backfill when there are already enough fused candidates', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        { id: 'c1', chunk: 'a', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 },
        { id: 'c2', chunk: 'b', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 1, score: 0.8 },
        { id: 'c3', chunk: 'c', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 2, score: 0.7 },
      ],
    } as any)

    await searchChunks([0.1, 0.2], 'question', { backfillChunkIds: ['c4', 'c5'] })

    expect(mockPool.query).toHaveBeenCalledTimes(1) // no second (backfill) query
  })

  it('scopes the backfill lookup to the same document as the main search', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] } as any) // main query — 0 candidates
      .mockResolvedValueOnce({ rows: [] } as any) // backfill query

    await searchChunks([0.1, 0.2], 'question', { documentId: 'doc-9', backfillChunkIds: ['c1'] })

    const [backfillSql, backfillParams] = mockPool.query.mock.calls[1] as [string, unknown[]]
    expect(backfillSql).toContain('dc.document_id = $3')
    expect(backfillParams).toEqual([['c1'], JSON.stringify([0.1, 0.2]), 'doc-9'])
  })

  it('skips backfill entirely when no backfillChunkIds are given', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] } as any)

    await searchChunks([0.1, 0.2], 'question', {})

    expect(mockPool.query).toHaveBeenCalledTimes(1)
  })
})

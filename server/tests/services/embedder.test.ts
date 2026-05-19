import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock env so ai.ts doesn't call process.exit on load
vi.mock('../../lib/env.js', () => ({
  env: {
    OLLAMA_URL:        'http://localhost:11434',
    OLLAMA_CHAT_MODEL: 'test-model',
    USE_CLAUDE:        false,
    ANTHROPIC_API_KEY: undefined,
  },
}))

// Mock the DB pool — embedder.ts calls pool.query for DELETE + INSERT
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
  },
}))

// Mock aiEmbed — returns a small fixed vector
vi.mock('../../services/ai.js', () => ({
  aiEmbed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}))

const { embedDocument }      = await import('../../services/embedder.js')
const { pool }               = await import('../../db/pool.js')
const { aiEmbed }            = await import('../../services/ai.js')
const mockPool               = pool as unknown as { query: ReturnType<typeof vi.fn> }
const mockAiEmbed            = aiEmbed as unknown as ReturnType<typeof vi.fn>

const CHUNK_CHARS = 1800

describe('embedDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 })
    mockAiEmbed.mockResolvedValue([0.1, 0.2, 0.3])
  })

  it('deletes existing chunks before embedding', async () => {
    await embedDocument('doc-1', 'short text')

    const deleteCall = mockPool.query.mock.calls[0] as [string, unknown[]]
    expect(deleteCall[0]).toContain('DELETE FROM document_chunks')
    expect(deleteCall[1]).toEqual(['doc-1'])
  })

  it('creates one chunk and one embed call for short text', async () => {
    await embedDocument('doc-1', 'short text')

    expect(mockAiEmbed).toHaveBeenCalledOnce()
    expect(mockAiEmbed).toHaveBeenCalledWith('short text')
  })

  it('returns the chunk count', async () => {
    const count = await embedDocument('doc-1', 'hello world')
    expect(count).toBe(1)
  })

  it('splits long text into multiple chunks', async () => {
    // Text longer than one CHUNK_CHARS window → at least 2 chunks
    const longText = 'a'.repeat(CHUNK_CHARS + 500)
    const count    = await embedDocument('doc-2', longText)

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
    const text       = 'b'.repeat(CHUNK_CHARS * 2 + 100)
    const count      = await embedDocument('doc-4', text, onProgress)

    expect(onProgress).toHaveBeenCalledTimes(count)
    // Last call should report done/total correctly
    const lastCall = onProgress.mock.calls[count - 1] as [number, number]
    expect(lastCall[0]).toBe(count)
    expect(lastCall[1]).toBe(count)
  })
})

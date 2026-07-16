import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiEmbed:      vi.fn(),
  aiChat:       vi.fn(),
  aiChatStream: vi.fn(),
}))

// countTokens is real tiktoken counting (fast, pure JS, no network) — only
// searchChunks is stubbed, so Full Context Mode's token-budget check behaves
// exactly like production instead of needing its own fake heuristic.
vi.mock('../../services/embedder.js', async () => {
  const actual = await vi.importActual('../../services/embedder.js') as Record<string, unknown>
  return {
    searchChunks: vi.fn(),
    countTokens:  actual.countTokens,
  }
})

import chatRouter from '../../routes/chat.js'
import { pool } from '../../db/pool.js'
import { aiEmbed, aiChat, aiChatStream } from '../../services/ai.js'
import { searchChunks } from '../../services/embedder.js'

const mockQuery       = vi.mocked(pool.query)
const mockAiEmbed     = vi.mocked(aiEmbed)
const mockAiChat      = vi.mocked(aiChat)
const mockAiChatStream = vi.mocked(aiChatStream)
const mockSearchChunks = vi.mocked(searchChunks)

function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (chatRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeSseRes() {
  const written: string[] = []
  return {
    setHeader:    vi.fn(),
    flushHeaders: vi.fn(),
    write:        vi.fn((chunk: string) => { written.push(chunk) }),
    end:          vi.fn(),
    status:       vi.fn().mockReturnThis(),
    json:         vi.fn(),
    _written:     written,
  } as any
}

function fakeJsonRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() } as any
}

function parseSseEvents(written: string[]) {
  return written
    .filter(w => w.startsWith('data: '))
    .map(w => w.slice(6).trim())
    .filter(w => w !== '[DONE]')
    .map(w => JSON.parse(w))
}

describe('POST /api/chat — session lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([0.1, 0.2])
    // Empty string → rewriteQuery() treats it as "no rewrite" and returns null,
    // so tests that don't care about query rewriting aren't affected by it.
    mockAiChat.mockResolvedValue('')
    mockAiChatStream.mockImplementation(async (_msgs, onChunk) => { onChunk('Hi there') })
  })

  it('creates a new session when no sessionId is given, and emits it as the first SSE event', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] } as any) // INSERT chat_sessions
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT chat_messages (user)
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE chat_sessions touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'hello', citations: null, created_at: 't1' }] } as any) // loadHistory
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT chat_messages (assistant)
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE chat_sessions touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'hello' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    const events = parseSseEvents(res._written)
    expect(events[0]).toEqual({ type: 'session', sessionId: 'sess-1' })

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO chat_sessions'),
      ['u1', null, null, 'hello']
    )
  })

  it('reuses an existing sessionId when it belongs to the requesting user', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-2' }] } as any) // session ownership check
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT chat_messages (user)
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'follow up', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'follow up', sessionId: 'sess-2' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2',
      ['sess-2', 'u1']
    )
    const events = parseSseEvents(res._written)
    expect(events[0]).toEqual({ type: 'session', sessionId: 'sess-2' })
  })

  it('returns 404 without opening the SSE stream when sessionId does not belong to the user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // ownership check finds nothing

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'hi', sessionId: 'not-mine' }, on: vi.fn() }
    const res = fakeJsonRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Chat session not found' })
  })

  it('includes prior conversation turns before the current question in the LLM prompt', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-3' }] } as any) // ownership check
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT chat_messages (user)
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
      .mockResolvedValueOnce({
        // Raw SQL result is ORDER BY created_at DESC (newest first) — loadHistory()
        // reverses it back to chronological order before building the prompt.
        rows: [
          { id: 'm3', role: 'user',      content: 'what about the second one?', citations: null, created_at: 't3' },
          { id: 'm2', role: 'assistant', content: 'It syncs invoices to SAP.', citations: [],   created_at: 't2' },
          { id: 'm1', role: 'user',      content: 'what is SAP invoice feed?', citations: null, created_at: 't1' },
        ],
      } as any) // loadHistory
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    // Non-empty results — the zero-results path is a canned short-circuit
    // (see Phase 32.5) that never reaches aiChatStream at all, so this test
    // needs real results to exercise prompt construction.
    mockSearchChunks.mockResolvedValue([
      { id: 'chunk-1', chunk: 'SAP invoice feed content', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 },
    ])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'what about the second one?', sessionId: 'sess-3' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    const [messagesArg] = mockAiChatStream.mock.calls[0]
    expect(messagesArg[0].role).toBe('system')
    expect(messagesArg[1]).toEqual({ role: 'user', content: 'what is SAP invoice feed?' })
    expect(messagesArg[2]).toEqual({ role: 'assistant', content: 'It syncs invoices to SAP.' })
    expect(messagesArg[messagesArg.length - 1]).toEqual({ role: 'user', content: 'what about the second one?' })
  })

  it('passes recently-cited chunk ids as backfill candidates to searchChunks', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-4' }] } as any) // ownership check
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT user message
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
      .mockResolvedValueOnce({
        rows: [
          { id: 'm3', role: 'user',      content: 'what about the second one?', citations: null, created_at: 't3' },
          { id: 'm2', role: 'assistant', content: 'answer', citations: [{ id: 'chunk-abc' }, { id: 'chunk-def' }], created_at: 't2' },
          { id: 'm1', role: 'user',      content: 'first question', citations: null, created_at: 't1' },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'what about the second one?', sessionId: 'sess-4' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockSearchChunks).toHaveBeenCalledWith(
      [0.1, 0.2],
      'what about the second one?',
      expect.objectContaining({ backfillChunkIds: expect.arrayContaining(['chunk-abc', 'chunk-def']) })
    )
  })

  it('rewrites the question and retries retrieval when both search and backfill come up empty', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-5' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({
        rows: [
          { id: 'm2', role: 'user',      content: 'what about the second one?', citations: null, created_at: 't2' },
          { id: 'm1', role: 'assistant', content: 'It syncs invoices to SAP.', citations: [], created_at: 't1' },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([]) // both the initial and retried call return empty
    mockAiChat.mockResolvedValue('SAP invoice feed second component')
    mockAiEmbed.mockResolvedValueOnce([0.1, 0.2]).mockResolvedValueOnce([0.3, 0.4])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'what about the second one?', sessionId: 'sess-5' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockAiChat).toHaveBeenCalledOnce()
    expect(mockSearchChunks).toHaveBeenCalledTimes(2)
    expect(mockSearchChunks).toHaveBeenNthCalledWith(
      2,
      [0.3, 0.4],
      'SAP invoice feed second component',
      expect.anything()
    )
  })

  it('does not attempt a rewrite when there is no prior conversation', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-6' }] } as any) // INSERT chat_sessions (new)
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT user message
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'brand new question', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'brand new question' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockAiChat).not.toHaveBeenCalled()
    expect(mockSearchChunks).toHaveBeenCalledOnce()
  })

  it('short-circuits with a canned response when nothing clears the relevance threshold, skipping the LLM call entirely', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-8' }] } as any) // INSERT chat_sessions (new)
      .mockResolvedValueOnce({ rows: [] } as any)                 // INSERT user message
      .mockResolvedValueOnce({ rows: [] } as any)                 // UPDATE touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'unrelated question', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant (canned answer)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'unrelated question' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockAiChatStream).not.toHaveBeenCalled()

    const events = parseSseEvents(res._written)
    const chunkEvent = events.find(e => e.type === 'chunk')
    expect(chunkEvent.text).toContain("don't see anything")

    const savedAssistantMsg = mockQuery.mock.calls.find(
      c => (c[0] as string).includes('INSERT INTO chat_messages') && (c[1] as unknown[])[1] === 'assistant'
    )
    // citations = [] is truthy in JS, so saveMessage() stringifies it to '[]' rather than storing null.
    expect(savedAssistantMsg?.[1]).toEqual(['sess-8', 'assistant', chunkEvent.text, '[]'])
  })

  it('whitelists valid citation numbers in the RAG system prompt', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-9' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'q', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
    mockSearchChunks.mockResolvedValue([
      { id: 'c1', chunk: 'first excerpt',  documentId: 'd1', documentTitle: 'Doc A', chunkIndex: 0, score: 0.9 },
      { id: 'c2', chunk: 'second excerpt', documentId: 'd2', documentTitle: 'Doc B', chunkIndex: 3, score: 0.7 },
    ])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'q' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    const [messagesArg] = mockAiChatStream.mock.calls[0]
    const systemPrompt = messagesArg[0].content as string
    expect(systemPrompt).toContain('CITATION RULES')
    expect(systemPrompt).toContain('You may cite ONLY these excerpt numbers: [1], [2]')
    expect(systemPrompt).toContain('Never invent a citation number')
  })

  it('includes the chunk id in citations, for future backfill', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-7' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'q', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
    mockSearchChunks.mockResolvedValue([
      { id: 'chunk-xyz', chunk: 'content', documentId: 'd1', documentTitle: 'Doc', chunkIndex: 0, score: 0.9 },
    ])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'q', sessionId: 'sess-7' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    const events = parseSseEvents(res._written)
    const citationsEvent = events.find(e => e.type === 'citations')
    expect(citationsEvent.citations[0].id).toBe('chunk-xyz')
  })
})

describe('POST /api/chat — Full Context Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAiEmbed.mockResolvedValue([0.1, 0.2])
    mockAiChat.mockResolvedValue('')
    mockAiChatStream.mockImplementation(async (_msgs, onChunk) => { onChunk('Full doc answer') })
  })

  it('skips chunk retrieval entirely for a short single document', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-10' }] } as any) // INSERT chat_sessions
      .mockResolvedValueOnce({ rows: [] } as any)                  // INSERT user message
      .mockResolvedValueOnce({ rows: [] } as any)                  // UPDATE touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'summarize this', citations: null, created_at: 't1' }] } as any) // loadHistory
      .mockResolvedValueOnce({ rows: [{ title: 'Short Doc', content: 'This is a short document.' }] } as any) // tryFullContextMode
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'summarize this', documentId: 'doc-1' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockSearchChunks).not.toHaveBeenCalled()

    const events = parseSseEvents(res._written)
    const citationsEvent = events.find(e => e.type === 'citations')
    expect(citationsEvent.citations).toEqual([
      { index: 1, id: '', documentId: 'doc-1', documentTitle: 'Short Doc', chunkIndex: -2, score: 1, excerpt: 'Full document used as context' },
    ])

    const [messagesArg] = mockAiChatStream.mock.calls[0]
    expect(messagesArg[0].content).toContain('This is a short document.')
  })

  it('falls through to normal retrieval when the document is too long for full context', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-11' }] } as any) // INSERT chat_sessions
      .mockResolvedValueOnce({ rows: [] } as any)                  // INSERT user message
      .mockResolvedValueOnce({ rows: [] } as any)                  // UPDATE touch
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'q', citations: null, created_at: 't1' }] } as any) // loadHistory
      .mockResolvedValueOnce({ rows: [{ title: 'Long Doc', content: 'word '.repeat(5000) }] } as any) // tryFullContextMode — too many tokens
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant (falls through to the no-results short-circuit)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'q', documentId: 'doc-2' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockSearchChunks).toHaveBeenCalled()
  })

  it('does not attempt Full Context Mode when no documentId is given', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-12' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'q', citations: null, created_at: 't1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // INSERT assistant (no-results short-circuit)
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE touch
    mockSearchChunks.mockResolvedValue([])

    const req: any = { user: { id: 'u1', role: 'admin' }, body: { question: 'q' }, on: vi.fn() }
    const res = fakeSseRes()

    await getHandler('/', 'post')(req, res, () => {})

    // No extra "SELECT title, content" call for the full-context check —
    // only the 6 calls the normal no-documentId, no-results path makes.
    expect(mockQuery).toHaveBeenCalledTimes(6)
    expect(mockSearchChunks).toHaveBeenCalled()
  })
})

describe('GET /api/chat/sessions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists sessions scoped to the current user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 's1', title: 'SAP chat' }] } as any)

    const req: any = { user: { id: 'u1' }, query: {} }
    const res = fakeJsonRes()

    await getHandler('/sessions', 'get')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('WHERE s.user_id = $1'), ['u1'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 's1', title: 'SAP chat' }] })
  })

  it('adds a project filter when projectId is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { user: { id: 'u1' }, query: { projectId: 'proj-1' } }
    const res = fakeJsonRes()

    await getHandler('/sessions', 'get')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('AND s.project_id = $2'),
      ['u1', 'proj-1']
    )
  })
})

describe('GET /api/chat/sessions/:id/messages', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the session is not owned by the user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { user: { id: 'u1' }, params: { id: 'sess-x' } }
    const res = fakeJsonRes()

    await getHandler('/sessions/:id/messages', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns messages in chronological order for an owned session', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'm1', role: 'user', content: 'hi' }] } as any)

    const req: any = { user: { id: 'u1' }, params: { id: 'sess-1' } }
    const res = fakeJsonRes()

    await getHandler('/sessions/:id/messages', 'get')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'm1', role: 'user', content: 'hi' }] })
  })
})

describe('DELETE /api/chat/sessions/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes an owned session', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'sess-1' }] } as any)

    const req: any = { user: { id: 'u1' }, params: { id: 'sess-1' } }
    const res = fakeJsonRes()

    await getHandler('/sessions/:id', 'delete')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      ['sess-1', 'u1']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: 'sess-1' } })
  })

  it('404s when deleting a session that is not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { user: { id: 'u1' }, params: { id: 'not-mine' } }
    const res = fakeJsonRes()

    await getHandler('/sessions/:id', 'delete')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })
})

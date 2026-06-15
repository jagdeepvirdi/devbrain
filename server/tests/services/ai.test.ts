import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock env before the module loads
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

// Import after mocks are registered
const { aiChat, aiEmbed, aiChatStream, ollamaReady } = await import('../../services/ai.js')

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
    body: null,
  } as unknown as Response
}

// ── aiChat (Ollama path) ──────────────────────────────────────────────────────

describe('aiChat — Ollama path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('calls the Ollama chat endpoint and returns message content', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeJsonResponse({ message: { content: 'Hello from Ollama' } })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await aiChat('What is 2+2?', 'You are a math tutor.')

    expect(result).toBe('Hello from Ollama')
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:11434/api/chat')
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(false)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('What is 2+2?')
  })

  it('throws when Ollama returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('Bad Request', false, 400)))

    await expect(aiChat('hi', 'sys')).rejects.toThrow(/Ollama chat error 400/)
  })
})

// ── aiEmbed ───────────────────────────────────────────────────────────────────

describe('aiEmbed', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls the Ollama embeddings endpoint and returns the vector', async () => {
    const vector = [0.1, 0.2, 0.3]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse({ embedding: vector })))

    const result = await aiEmbed('hello world')

    expect(result).toEqual(vector)
    const [url] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [string]
    expect(url).toBe('http://localhost:11434/api/embeddings')
  })

  it('throws when Ollama embed returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('error', false, 500)))

    await expect(aiEmbed('text')).rejects.toThrow(/Ollama embed error 500/)
  })
})

// ── aiChatStream (Ollama path) ────────────────────────────────────────────────

describe('aiChatStream — Ollama path', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('calls onChunk for each streamed token', async () => {
    const lines = [
      JSON.stringify({ message: { content: 'Hello' } }),
      JSON.stringify({ message: { content: ' world' } }),
      JSON.stringify({ done: true }),
    ]
    const encoder  = new TextEncoder()
    const chunks   = lines.map(l => encoder.encode(l + '\n'))
    let   chunkIdx = 0

    const mockReader = {
      read: vi.fn().mockImplementation(() => {
        if (chunkIdx < chunks.length) {
          return Promise.resolve({ done: false, value: chunks[chunkIdx++] })
        }
        return Promise.resolve({ done: true, value: undefined })
      }),
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok:   true,
      body: { getReader: () => mockReader },
    }))

    const tokens: string[] = []
    await aiChatStream([{ role: 'user', content: 'hi' }], chunk => tokens.push(chunk))

    expect(tokens).toEqual(['Hello', ' world'])
  })

  it('throws when stream response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('Err', false, 503)))

    await expect(
      aiChatStream([{ role: 'user', content: 'hi' }], () => {})
    ).rejects.toThrow(/Ollama stream error 503/)
  })
})

// ── ollamaReady ───────────────────────────────────────────────────────────────

describe('ollamaReady', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns true when Ollama responds ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    expect(await ollamaReady()).toBe(true)
  })

  it('returns false when Ollama is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(await ollamaReady()).toBe(false)
  })

  it('returns false when Ollama responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await ollamaReady()).toBe(false)
  })
})

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
const { env } = await import('../../lib/env.js')

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

  it('skips a malformed NDJSON line instead of throwing', async () => {
    const lines = [
      JSON.stringify({ message: { content: 'Hello' } }),
      'not-json{',
      JSON.stringify({ message: { content: ' world' } }),
    ]
    const encoder  = new TextEncoder()
    const chunks   = lines.map(l => encoder.encode(l + '\n'))
    let   chunkIdx = 0
    const mockReader = {
      read: vi.fn().mockImplementation(() => chunkIdx < chunks.length
        ? Promise.resolve({ done: false, value: chunks[chunkIdx++] })
        : Promise.resolve({ done: true, value: undefined })),
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => mockReader } }))

    const tokens: string[] = []
    await aiChatStream([{ role: 'user', content: 'hi' }], chunk => tokens.push(chunk))

    expect(tokens).toEqual(['Hello', ' world'])
  })
})

// ── aiChat (Claude path) ───────────────────────────────────────────────────────

describe('aiChat — Claude path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    env.AI_PROVIDER = 'claude'
    env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.AI_PROVIDER = 'ollama'
  })

  it('calls the Claude API with the system prompt separated and returns the text', async () => {
    const mockFetch = vi.fn().mockResolvedValue(makeJsonResponse({ content: [{ text: 'Hello from Claude' }] }))
    vi.stubGlobal('fetch', mockFetch)

    const result = await aiChat('hi', 'sys')

    expect(result).toBe('Hello from Claude')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('test-key')
    const body = JSON.parse(opts.body as string)
    expect(body.system).toBe('sys')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('throws when Claude returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('Bad', false, 401)))
    await expect(aiChat('hi', 'sys')).rejects.toThrow(/Claude API error 401/)
  })
})

// ── aiChat (Gemini path) ───────────────────────────────────────────────────────

describe('aiChat — Gemini path', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    env.AI_PROVIDER = 'gemini'
    env.GEMINI_API_KEY = 'gem-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.AI_PROVIDER = 'ollama'
  })

  it('calls the Gemini API and returns the text', async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      makeJsonResponse({ candidates: [{ content: { parts: [{ text: 'Hi from Gemini' }] } }] })
    )
    vi.stubGlobal('fetch', mockFetch)

    const result = await aiChat('hi', 'sys')

    expect(result).toBe('Hi from Gemini')
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('gemini-2.0-flash:generateContent?key=gem-key')
    const body = JSON.parse(opts.body as string)
    expect(body.system_instruction.parts[0].text).toBe('sys')
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  it('throws when Gemini returns a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('err', false, 429)))
    await expect(aiChat('hi', 'sys')).rejects.toThrow(/Gemini API error 429/)
  })
})

// ── aiChatStream (Claude path) ──────────────────────────────────────────────────

describe('aiChatStream — Claude path', () => {
  beforeEach(() => {
    env.AI_PROVIDER = 'claude'
    env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.AI_PROVIDER = 'ollama'
  })

  it('parses SSE content_block_delta events, skipping non-matching events and malformed JSON', async () => {
    const lines = [
      'event: message_start',
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello' } })}`,
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { text: ' world' } })}`,
      `data: ${JSON.stringify({ type: 'ping' })}`, // no delta.text -> skipped
      'data: not-json{',                            // malformed -> skipped
    ]
    const encoder = new TextEncoder()
    const chunks  = lines.map(l => encoder.encode(l + '\n'))
    let   idx     = 0
    const mockReader = {
      read: vi.fn().mockImplementation(() => idx < chunks.length
        ? Promise.resolve({ done: false, value: chunks[idx++] })
        : Promise.resolve({ done: true, value: undefined })),
    }
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => mockReader } })
    vi.stubGlobal('fetch', mockFetch)

    const tokens: string[] = []
    await aiChatStream([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], c => tokens.push(c))

    expect(tokens).toEqual(['Hello', ' world'])
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.system).toBe('sys')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
  })

  it('throws when the Claude stream response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('bad', false, 500)))
    await expect(aiChatStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow(/Claude stream error 500/)
  })
})

// ── aiChatStream (Gemini path) ──────────────────────────────────────────────────

describe('aiChatStream — Gemini path', () => {
  beforeEach(() => {
    env.AI_PROVIDER = 'gemini'
    env.GEMINI_API_KEY = 'gem-key'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    env.AI_PROVIDER = 'ollama'
  })

  it('parses SSE candidate text, skipping a candidate with no text and malformed JSON, with a system message', async () => {
    const lines = [
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hi' }] } }] })}`,
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{}] } }] })}`, // no text -> skipped
      'data: not-json{',
    ]
    const encoder = new TextEncoder()
    const chunks  = lines.map(l => encoder.encode(l + '\n'))
    let   idx     = 0
    const mockReader = {
      read: vi.fn().mockImplementation(() => idx < chunks.length
        ? Promise.resolve({ done: false, value: chunks[idx++] })
        : Promise.resolve({ done: true, value: undefined })),
    }
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => mockReader } })
    vi.stubGlobal('fetch', mockFetch)

    const tokens: string[] = []
    await aiChatStream([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }], c => tokens.push(c))

    expect(tokens).toEqual(['Hi'])
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('streamGenerateContent')
    expect(url).toContain('alt=sse')
    const body = JSON.parse(opts.body as string)
    expect(body.system_instruction.parts[0].text).toBe('sys')
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }])
  })

  it('omits system_instruction and maps assistant to model when there is no system message', async () => {
    const mockReader = { read: vi.fn().mockResolvedValue({ done: true, value: undefined }) }
    const mockFetch  = vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => mockReader } })
    vi.stubGlobal('fetch', mockFetch)

    await aiChatStream([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'prior' }], () => {})

    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.system_instruction).toBeUndefined()
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'hi' }] },
      { role: 'model', parts: [{ text: 'prior' }] },
    ])
  })

  it('throws when the Gemini stream response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeJsonResponse('bad', false, 500)))
    await expect(aiChatStream([{ role: 'user', content: 'hi' }], () => {})).rejects.toThrow(/Gemini stream error 500/)
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

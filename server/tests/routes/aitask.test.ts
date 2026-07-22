import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
  aiChatStream: vi.fn(),
}))

vi.mock('../../services/notifications.js', () => ({
  createNotification: vi.fn(),
}))

import aitaskRouter from '../../routes/aitask.js'
import { pool } from '../../db/pool.js'
import { aiChat, aiChatStream } from '../../services/ai.js'
import { createNotification } from '../../services/notifications.js'

const mockQuery = vi.mocked(pool.query)
const mockAiChat = vi.mocked(aiChat)
const mockAiChatStream = vi.mocked(aiChatStream)
const mockCreateNotification = vi.mocked(createNotification)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post') {
  const layer = (aitaskRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json:   vi.fn(),
    write:  vi.fn(),
    end:    vi.fn(),
    setHeader: vi.fn(),
  }
}

function fakeReq(body: Record<string, unknown>) {
  return { body, user: { id: 'u1' } }
}

describe('POST /api/aitask — validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when task is missing', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({}), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('400s when task is empty', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ task: '' }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s when task exceeds 4000 characters', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ task: 'x'.repeat(4001) }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s on an invalid format value', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ task: 'hi', format: 'bogus' }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('POST /api/aitask — non-streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] } as never) // no notification_rules row -> default enabled
  })

  it('returns the AI result with the (default) markdown format, and appends the format instruction to the system prompt', async () => {
    mockAiChat.mockResolvedValueOnce('the answer')
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'Explain X' }), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { result: 'the answer', format: 'markdown' } })
    const [prompt, system] = mockAiChat.mock.calls[0]
    expect(prompt).toBe('Explain X')
    expect(system).toContain('well-structured Markdown')
  })

  it('uses the requested output format', async () => {
    mockAiChat.mockResolvedValueOnce('{}')
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'Explain X', format: 'json' }), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { result: '{}', format: 'json' } })
    const [, system] = mockAiChat.mock.calls[0]
    expect(system).toContain('Respond ONLY with valid JSON')
  })

  it('responds 500 with the error message when aiChat throws', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ollama unreachable'))
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'hi' }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'ollama unreachable' })
  })

  it('fires a completion notification without blocking the response', async () => {
    mockAiChat.mockResolvedValueOnce('ok')
    mockCreateNotification.mockResolvedValueOnce({} as never)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'short task' }), res, () => {})

    expect(res.json).toHaveBeenCalled() // response already sent
    await vi.waitFor(() => expect(mockCreateNotification).toHaveBeenCalled())
    expect(mockCreateNotification).toHaveBeenCalledWith('u1', expect.objectContaining({
      type: 'ai_task_done',
      title: 'AI Task Complete',
      body: 'AI finished processing: "short task"',
    }))
  })

  it('truncates a long task to 60 chars + "..." in the notification body', async () => {
    mockAiChat.mockResolvedValueOnce('ok')
    const longTask = 'x'.repeat(80)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: longTask }), res, () => {})

    await vi.waitFor(() => expect(mockCreateNotification).toHaveBeenCalled())
    expect(mockCreateNotification.mock.calls[0][1].body).toBe(`AI finished processing: "${'x'.repeat(60)}..."`)
  })

  it('skips the notification when ai_task_alerts_enabled is explicitly false', async () => {
    mockAiChat.mockResolvedValueOnce('ok')
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { ai_task_alerts_enabled: false } }] } as never)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'hi' }), res, () => {})

    // give the fire-and-forget notification chain a chance to run
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalled())
    expect(mockCreateNotification).not.toHaveBeenCalled()
  })

  it('swallows a notification failure without affecting the already-sent response', async () => {
    mockAiChat.mockResolvedValueOnce('ok')
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'hi' }), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { result: 'ok', format: 'markdown' } })
    await vi.waitFor(() => expect(errSpy).toHaveBeenCalled())
    expect(errSpy).toHaveBeenCalledWith('Failed to create AI task completion notification:', expect.any(Error))
    errSpy.mockRestore()
  })
})

describe('POST /api/aitask — streaming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] } as never)
  })

  it('sets SSE headers, streams each chunk, and ends with [DONE]', async () => {
    mockAiChatStream.mockImplementationOnce(async (_messages, onChunk) => {
      onChunk('Hello')
      onChunk(' world')
    })
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'hi', stream: true }), res, () => {})

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ chunk: 'Hello' })}\n\n`)
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ chunk: ' world' })}\n\n`)
    expect(res.write).toHaveBeenCalledWith('data: [DONE]\n\n')
    expect(res.end).toHaveBeenCalled()
  })

  it('writes an error event and still ends the stream when aiChatStream throws', async () => {
    mockAiChatStream.mockRejectedValueOnce(new Error('stream broke'))
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'hi', stream: true }), res, () => {})

    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ error: 'stream broke' })}\n\n`)
    expect(res.write).not.toHaveBeenCalledWith('data: [DONE]\n\n')
    expect(res.end).toHaveBeenCalled()
  })

  it('fires a completion notification on successful stream completion', async () => {
    mockAiChatStream.mockResolvedValueOnce(undefined)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ task: 'stream task', stream: true }), res, () => {})

    await vi.waitFor(() => expect(mockCreateNotification).toHaveBeenCalled())
  })
})

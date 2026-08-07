import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiChat:  vi.fn(),
  aiEmbed: vi.fn(),
}))

import issuesAiRouter from '../../routes/issues-ai.js'
import { pool } from '../../db/pool.js'
import { aiChat, aiEmbed } from '../../services/ai.js'

const mockQuery = vi.mocked(pool.query)
const mockAiChat = vi.mocked(aiChat)
const mockAiEmbed = vi.mocked(aiEmbed)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete' | 'patch') {
  const layer = (issuesAiRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/issues/:id/related-commands', () => {
  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/related-commands', 'get')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiEmbed).not.toHaveBeenCalled()
  })

  it('embeds the issue text and returns similarity-ranked commands', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Bug', description: 'desc' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([0.1, 0.2])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/related-commands', 'get')({ params: { id: 'i1' } }, res, () => {})

    expect(mockAiEmbed).toHaveBeenCalledWith('Bug. desc')
    expect(mockQuery.mock.calls[1][1]).toEqual(['[0.1,0.2]'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'c1' }] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/related-commands', 'get')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/:id/suggest-steps', () => {
  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/suggest-steps', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('parses numbered steps out of the AI response, dropping short lines', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Bug', description: 'desc' }] } as never)
    mockAiChat.mockResolvedValueOnce('1. Check the logs\n2) Reproduce it\n\nok\n3. Inspect `config.json`')
    const res = fakeRes()

    await getHandler('/:id/suggest-steps', 'post')({ params: { id: 'i1' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('Description: desc')
    expect(res.json).toHaveBeenCalledWith({ data: { steps: ['Check the logs', 'Reproduce it', 'Inspect `config.json`'] } })
  })

  it('omits the description line from the prompt when there is none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Bug', description: '' }] } as never)
    mockAiChat.mockResolvedValueOnce('1. Step one here')
    const res = fakeRes()

    await getHandler('/:id/suggest-steps', 'post')({ params: { id: 'i1' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).not.toContain('Description:')
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/suggest-steps', 'post')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/issues/:id/related-docs', () => {
  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/related-docs', 'get')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('embeds the issue text and returns similarity-ranked docs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Bug', description: 'desc' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([0.3])
    mockQuery.mockResolvedValueOnce({ rows: [{ doc_id: 'd1' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/related-docs', 'get')({ params: { id: 'i1' } }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['[0.3]'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ doc_id: 'd1' }] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/related-docs', 'get')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/:id/summarize', () => {
  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/summarize', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('builds a prompt with steps/notes/resolution present, stores, and returns the summary', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'i1', title: 'Bug', description: 'desc', priority: 'high', status: 'resolved', resolution: 'Fixed it',
        investigation_steps: [{ instruction: 'Check logs', done: true }, { instruction: 'Reproduce', done: false }],
        notes: [{ content: 'Found the cause' }],
      }],
    } as never)
    mockAiChat.mockResolvedValueOnce('Summary text')
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/summarize', 'post')({ params: { id: 'i1' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('(1/2 done)')
    expect(prompt).toContain('[x] Check logs')
    expect(prompt).toContain('[ ] Reproduce')
    expect(prompt).toContain('- Found the cause')
    expect(prompt).toContain('Resolution: Fixed it')
    expect(mockQuery.mock.calls[1]).toEqual(['UPDATE issues SET summary = $2 WHERE id = $1', ['i1', 'Summary text']])
    expect(res.json).toHaveBeenCalledWith({ data: { summary: 'Summary text' } })
  })

  it('falls back to "(none)" text when description/steps/notes/resolution are all empty', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'i1', title: 'Bug', description: '', priority: 'low', status: 'open', resolution: '', investigation_steps: [], notes: [] }],
    } as never)
    mockAiChat.mockResolvedValueOnce('Summary')
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/summarize', 'post')({ params: { id: 'i1' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('Description: (none)')
    expect(prompt).toContain('(0/0 done)')
    expect(prompt).toContain('Investigation steps (0/0 done):\n(none)')
    expect(prompt).toContain('Notes (0):\n(none)')
    expect(prompt).toContain('Resolution: (none)')
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/summarize', 'post')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/:id/reembed', () => {
  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/reembed', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('triggers re-embedding and reports processing status', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Bug', description: 'desc' }] } as never)
    mockQuery.mockResolvedValue({ rows: [] } as never) // embedIssueAsync's fire-and-forget status updates
    mockAiEmbed.mockResolvedValueOnce([])
    const res = fakeRes()

    await getHandler('/:id/reembed', 'post')({ params: { id: 'i1' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1', embedding_status: 'processing' } })
    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalledWith('Bug. desc'))
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/reembed', 'post')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/suggest-tags', () => {
  it('400s when title and description are both empty', async () => {
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('extracts and caps the suggested tags to 5', async () => {
    mockAiChat.mockResolvedValueOnce('```json\n["a","b","c","d","e","f"]\n```')
    const res = fakeRes()

    await getHandler('/suggest-tags', 'post')({ body: { title: 'Login broken', description: 'Users cannot log in' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { tags: ['a', 'b', 'c', 'd', 'e'] } })
  })

  it('returns an empty tags array when the AI response has no JSON array', async () => {
    mockAiChat.mockResolvedValueOnce('no array here')
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: { title: 'X' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { tags: [] } })
  })

  it('responds 500 on a failure', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ollama down'))
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
}))

vi.mock('../../services/links.js', () => ({
  deleteLinksFor: vi.fn(),
}))

import releasesRouter from '../../routes/releases.js'
import { pool } from '../../db/pool.js'
import { aiChat } from '../../services/ai.js'
import { deleteLinksFor } from '../../services/links.js'

const mockQuery = vi.mocked(pool.query)
const mockAiChat = vi.mocked(aiChat)
const mockDeleteLinksFor = vi.mocked(deleteLinksFor)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (releasesRouter as unknown as { stack: RouteLayer[] }).stack.find(
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

const AI_JSON = { features: ['New dashboard'], fixes: ['Fixed crash'], breaking_changes: ['Removed old API'], notes: 'A great release.' }

describe('POST /api/releases/ai-generate', () => {
  it('400s when commits is missing or blank', async () => {
    const res = fakeRes()
    await getHandler('/ai-generate', 'post')({ body: { commits: '   ' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('parses the JSON object out of the AI response, even wrapped in markdown', async () => {
    mockAiChat.mockResolvedValueOnce('```json\n' + JSON.stringify(AI_JSON) + '\n```')
    const res = fakeRes()

    await getHandler('/ai-generate', 'post')({ body: { commits: 'fix: bug\nfeat: thing' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: AI_JSON })
  })

  it('responds 500 when the AI response has no JSON object', async () => {
    mockAiChat.mockResolvedValueOnce('no json here')
    const res = fakeRes()

    await getHandler('/ai-generate', 'post')({ body: { commits: 'fix: bug' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'AI returned no JSON object' })
  })

  it('responds 500 when aiChat throws', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ollama down'))
    const res = fakeRes()

    await getHandler('/ai-generate', 'post')({ body: { commits: 'fix: bug' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/releases/compare', () => {
  it('400s when id1 or id2 is missing', async () => {
    const res = fakeRes()
    await getHandler('/compare', 'post')({ body: { id1: 'r1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s when id1 equals id2', async () => {
    const res = fakeRes()
    await getHandler('/compare', 'post')({ body: { id1: 'r1', id2: 'r1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Select two different releases' })
  })

  it('404s when either release is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/compare', 'post')({ body: { id1: 'r1', id2: 'r2' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('builds a context for each release (with and without notes/features/fixes/breaking changes) and returns the AI summary', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ version: '1.0', type: 'major', date: '2026-01-01', notes: 'First cut', features: ['A'], fixes: ['B'], breaking_changes: ['C'] }],
    } as never).mockResolvedValueOnce({
      rows: [{ version: '1.1', type: 'patch', date: '2026-02-01', notes: '', features: [], fixes: [], breaking_changes: [] }],
    } as never)
    mockAiChat.mockResolvedValueOnce('## Summary\nThings changed.')
    const res = fakeRes()

    await getHandler('/compare', 'post')({ body: { id1: 'r1', id2: 'r2' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('Version 1.0 (major) — 2026-01-01')
    expect(prompt).toContain('Summary: First cut')
    expect(prompt).toContain('Features:\n- A')
    expect(prompt).toContain('Fixes:\n- B')
    expect(prompt).toContain('Breaking Changes:\n- C')
    expect(prompt).toContain('Version 1.1 (patch) — 2026-02-01')
    expect(res.json).toHaveBeenCalledWith({ data: { summary: '## Summary\nThings changed.' } })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/compare', 'post')({ body: { id1: 'r1', id2: 'r2' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/releases/:id/qa', () => {
  it('400s when question is missing or blank', async () => {
    const res = fakeRes()
    await getHandler('/:id/qa', 'post')({ params: { id: 'r1' }, body: { question: '  ' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the release does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/qa', 'post')({ params: { id: 'missing' }, body: { question: 'Why?' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('answers using the release context', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ version: '1.0', type: 'patch', date: '2026-01-01', notes: '', features: [], fixes: [], breaking_changes: [] }] } as never)
    mockAiChat.mockResolvedValueOnce('Because reasons.')
    const res = fakeRes()

    await getHandler('/:id/qa', 'post')({ params: { id: 'r1' }, body: { question: 'Why?' } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('Question: Why?')
    expect(res.json).toHaveBeenCalledWith({ data: { answer: 'Because reasons.' } })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/qa', 'post')({ params: { id: 'r1' }, body: { question: 'Why?' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/releases/import-git', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/import-git', 'post')({ body: { commits: 'x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('defaults the release date to today when omitted, and inserts the AI-parsed notes', async () => {
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rel1' }] } as never)
    const res = fakeRes()
    const today = new Date().toISOString().split('T')[0]

    await getHandler('/import-git', 'post')({ body: { commits: 'feat: x', project_id: 'p1', version: '1.0' } }, res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['p1', '1.0', today, 'patch', AI_JSON.features, AI_JSON.fixes, AI_JSON.breaking_changes, AI_JSON.notes, []])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('uses a provided date and defaults missing AI fields to empty', async () => {
    mockAiChat.mockResolvedValueOnce(JSON.stringify({}))
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'rel1' }] } as never)
    const res = fakeRes()

    await getHandler('/import-git', 'post')({ body: { commits: 'feat: x', project_id: 'p1', version: '1.0', date: '2026-03-03' } }, res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['p1', '1.0', '2026-03-03', 'patch', [], [], [], '', []])
  })

  it('responds 500 when the AI response has no JSON', async () => {
    mockAiChat.mockResolvedValueOnce('nothing useful')
    const res = fakeRes()
    await getHandler('/import-git', 'post')({ body: { commits: 'x', project_id: 'p1', version: '1.0' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'AI returned no JSON' })
  })

  it('responds 409 when the version already exists for the project', async () => {
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    mockQuery.mockRejectedValueOnce({ code: '23505', message: 'duplicate' })
    const res = fakeRes()

    await getHandler('/import-git', 'post')({ body: { commits: 'x', project_id: 'p1', version: '1.0' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Version 1.0 already exists for this project' })
  })

  it('responds 500 on any other insert failure', async () => {
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))
    const res = fakeRes()

    await getHandler('/import-git', 'post')({ body: { commits: 'x', project_id: 'p1', version: '1.0' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/releases/draft', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/draft', 'post')({ body: { projectId: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('queries by explicit issueIds when provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Fix crash', resolution: 'Patched null check', tags: [] }] } as never)
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31', issueIds: ['i1'] } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('id = ANY($1::text[])')
    expect(params).toEqual([['i1']])
  })

  it('queries by project/date range when issueIds is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'Fix crash', resolution: '', tags: [] }] } as never)
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain("status = 'resolved'")
    expect(params).toEqual(['p1', '2026-01-01', '2026-01-31'])
  })

  it('422s when no resolved issues are found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('builds the issue list (with and without a resolution) and returns a draft with an empty version and today\'s date', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { title: 'Fix crash', resolution: 'Patched null check', tags: [] },
        { title: 'Improve perf', resolution: '', tags: [] },
      ],
    } as never)
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    const res = fakeRes()
    const today = new Date().toISOString().split('T')[0]

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31', issueIds: ['i1', 'i2'] } }, res, () => {})

    const [prompt] = mockAiChat.mock.calls[0]
    expect(prompt).toContain('- Fix crash (Resolution: Patched null check)')
    expect(prompt).toContain('- Improve perf\n')
    expect(res.json).toHaveBeenCalledWith({
      data: {
        project_id: 'p1', version: '', date: today, type: 'patch',
        features: AI_JSON.features, fixes: AI_JSON.fixes, breaking_changes: AI_JSON.breaking_changes, notes: AI_JSON.notes,
        linked_issues: ['i1', 'i2'],
      },
    })
  })

  it('defaults linked_issues to [] when issueIds was not provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'X', resolution: '', tags: [] }] } as never)
    mockAiChat.mockResolvedValueOnce(JSON.stringify(AI_JSON))
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { linked_issues: unknown[] } }).data
    expect(data.linked_issues).toEqual([])
  })

  it('defaults missing AI fields to empty when the AI response omits them', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'X', resolution: '', tags: [] }] } as never)
    mockAiChat.mockResolvedValueOnce(JSON.stringify({}))
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { features: unknown[]; fixes: unknown[]; breaking_changes: unknown[]; notes: string } }).data
    expect(data).toMatchObject({ features: [], fixes: [], breaking_changes: [], notes: '' })
  })

  it('responds 500 when the AI response has no JSON object', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ title: 'X', resolution: '', tags: [] }] } as never)
    mockAiChat.mockResolvedValueOnce('nope')
    const res = fakeRes()

    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/draft', 'post')({ body: { projectId: 'p1', from: '2026-01-01', to: '2026-01-31' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/releases', () => {
  it('lists all releases with no project filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(values).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'r1' }] })
  })

  it('filters by project id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')({ query: { projectId: 'p1' } }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('r.project_id = $1')
    expect(values).toEqual(['p1'])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/releases/:id', () => {
  it('returns the release when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'r1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'r1' } })
  })

  it('404s when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'r1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/releases', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project_id: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a release with defaults applied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { project_id: 'p1', version: '1.0', date: '2026-01-01' } }, res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['p1', '1.0', '2026-01-01', 'patch', [], [], [], '', []])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('responds 409 on a duplicate version', async () => {
    mockQuery.mockRejectedValueOnce({ code: '23505' })
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project_id: 'p1', version: '1.0', date: '2026-01-01' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('responds 500 on any other failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project_id: 'p1', version: '1.0', date: '2026-01-01' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/releases/:id', () => {
  it('400s on an invalid partial body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { version: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
  })

  it('updates the given fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.1' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { version: '1.1', notes: 'updated' } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('version = $2, notes = $3')
    expect(params).toEqual(['r1', '1.1', 'updated'])
  })

  it('404s when the release does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { version: '1.1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'r1' }, body: { version: '1.1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/releases/:id', () => {
  it('deletes the release and its links', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', version: '1.0' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'r1' } }, res, () => {})

    expect(mockDeleteLinksFor).toHaveBeenCalledWith('release', 'r1')
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'r1', version: '1.0' } } })
  })

  it('404s without deleting links when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockDeleteLinksFor).not.toHaveBeenCalled()
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'r1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiChat:  vi.fn(),
  aiEmbed: vi.fn(),
}))

vi.mock('../../services/links.js', () => ({
  deleteLinksFor: vi.fn(),
}))

import issuesRouter from '../../routes/issues.js'
import { pool } from '../../db/pool.js'
import { aiChat, aiEmbed } from '../../services/ai.js'
import { deleteLinksFor } from '../../services/links.js'

const mockQuery = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)
const mockAiChat = vi.mocked(aiChat)
const mockAiEmbed = vi.mocked(aiEmbed)
const mockDeleteLinksFor = vi.mocked(deleteLinksFor)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete' | 'patch') {
  const layer = (issuesRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function fakeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/issues', () => {
  function req(query: Record<string, unknown> = {}) {
    return { query }
  }

  it('applies no filters when none are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req(), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(values).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: { items: [], total: 0 } })
  })

  it('filters by a single project id (via the singular projectId param)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectId: 'p1' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('i.project_id = ANY($1)')
    expect(values).toEqual([['p1']])
  })

  it('combines specific project ids with "global" via an OR clause', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectIds: 'p1,p2,global' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('(i.project_id = ANY($1) OR i.project_id IS NULL)')
    expect(values).toEqual([['p1', 'p2']])
  })

  it('filters for global-only (no project) issues', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectIds: 'global' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('i.project_id IS NULL')
    expect(values).toEqual([])
  })

  it('filters by status, priority, and tags (array params)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ status: ['open', 'investigating'], priority: 'high', tags: 'bug,urgent' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('i.status = ANY($1)')
    expect(String(sql)).toContain('i.priority = ANY($2)')
    expect(String(sql)).toContain('i.tags && $3::text[]')
    expect(values).toEqual([['open', 'investigating'], ['high'], ['bug', 'urgent']])
  })

  it('coerces a non-string, non-array param value to a single-item array', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ priority: 5 }), res, () => {})
    const [, values] = mockQuery.mock.calls[0]
    expect(values).toEqual([['5']])
  })

  it('filters by a date range', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('i.created_at >= $1::timestamptz')
    expect(String(sql)).toContain('i.created_at <= $2::timestamptz')
    expect(values).toEqual(['2026-01-01', '2026-01-31'])
  })

  it('applies a full-text + ILIKE search via either q or search, sharing placeholders', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ search: 'crash' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`i.tsv @@ plainto_tsquery('english', $1)`)
    expect(String(sql)).toContain('i.title ILIKE $2')
    expect(String(sql)).toContain('i.description ILIKE $2')
    expect(values).toEqual(['crash', '%crash%'])
  })

  it('clamps limit to 100 and respects a custom offset', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ limit: '500', offset: '10' }), res, () => {})
    const dataValues = mockQuery.mock.calls[1][1] as unknown[]
    expect(dataValues.slice(-2)).toEqual([100, 10])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')(req(), res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/issues/related', () => {
  it('returns [] without querying when q is missing or too short', async () => {
    const res = fakeRes()
    await getHandler('/related', 'get')({ query: { q: 'ab' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [] })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns ranked related issues', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    const res = fakeRes()
    await getHandler('/related', 'get')({ query: { q: 'login bug', limit: '5' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['login bug', 5])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'i1' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/related', 'get')({ query: { q: 'login bug' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/issues/triage', () => {
  it('uses a 14-day default threshold when no settings row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/triage', 'get')({ query: {} }, res, () => {})
    expect(mockQuery.mock.calls[1][1]).toEqual([14])
  })

  it('uses a custom threshold and filters by a specific project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { stale_threshold_days: 7 } }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/triage', 'get')({ query: { projectId: 'p1' } }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[1]
    expect(String(sql)).toContain('i.project_id = $2')
    expect(values).toEqual([7, 'p1'])
  })

  it('filters for global issues', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/triage', 'get')({ query: { projectId: 'global' } }, res, () => {})
    expect(String(mockQuery.mock.calls[1][0])).toContain('i.project_id IS NULL')
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/triage', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/issues/bulk', () => {
  it('400s when ids is missing or empty', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: [], action: 'delete' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('400s on an invalid action', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'nope' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rolls back and 400s a tag action with a non-string value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'tag', value: 5 } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('tags the given issues', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'tag', value: 'urgent' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('array_append(tags, $1)'), ['urgent', ['i1']])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('rolls back and 400s a status action with a non-string value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'status', value: null } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sets resolved_at when bulk-setting status to resolved', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'status', value: 'resolved' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('resolved_at = now()'), ['resolved', ['i1']])
  })

  it('clears resolved_at when bulk-setting status to a non-resolved value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'status', value: 'open' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('resolved_at = NULL'), ['open', ['i1']])
  })

  it('deletes the given issues', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'delete' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM issues'), [['i1']])
  })

  it('rolls back, releases the client, and 500s on a transaction failure', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM issues')) throw new Error('fk violation')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['i1'], action: 'delete' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(client.release).toHaveBeenCalled()
  })
})

describe('GET /api/issues/:id', () => {
  it('returns the issue when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'i1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1' } })
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
    await getHandler('/:id', 'get')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('creates an issue with investigation steps, in a transaction', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO issues')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Bug', description: 'desc' }] } as never) // full fetch
    mockQuery.mockResolvedValue({ rows: [] } as never) // embedIssueAsync's fire-and-forget status updates
    mockAiEmbed.mockResolvedValueOnce([])
    const res = fakeRes()
    const steps = [{ id: 's1', order: 1, instruction: 'Check logs', done: false }]

    await getHandler('/', 'post')({ body: { title: 'Bug', description: 'desc', investigation_steps: steps } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO issue_steps'), ['s1', 'i1', 1, 'Check logs', false])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(res.status).toHaveBeenCalledWith(201)
    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalledWith('Bug. desc'))
  })

  it('marks embedding_status failed when the fire-and-forget aiEmbed call rejects', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO issues')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Bug', description: 'desc' }] } as never)
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockAiEmbed.mockRejectedValueOnce(new Error('ollama down'))
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { title: 'Bug', description: 'desc' } }, res, () => {})

    await vi.waitFor(() => expect(mockQuery.mock.calls.some(
      c => String(c[0]).includes(`embedding_status = 'failed'`)
    )).toBe(true))
  })

  it('creates an issue with no steps (skips the step-insert loop)', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO issues')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Bug', description: '' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([])
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { title: 'Bug' } }, res, () => {})

    expect(client.query.mock.calls.some(c => String(c[0]).includes('INSERT INTO issue_steps'))).toBe(false)
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('rolls back, releases the client, and 500s on a transaction failure', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO issues')) throw new Error('constraint violation')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { title: 'Bug' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(client.release).toHaveBeenCalled()
  })
})

describe('PUT /api/issues/:id', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" when body is empty', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('404s a steps-only update when the issue does not exist', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM issues')) return { rows: [] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { investigation_steps: [] } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('replaces steps atomically for a steps-only update', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM issues')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'T', description: 'D' }] } as never)
    const res = fakeRes()
    const steps = [{ id: 's1', order: 1, instruction: 'Do it', done: true }]

    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { investigation_steps: steps } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('DELETE FROM issue_steps WHERE issue_id = $1', ['i1'])
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO issue_steps'), ['s1', 'i1', 1, 'Do it', true])
  })

  it('updates scalar fields and 404s when the issue does not exist', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE issues SET')) return { rows: [] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { title: 'New' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('updates scalar fields, sets resolved_at on status=resolved, and does not re-embed when title/description are unchanged', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE issues SET')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'T', description: 'D', status: 'resolved' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { status: 'resolved' } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('resolved_at = now()'), ['i1', 'resolved'])
    expect(mockAiEmbed).not.toHaveBeenCalled()
  })

  it('re-embeds when title changes', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE issues SET')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'New title', description: 'D' }] } as never)
    mockQuery.mockResolvedValue({ rows: [] } as never) // embedIssueAsync's fire-and-forget status updates
    mockAiEmbed.mockResolvedValueOnce([])
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { title: 'New title' } }, res, () => {})

    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalledWith('New title. D'))
  })

  it('404s when the post-update fetch finds no row', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE issues SET')) return { rows: [{ id: 'i1' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { title: 'New' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('rolls back, releases the client, and 500s on a transaction failure', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('UPDATE issues SET')) throw new Error('db down')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'i1' }, body: { title: 'New' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/issues/:id', () => {
  it('deletes the issue and its links', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Bug' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'i1' } }, res, () => {})
    expect(mockDeleteLinksFor).toHaveBeenCalledWith('issue', 'i1')
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'i1', title: 'Bug' } } })
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
    await getHandler('/:id', 'delete')({ params: { id: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/issues/:id/notes', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'missing' }, body: { content: 'note' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('adds a note and returns the full issue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never) // existence check
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // INSERT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', notes: [{ content: 'note' }] }] } as never) // fetch
    const res = fakeRes()

    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: 'note' } }, res, () => {})

    const insertCall = mockQuery.mock.calls[1]
    expect(String(insertCall[0])).toContain('INSERT INTO issue_notes')
    expect((insertCall[1] as unknown[])[1]).toBe('i1')
    expect((insertCall[1] as unknown[])[2]).toBe('note')
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1', notes: [{ content: 'note' }] } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/notes', 'post')({ params: { id: 'i1' }, body: { content: 'note' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/issues/:id/notes/:noteId', () => {
  it('404s when the note does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never)
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('deletes the note and returns the full issue', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['n1', 'i1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1' } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/notes/:noteId', 'delete')({ params: { id: 'i1', noteId: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
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

describe('POST /api/issues/:id/commits', () => {
  it('400s on an invalid sha', async () => {
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'zz' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the issue does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'missing' }, body: { sha: 'abc123' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('links the commit and returns the sha list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 'p1' }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ sha: 'abc123' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'abc123' } }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['i1', 'abc123', 'p1'])
    expect(res.json).toHaveBeenCalledWith({ data: ['abc123'] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/commits', 'post')({ params: { id: 'i1' }, body: { sha: 'abc123' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/issues/:id/commits/:sha', () => {
  it('unlinks the commit and returns the remaining sha list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/commits/:sha', 'delete')({ params: { id: 'i1', sha: 'abc123' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['i1', 'abc123'])
    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/commits/:sha', 'delete')({ params: { id: 'i1', sha: 'abc123' } }, res, () => {})
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

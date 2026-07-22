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

import commandsRouter from '../../routes/commands.js'
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
  const layer = (commandsRouter as unknown as { stack: RouteLayer[] }).stack.find(
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

describe('GET /api/commands', () => {
  function req(query: Record<string, string> = {}, user?: { id: string }) {
    return { query, user }
  }

  it('applies no filters and no namespace restriction when there is no user and no query params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req(), res, () => {})

    const [countSql, countValues] = mockQuery.mock.calls[0]
    expect(String(countSql)).not.toContain('WHERE')
    expect(countValues).toEqual([])
    const [dataSql, dataValues] = mockQuery.mock.calls[1]
    expect(String(dataSql)).toContain('LIMIT $1 OFFSET $2')
    expect(dataValues).toEqual([25, 0])
    expect(res.json).toHaveBeenCalledWith({ data: { items: [], total: 0 } })
  })

  it('filters for global (no project) commands', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ projectId: 'global' }), res, () => {})

    expect(String(mockQuery.mock.calls[0][0])).toContain('c.project_id IS NULL')
  })

  it('filters by a specific project, language, and favorite', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ projectId: 'p1', language: 'bash', favorite: 'true' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('c.project_id = $1 AND c.language = $2 AND c.is_favorite = true')
    expect(values).toEqual(['p1', 'bash'])
  })

  it('restricts to the current user\'s personal commands when namespace=personal', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ namespace: 'personal' }, { id: 'u1' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`c.namespace = 'personal'`)
    expect(String(sql)).toContain('c.created_by = $1')
    expect(values).toEqual(['u1'])
  })

  it('does not add a created_by filter for personal namespace in legacy/dev mode', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ namespace: 'personal' }, { id: 'dev' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`c.namespace = 'personal'`)
    expect(String(sql)).not.toContain('created_by')
    expect(values).toEqual([])
  })

  it('restricts to team commands when namespace=team, regardless of user', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ namespace: 'team' }, { id: 'u1' }), res, () => {})

    const [sql] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`c.namespace = 'team'`)
    expect(String(sql)).not.toContain('created_by')
  })

  it('defaults to team + own personal commands when a real user is present and namespace is omitted', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({}, { id: 'u1' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`(c.namespace = 'team' OR (c.namespace = 'personal' AND c.created_by = $1))`)
    expect(values).toEqual(['u1'])
  })

  it('applies a full-text search filter', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ search: 'deploy' }), res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`c.tsv @@ plainto_tsquery('english', $1)`)
    expect(values).toEqual(['deploy'])
  })

  it('clamps limit to 100 and respects a custom offset', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(req({ limit: '500', offset: '40' }), res, () => {})

    const dataValues = mockQuery.mock.calls[1][1] as unknown[]
    expect(dataValues.slice(-2)).toEqual([100, 40])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/', 'get')(req(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/commands/bulk', () => {
  function fakeClient() {
    return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
  }

  it('400s when ids is missing or empty', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: [], action: 'delete' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('400s on an invalid action', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'nope' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rolls back and 400s a tag action with a non-string value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'tag', value: 5 } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
    expect(client.release).toHaveBeenCalled()
  })

  it('tags the given commands and commits', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/bulk', 'patch')({ body: { ids: ['c1', 'c2'], action: 'tag', value: 'ops' } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('array_append(tags, $1)'), ['ops', ['c1', 'c2']])
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
    expect(client.release).toHaveBeenCalled()
  })

  it('sets is_favorite true by default, and false only when value is the string "false"', async () => {
    const client1 = fakeClient()
    mockConnect.mockResolvedValueOnce(client1 as never)
    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'favorite' } }, fakeRes(), () => {})
    expect(client1.query).toHaveBeenCalledWith(expect.stringContaining('is_favorite = $1'), [true, ['c1']])

    const client2 = fakeClient()
    mockConnect.mockResolvedValueOnce(client2 as never)
    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'favorite', value: 'false' } }, fakeRes(), () => {})
    expect(client2.query).toHaveBeenCalledWith(expect.stringContaining('is_favorite = $1'), [false, ['c1']])
  })

  it('deletes the given commands', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'delete' } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM commands'), [['c1']])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('rolls back, releases the client, and 500s when the transaction query fails', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'DELETE FROM commands WHERE id = ANY($1)') throw new Error('fk violation')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/bulk', 'patch')({ body: { ids: ['c1'], action: 'delete' } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(client.release).toHaveBeenCalled()
  })
})

describe('GET /api/commands/:id', () => {
  it('returns the command when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'c1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'c1' } })
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
    await getHandler('/:id', 'get')({ params: { id: 'c1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/commands', () => {
  function fakeReq(body: Record<string, unknown>, user?: { id: string }) {
    return { body, user }
  }

  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ title: '' }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('creates a command, attributing created_by to a real user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', title: 'Deploy', description: 'desc', command: 'npm run deploy' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([0.1, 0.2])
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ title: 'Deploy', command: 'npm run deploy' }, { id: 'u1' }), res, () => {})

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual([null, 'Deploy', 'npm run deploy', 'bash', '', [], false, 'team', 'u1'])
    expect(res.status).toHaveBeenCalledWith(201)

    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalled())
    expect(mockAiEmbed).toHaveBeenCalledWith('Deploy. npm run deploy')
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
    expect(mockQuery.mock.calls[1][0]).toContain('UPDATE commands SET embedding')
  })

  it('attributes created_by as null for legacy/dev users', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', title: 'X', description: '', command: 'echo hi' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([])
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ title: 'X', command: 'echo hi' }, { id: 'dev' }), res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual([null, 'X', 'echo hi', 'bash', '', [], false, 'team', null])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ title: 'X', command: 'echo hi' }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/commands/:id', () => {
  it('400s on an invalid partial body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'c1' }, body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'c1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
  })

  it('updates the command and re-embeds it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', title: 'New title', description: 'd', command: 'echo hi' }] } as never)
    mockAiEmbed.mockResolvedValueOnce([0.5])
    const res = fakeRes()

    await getHandler('/:id', 'put')({ params: { id: 'c1' }, body: { title: 'New title' } }, res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('title = $2')
    expect(params).toEqual(['c1', 'New title'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'c1', title: 'New title', description: 'd', command: 'echo hi' } })

    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalledWith('New title. d. echo hi'))
  })

  it('404s when the command does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'c1' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/commands/:id', () => {
  it('deletes the command and its links', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', title: 'Deploy' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'c1' } }, res, () => {})

    expect(mockDeleteLinksFor).toHaveBeenCalledWith('command', 'c1')
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'c1', title: 'Deploy' } } })
  })

  it('404s without deleting links when the command does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockDeleteLinksFor).not.toHaveBeenCalled()
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'c1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/commands/:id/use', () => {
  it('stamps last_used and returns the command', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/use', 'post')({ params: { id: 'c1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'c1' } })
  })

  it('404s when the command does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/use', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/use', 'post')({ params: { id: 'c1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/commands/:id/explain', () => {
  it('404s when the command does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/explain', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('explains the command via AI and stores the explanation', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', command: 'ls -la', language: 'bash', title: 'List' }] } as never)
    mockAiChat.mockResolvedValueOnce('Lists files in long format.')
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/explain', 'post')({ params: { id: 'c1' } }, res, () => {})

    expect(mockAiChat).toHaveBeenCalledWith(
      expect.stringContaining('```bash\nls -la\n```'),
      expect.stringContaining('technical assistant'),
    )
    expect(mockQuery.mock.calls[1]).toEqual(['UPDATE commands SET explanation = $2 WHERE id = $1', ['c1', 'Lists files in long format.']])
    expect(res.json).toHaveBeenCalledWith({ data: { explanation: 'Lists files in long format.' } })
  })

  it('responds 500 when the lookup query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/explain', 'post')({ params: { id: 'c1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

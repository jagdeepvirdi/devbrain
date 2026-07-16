import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/links.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/links.js')>('../../services/links.js')
  return {
    ...actual,
    resolveEntities: vi.fn(),
    entityExists:    vi.fn(),
  }
})

import linksRouter from '../../routes/links.js'
import { pool } from '../../db/pool.js'
import { resolveEntities, entityExists } from '../../services/links.js'

const mockQuery     = vi.mocked(pool.query)
const mockResolve   = vi.mocked(resolveEntities)
const mockExists    = vi.mocked(entityExists)

function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (linksRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('GET /api/links', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when entityType or entityId is missing/invalid', async () => {
    const req: any = { query: { entityType: 'bogus', entityId: 'x' } }
    const res = fakeRes()
    await getHandler('/', 'get')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('resolves the other side of each link, batched per type', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'link-1', a_type: 'issue', a_id: 'issue-1', b_type: 'document', b_id: 'doc-1', created_at: 't1' },
        { id: 'link-2', a_type: 'task', a_id: 'task-1', b_type: 'issue', b_id: 'issue-1', created_at: 't2' },
      ],
    } as any)
    mockResolve.mockImplementation(async (type) => {
      if (type === 'document') return [{ type: 'document', id: 'doc-1', title: 'index.ts', subtitle: 'code' }]
      if (type === 'task') return [{ type: 'task', id: 'task-1', title: 'Ship it', subtitle: 'todo' }]
      return []
    })

    const req: any = { query: { entityType: 'issue', entityId: 'issue-1' } }
    const res = fakeRes()
    await getHandler('/', 'get')(req, res, () => {})

    expect(mockResolve).toHaveBeenCalledWith('document', ['doc-1'])
    expect(mockResolve).toHaveBeenCalledWith('task', ['task-1'])
    expect(res.json).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ linkId: 'link-1', type: 'document', id: 'doc-1', title: 'index.ts' }),
        expect.objectContaining({ linkId: 'link-2', type: 'task', id: 'task-1', title: 'Ship it' }),
      ],
    })
  })

  it('falls back to "(deleted)" when the linked entity no longer resolves', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'link-1', a_type: 'issue', a_id: 'issue-1', b_type: 'document', b_id: 'gone', created_at: 't1' }],
    } as any)
    mockResolve.mockResolvedValue([])

    const req: any = { query: { entityType: 'issue', entityId: 'issue-1' } }
    const res = fakeRes()
    await getHandler('/', 'get')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: [expect.objectContaining({ title: '(deleted)', subtitle: null })],
    })
  })
})

describe('GET /api/links/graph', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns empty nodes/edges when there are no links', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = {}
    const res = fakeRes()
    await getHandler('/graph', 'get')(req, res, () => {})

    expect(mockResolve).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { nodes: [], edges: [] } })
  })

  it('deduplicates a node touched by multiple edges into a single node entry', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'link-1', a_type: 'issue', a_id: 'issue-1', b_type: 'task', b_id: 'task-1' },
        { id: 'link-2', a_type: 'issue', a_id: 'issue-1', b_type: 'document', b_id: 'doc-1' },
      ],
    } as any)
    mockResolve.mockImplementation(async (type) => {
      if (type === 'issue') return [{ type: 'issue', id: 'issue-1', title: 'Bug', subtitle: 'open' }]
      if (type === 'task') return [{ type: 'task', id: 'task-1', title: 'Fix it', subtitle: 'todo' }]
      if (type === 'document') return [{ type: 'document', id: 'doc-1', title: 'index.ts', subtitle: 'code' }]
      return []
    })

    const req: any = {}
    const res = fakeRes()
    await getHandler('/graph', 'get')(req, res, () => {})

    // resolveEntities called once per distinct type, with the deduplicated id set for that type
    expect(mockResolve).toHaveBeenCalledWith('issue', ['issue-1'])
    expect(mockResolve).toHaveBeenCalledWith('task', ['task-1'])
    expect(mockResolve).toHaveBeenCalledWith('document', ['doc-1'])

    const payload = res.json.mock.calls[0][0].data
    expect(payload.nodes).toHaveLength(3)
    expect(payload.edges).toHaveLength(2)
    expect(payload.edges[0]).toEqual({ linkId: 'link-1', from: { type: 'issue', id: 'issue-1' }, to: { type: 'task', id: 'task-1' } })
  })

  it('falls back to "(deleted)" for a node that no longer resolves', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'link-1', a_type: 'issue', a_id: 'gone', b_type: 'task', b_id: 'task-1' }],
    } as any)
    mockResolve.mockImplementation(async (type) => (type === 'task' ? [{ type: 'task', id: 'task-1', title: 'Fix it', subtitle: 'todo' }] : []))

    const req: any = {}
    const res = fakeRes()
    await getHandler('/graph', 'get')(req, res, () => {})

    const payload = res.json.mock.calls[0][0].data
    const deletedNode = payload.nodes.find((n: any) => n.id === 'gone')
    expect(deletedNode).toEqual({ type: 'issue', id: 'gone', title: '(deleted)', subtitle: null })
  })
})

describe('POST /api/links', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects linking an item to itself', async () => {
    const req: any = { body: { aType: 'task', aId: 'x', bType: 'task', bId: 'x' } }
    const res = fakeRes()
    await getHandler('/', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockExists).not.toHaveBeenCalled()
  })

  it('404s when either referenced entity does not exist', async () => {
    mockExists.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const req: any = { body: { aType: 'task', aId: 'a', bType: 'issue', bId: 'b' } }
    const res = fakeRes()
    await getHandler('/', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('canonicalizes (a > b) pairs before insert so order never matters', async () => {
    mockExists.mockResolvedValue(true)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'link-1', created_at: 't1' }] } as any)

    // 'task' > 'issue' alphabetically, so this should get swapped to (issue, b) / (task, a)
    const req: any = { body: { aType: 'task', aId: 'task-1', bType: 'issue', bId: 'issue-1' } }
    const res = fakeRes()
    await getHandler('/', 'post')(req, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['issue', 'issue-1', 'task', 'task-1'])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('keeps already-canonical (a <= b) pairs as-is', async () => {
    mockExists.mockResolvedValue(true)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'link-2', created_at: 't1' }] } as any)

    const req: any = { body: { aType: 'document', aId: 'doc-1', bType: 'issue', bId: 'issue-1' } }
    const res = fakeRes()
    await getHandler('/', 'post')(req, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['document', 'doc-1', 'issue', 'issue-1'])
  })
})

describe('DELETE /api/links/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the link does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { params: { id: 'missing' } }
    const res = fakeRes()
    await getHandler('/:id', 'delete')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('deletes and returns the removed link id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'link-1' }] } as any)
    const req: any = { params: { id: 'link-1' } }
    const res = fakeRes()
    await getHandler('/:id', 'delete')(req, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: 'link-1' } })
  })
})

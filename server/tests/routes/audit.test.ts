import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pool
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import router from '../../routes/audit.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(path: string, method: 'get' = 'get') {
  const route = router.stack.find(s => s.route?.path === path && (s.route as any)?.methods[method])
  return route!.route!.stack[route!.route!.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), setHeader: vi.fn(), send: vi.fn() } as any
}

describe('GET /api/audit', () => {
  beforeEach(() => vi.clearAllMocks())

  it('applies no filters and defaults limit/offset when none are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as any).mockResolvedValueOnce({ rows: [] } as any)
    const req = { query: {} }
    const res = fakeRes()
    await getHandler('/')(req as any, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).not.toContain('WHERE')
    expect(values).toEqual([])
    const dataValues = mockQuery.mock.calls[1][1] as unknown[]
    expect(dataValues).toEqual([50, 0])
  })

  it('supports entityType filtering', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as any)
    const req = { query: { entityType: 'document', limit: '10', offset: '0' } }
    const res = fakeRes()
    await getHandler('/')(req as any, res, () => {})

    const lastQuery = mockQuery.mock.calls.find(c => (c[0] as string).includes('WHERE'))?.[0]
    expect(lastQuery).toContain('entity_type = $1')
  })

  it('supports entityId filtering', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as any)
    const req = { query: { entityId: 'e1' } }
    const res = fakeRes()
    await getHandler('/')(req as any, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('entity_id   = $1')
    expect(values).toEqual(['e1'])
  })

  it('supports userId filtering, combined with the others via sequential placeholders', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as any)
    const req = { query: { entityType: 'document', entityId: 'e1', userId: 'u1' } }
    const res = fakeRes()
    await getHandler('/')(req as any, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(sql).toContain('a.entity_type = $1')
    expect(sql).toContain('a.entity_id   = $2')
    expect(sql).toContain('a.user_id     = $3')
    expect(values).toEqual(['document', 'e1', 'u1'])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { query: {} }
    const res = fakeRes()
    await getHandler('/')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/audit/export', () => {
  beforeEach(() => vi.clearAllMocks())

  it('generates correctly formatted CSV', async () => {
    const mockEvents = [
      { id: '1', created_at: '2026-01-01', username: 'alice', action: 'create', entity_type: 'project', entity_name: 'Proj A', metadata: { key: 'val' } },
      { id: '2', created_at: '2026-01-02', username: 'bob', action: 'delete', entity_type: 'issue', entity_name: 'Bug "1"', metadata: null },
    ]
    mockQuery.mockResolvedValueOnce({ rows: mockEvents } as any)

    const req = { user: { role: 'admin' } }
    const res = fakeRes()
    await getHandler('/export')(req as any, res, () => {})

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
    const sentCsv = res.send.mock.calls[0][0]
    expect(sentCsv).toContain('ID,Date,User,Action,Entity,Entity Name,Metadata')
    expect(sentCsv).toContain('1,2026-01-01,alice,create,project,"Proj A","{""key"":""val""}"')
    expect(sentCsv).toContain('2,2026-01-02,bob,delete,issue,"Bug ""1""",""')
  })

  it('falls back to "system" for a null username and "" for a null entity_name', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: '3', created_at: '2026-01-03', username: null, action: 'update', entity_type: 'task', entity_name: null, metadata: null }],
    } as any)

    const req = { user: { role: 'admin' } }
    const res = fakeRes()
    await getHandler('/export')(req as any, res, () => {})

    const sentCsv = res.send.mock.calls[0][0]
    expect(sentCsv).toContain('3,2026-01-03,system,update,task,"",""')
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req = { user: { role: 'admin' } }
    const res = fakeRes()
    await getHandler('/export')(req as any, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

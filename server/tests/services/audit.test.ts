import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const { logAudit } = await import('../../services/audit.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

describe('logAudit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts an audit event with metadata serialized to JSON', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await logAudit('u1', 'alice', 'issue', 'i1', 'Login broken', 'update', { field: 'status' })

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO audit_events')
    expect(params).toEqual(['u1', 'alice', 'issue', 'i1', 'Login broken', 'update', JSON.stringify({ field: 'status' })])
  })

  it('nullifies missing optional fields (undefined/null userId, username, entityName, no metadata)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await logAudit(undefined, null, 'project', 'p1', undefined, 'delete')

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual([null, null, 'project', 'p1', null, 'delete', null])
  })

  it('swallows database errors without throwing (audit failures are non-fatal)', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))

    await expect(logAudit('u1', 'alice', 'task', 't1', 'Task', 'create')).resolves.toBeUndefined()
  })
})

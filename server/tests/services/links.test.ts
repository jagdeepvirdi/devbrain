import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const { resolveEntities, entityExists, deleteLinksFor, ENTITY_TYPES } = await import('../../services/links.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

describe('ENTITY_TYPES', () => {
  it('lists all five supported entity types', () => {
    expect(ENTITY_TYPES).toEqual(['task', 'document', 'issue', 'release', 'command'])
  })
})

describe('resolveEntities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] without querying when ids is empty', async () => {
    const result = await resolveEntities('issue', [])
    expect(result).toEqual([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('queries the issues table with status as the subtitle and maps rows to descriptors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', title: 'Login broken', subtitle: 'open' }] } as never)

    const result = await resolveEntities('issue', ['i1'])

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('FROM issues WHERE id = ANY($1)')
    expect(String(sql)).toContain('status AS subtitle')
    expect(params).toEqual([['i1']])
    expect(result).toEqual([{ type: 'issue', id: 'i1', title: 'Login broken', subtitle: 'open' }])
  })

  it('queries the releases table with version/type as title/subtitle', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'r1', title: '1.2.0', subtitle: 'minor' }] } as never)

    const result = await resolveEntities('release', ['r1'])

    const [sql] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('version AS title')
    expect(String(sql)).toContain('type AS subtitle')
    expect(result).toEqual([{ type: 'release', id: 'r1', title: '1.2.0', subtitle: 'minor' }])
  })

  it('passes through a null subtitle', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', title: 'Doc', subtitle: null }] } as never)

    const [result] = await resolveEntities('document', ['d1'])

    expect(result.subtitle).toBeNull()
  })
})

describe('entityExists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns true when a matching row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] } as never)

    const exists = await entityExists('command', 'c1')

    expect(exists).toBe(true)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('FROM commands WHERE id = $1')
    expect(params).toEqual(['c1'])
  })

  it('returns false when no row matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    expect(await entityExists('task', 'missing')).toBe(false)
  })
})

describe('deleteLinksFor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes links where the entity appears as either side a or side b', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await deleteLinksFor('issue', 'i1')

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('DELETE FROM entity_links')
    expect(String(sql)).toContain('a_type = $1 AND a_id = $2')
    expect(String(sql)).toContain('b_type = $1 AND b_id = $2')
    expect(params).toEqual(['issue', 'i1'])
  })
})

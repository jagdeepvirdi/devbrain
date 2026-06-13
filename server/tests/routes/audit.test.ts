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

describe('Audit Route Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /export — generates correctly formatted CSV', async () => {
    const mockEvents = [
      { id: '1', created_at: '2026-01-01', username: 'alice', action: 'create', entity_type: 'project', entity_name: 'Proj A', metadata: { key: 'val' } },
      { id: '2', created_at: '2026-01-02', username: 'bob',   action: 'delete', entity_type: 'issue',   entity_name: 'Bug "1"', metadata: null },
    ]
    mockQuery.mockResolvedValueOnce({ rows: mockEvents } as any)

    const req = { user: { role: 'admin' } }
    const res = { 
      setHeader: vi.fn(), 
      send:      vi.fn(),
      status:    vi.fn().mockReturnThis() 
    }

    // Find the actual handler (skipping middleware)
    const route = router.stack.find(s => s.route?.path === '/export' && (s.route as any)?.methods.get)
    const handler = route!.route!.stack[route!.route!.stack.length - 1].handle
    
    await handler(req as any, res as any, () => {})

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv')
    
    const sentCsv = res.send.mock.calls[0][0]
    expect(sentCsv).toContain('ID,Date,User,Action,Entity,Entity Name,Metadata')
    expect(sentCsv).toContain('1,2026-01-01,alice,create,project,"Proj A","{""key"":""val""}"')
    expect(sentCsv).toContain('2,2026-01-02,bob,delete,issue,"Bug ""1""",""')
  })

  it('GET / — supports entityType filtering', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as any) // Count call
    mockQuery.mockResolvedValue({ rows: [] } as any)         // Data call

    const req = { query: { entityType: 'document', limit: '10', offset: '0' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const route = router.stack.find(s => s.route?.path === '/' && (s.route as any)?.methods.get)
    const handler = route!.route!.stack[route!.route!.stack.length - 1].handle
    
    await handler(req as any, res as any, () => {})

    // Check if the query includes the filter
    const lastQuery = mockQuery.mock.calls.find(c => c[0].includes('WHERE'))?.[0]
    expect(lastQuery).toContain('entity_type = $1')
  })
})

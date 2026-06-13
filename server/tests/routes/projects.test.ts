import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

import router from '../../routes/projects.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

describe('Project Visibility Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET / — admin sees all projects (no membership join)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }, { id: 'p2' }] } as any)

    const req = { user: { role: 'admin', id: 'a1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/' && (s.route as any)?.methods.get)?.route?.stack[0]?.handle
    await handler!(req as any, res as any, () => {})

    const sql = mockQuery.mock.calls[0][0]
    expect(sql).not.toContain('JOIN project_members')
    expect(sql).not.toContain('pm.user_id = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual([])
  })

  it('GET / — non-admin only sees assigned projects via join', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as any)

    const req = { user: { role: 'member', id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/' && (s.route as any)?.methods.get)?.route?.stack[0]?.handle
    await handler!(req as any, res as any, () => {})

    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('JOIN project_members pm ON pm.project_id = p.id')
    expect(sql).toContain('WHERE pm.user_id = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1'])
  })

  it('GET /:id — non-admin cannot access unassigned project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any) // Membership query returns nothing

    const req = { params: { id: 'p2' }, user: { role: 'member', id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/:id' && (s.route as any)?.methods.get)?.route?.stack[0]?.handle
    await handler!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Project not found' })
  })
})

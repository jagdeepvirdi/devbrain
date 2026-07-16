import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

import router from '../../routes/api-tokens.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(method: 'get' | 'post' | 'delete', path: string) {
  const route = router.stack.find(s => s.route?.path === path && (s.route as any)?.methods[method])
  return route!.route!.stack[route!.route!.stack.length - 1].handle
}

function mockRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('API Tokens Route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET / — lists only the current user\'s tokens, scoped by user_id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', name: 'ci', token_prefix: 'dbrn_abcd', last_used_at: null, expires_at: null, created_at: '2026-01-01' }] } as any)

    const req = { user: { id: 'user-1', username: 'alice', role: 'member' } } as any
    const res = mockRes()

    await getHandler('get', '/')(req, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['user-1'])
    expect(res.json).toHaveBeenCalledWith({ data: [expect.objectContaining({ id: 't1' })] })
  })

  it('GET / — rejects dev-mode/legacy sessions (no real user row)', async () => {
    const req = { user: { id: 'dev', username: 'dev', role: 'admin' } } as any
    const res = mockRes()

    await getHandler('get', '/')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('POST / — creates a token, returns the raw value once, never persists it in plaintext', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'tok-1', name: 'reembed script', token_prefix: 'dbrn_1234', expires_at: null, created_at: '2026-07-16' }],
    } as any)

    const req = { user: { id: 'user-1', username: 'alice', role: 'member' }, body: { name: 'reembed script' } } as any
    const res = mockRes()

    await getHandler('post', '/')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(201)
    const payload = res.json.mock.calls[0][0].data
    expect(payload.token).toMatch(/^dbrn_[0-9a-f]{64}$/)

    // The value written to the DB must be a hash, not the raw token
    const insertArgs = mockQuery.mock.calls[0][1] as unknown[]
    expect(insertArgs).not.toContain(payload.token)
    expect(insertArgs[2]).toMatch(/^[0-9a-f]{64}$/) // token_hash
  })

  it('POST / — rejects an empty name', async () => {
    const req = { user: { id: 'user-1', username: 'alice', role: 'member' }, body: { name: '' } } as any
    const res = mockRes()

    await getHandler('post', '/')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('DELETE /:id — scopes the delete to the requesting user, 404s if not found/not owned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req = { user: { id: 'user-1', username: 'alice', role: 'member' }, params: { id: 'tok-2' } } as any
    const res = mockRes()

    await getHandler('delete', '/:id')(req, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['tok-2', 'user-1'])
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('DELETE /:id — succeeds when the token belongs to the requesting user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'tok-2' }] } as any)

    const req = { user: { id: 'user-1', username: 'alice', role: 'member' }, params: { id: 'tok-2' } } as any
    const res = mockRes()

    await getHandler('delete', '/:id')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { deleted: 'tok-2' } })
  })
})

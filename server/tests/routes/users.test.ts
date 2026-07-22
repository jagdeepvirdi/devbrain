import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/audit.js', () => ({
  logAudit: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}))

import usersRouter from '../../routes/users.js'
import { pool } from '../../db/pool.js'
import { logAudit } from '../../services/audit.js'
import bcrypt from 'bcryptjs'
import type { Mock } from 'vitest'

const mockQuery   = vi.mocked(pool.query)
const mockLogAudit = vi.mocked(logAudit)
// bcryptjs's async overloads are ambiguous through vi.mocked() (one signature
// takes a callback and resolves to void) — cast to the shape we actually use.
const mockHash    = bcrypt.hash    as unknown as Mock<(s: string, salt: number) => Promise<string>>
const mockCompare = bcrypt.compare as unknown as Mock<(s: string, hash: string) => Promise<boolean>>

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (usersRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function fakeReq(overrides: Record<string, unknown> = {}) {
  return { user: { id: 'admin-1', username: 'admin' }, params: {}, body: {}, ...overrides }
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) — this file has several tests where the
  // route short-circuits before ever calling pool.query, which would
  // otherwise leave a queued mockResolvedValueOnce/mockRejectedValueOnce
  // value to leak into (and desync) the next test's first query call.
  vi.resetAllMocks()
  mockHash.mockImplementation(async (pw: string) => `hashed:${pw}`)
})

describe('GET /api/users', () => {
  it('returns the user list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'get')(fakeReq(), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'u1' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/', 'get')(fakeReq(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/users', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')(fakeReq({ body: { username: 'a', password: 'short' } }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('hashes the password, creates the user, and logs an audit event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'newuser' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ body: { username: 'newuser', password: 'password1' } }), res, () => {})

    expect(mockHash).toHaveBeenCalledWith('password1', 10)
    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['newuser', null, 'hashed:password1', 'member'])
    expect(mockLogAudit).toHaveBeenCalledWith('admin-1', 'admin', 'user', 'u1', 'newuser', 'create')
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('passes through an explicit email and role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2' }] } as never)
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ body: { username: 'admin2', password: 'password1', email: 'a@b.com', role: 'admin' } }), res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['admin2', 'a@b.com', 'hashed:password1', 'admin'])
  })

  it('responds 409 when the username is already taken', async () => {
    mockQuery.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'))
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ body: { username: 'taken', password: 'password1' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'Username already taken' })
  })

  it('responds 500 on any other query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))
    const res = fakeRes()

    await getHandler('/', 'post')(fakeReq({ body: { username: 'validuser', password: 'password1' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/users/:id', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u1' }, body: { email: 'not-an-email' } }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" when no updatable fields are given', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u1' }, body: {} }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('lets a user reset their own password without adminPassword', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'admin-1', username: 'admin' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'admin-1' }, body: { password: 'newpassword1' } }), res, () => {})

    expect(mockCompare).not.toHaveBeenCalled()
    expect(mockHash).toHaveBeenCalledWith('newpassword1', 10)
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'admin-1', username: 'admin' } })
  })

  it('403s when resetting another user\'s password without adminPassword', async () => {
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { password: 'newpassword1' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'adminPassword is required to reset another user\'s password' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('403s when the admin has no verifiable password hash', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { password: 'newpassword1', adminPassword: 'x' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot verify admin identity' })
  })

  it('403s when adminPassword is incorrect', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'stored-hash' }] } as never)
    mockCompare.mockResolvedValueOnce(false)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { password: 'newpassword1', adminPassword: 'wrong' } }), res, () => {})

    expect(mockCompare).toHaveBeenCalledWith('wrong', 'stored-hash')
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin password incorrect' })
  })

  it('resets another user\'s password when adminPassword is correct', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'stored-hash' }] } as never)
    mockCompare.mockResolvedValueOnce(true)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', username: 'bob' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { password: 'newpassword1', adminPassword: 'correct' } }), res, () => {})

    expect(mockHash).toHaveBeenCalledWith('newpassword1', 10)
    const updateCall = mockQuery.mock.calls[1]
    expect(String(updateCall[0])).toContain('password_hash = $2')
    expect(updateCall[1]).toEqual(['u2', 'hashed:newpassword1'])
    expect(mockLogAudit).toHaveBeenCalledWith('admin-1', 'admin', 'user', 'u2', 'bob', 'update', { changed: ['password_hash'] })
  })

  it('updates email, role, and is_active with sequential parameter placeholders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', username: 'bob' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { email: 'b@b.com', role: 'viewer', is_active: false } }), res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('email = $2, role = $3, is_active = $4')
    expect(params).toEqual(['u2', 'b@b.com', 'viewer', false])
    expect(mockLogAudit).toHaveBeenCalledWith('admin-1', 'admin', 'user', 'u2', 'bob', 'update', { changed: ['email', 'role', 'is_active'] })
  })

  it('404s when the user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'missing' }, body: { email: 'a@b.com' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id', 'put')(fakeReq({ params: { id: 'u2' }, body: { email: 'a@b.com' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/users/:id', () => {
  it('400s when deleting yourself', async () => {
    const res = fakeRes()

    await getHandler('/:id', 'delete')(fakeReq({ params: { id: 'admin-1' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Cannot delete yourself' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('deletes the user and logs an audit event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', username: 'bob' }] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')(fakeReq({ params: { id: 'u2' } }), res, () => {})

    expect(mockLogAudit).toHaveBeenCalledWith('admin-1', 'admin', 'user', 'u2', 'bob', 'delete')
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'u2', username: 'bob' } } })
  })

  it('404s when the user does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')(fakeReq({ params: { id: 'missing' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/:id', 'delete')(fakeReq({ params: { id: 'u2' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/users/me/projects', () => {
  it('returns the projects the current user belongs to', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', member_role: 'member' }] } as never)
    const res = fakeRes()

    await getHandler('/me/projects', 'get')(fakeReq(), res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM project_members'), ['admin-1'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'p1', member_role: 'member' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/me/projects', 'get')(fakeReq(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/users/invites', () => {
  it('returns pending invites', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv1', email: 'a@b.com' }] } as never)
    const res = fakeRes()

    await getHandler('/invites', 'get')(fakeReq(), res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'inv1', email: 'a@b.com' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/invites', 'get')(fakeReq(), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/users/invite', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/invite', 'post')(fakeReq({ body: { email: 'not-an-email' } }), res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates an invite, hashes the token for storage, and returns the raw token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv1', email: 'new@b.com', role: 'member', expires_at: 'later' }] } as never)
    const res = fakeRes()

    await getHandler('/invite', 'post')(fakeReq({ body: { email: 'new@b.com' } }), res, () => {})

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO user_invites')
    const [email, role, tokenHash, expires, createdBy] = params as [string, string, string, Date, string]
    expect(email).toBe('new@b.com')
    expect(role).toBe('member')
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(expires.getTime()).toBeGreaterThan(Date.now())
    expect(createdBy).toBe('admin-1')

    const responseData = (res.json.mock.calls[0][0] as { data: { token: string } }).data
    expect(responseData.token).toMatch(/^[0-9a-f]{64}$/)
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('stores a null created_by for the built-in dev user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'inv1' }] } as never)
    const res = fakeRes()

    await getHandler('/invite', 'post')(fakeReq({ user: { id: 'dev', username: 'dev' }, body: { email: 'new@b.com' } }), res, () => {})

    expect(mockQuery.mock.calls[0][1]![4]).toBeNull()
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/invite', 'post')(fakeReq({ body: { email: 'new@b.com' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/users/invites/:id', () => {
  it('deletes the invite', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/invites/:id', 'delete')(fakeReq({ params: { id: 'inv1' } }), res, () => {})

    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM user_invites WHERE id = $1', ['inv1'])
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/invites/:id', 'delete')(fakeReq({ params: { id: 'inv1' } }), res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

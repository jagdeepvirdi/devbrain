import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/crypto.js', () => ({
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

vi.mock('../../services/ldap.js', () => ({
  ldapAuth: vi.fn(),
}))

vi.mock('../../services/audit.js', () => ({
  logAudit: vi.fn(),
}))

vi.mock('../../middleware/auth.js', () => ({
  API_TOKEN_PREFIX: 'dbrn_',
  tryApiToken: vi.fn(),
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

vi.mock('bcryptjs', () => ({
  default: { hash: vi.fn(), compare: vi.fn(), hashSync: vi.fn(() => 'dummy-hash') },
}))

vi.mock('../../lib/env.js', () => ({
  env: { AUTH_PASSWORD: undefined, JWT_SECRET: 'test-secret-at-least-16-chars!!', NODE_ENV: 'test' },
}))

import authRouter from '../../routes/auth.js'
import { pool } from '../../db/pool.js'
import { decrypt } from '../../services/crypto.js'
import { ldapAuth } from '../../services/ldap.js'
import { logAudit } from '../../services/audit.js'
import { tryApiToken } from '../../middleware/auth.js'
import bcrypt from 'bcryptjs'
import { env } from '../../lib/env.js'
import type { Mock } from 'vitest'

const mockQuery = vi.mocked(pool.query)
const mockDecrypt = vi.mocked(decrypt)
const mockLdapAuth = vi.mocked(ldapAuth)
const mockLogAudit = vi.mocked(logAudit)
const mockTryApiToken = vi.mocked(tryApiToken)
const mockHash    = bcrypt.hash    as unknown as Mock<(s: string, salt: number) => Promise<string>>
const mockCompare = bcrypt.compare as unknown as Mock<(s: string, hash: string) => Promise<boolean>>

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post') {
  const layer = (authRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn() }
}

function signValid(payload: Record<string, unknown>) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d', issuer: 'devbrain', audience: 'devbrain-client' })
}

beforeEach(() => {
  vi.resetAllMocks()
  env.AUTH_PASSWORD = 'test-auth-password'
  mockHash.mockImplementation(async (pw: string) => `hashed:${pw}`)
  mockCompare.mockResolvedValue(false)
})

describe('POST /api/auth/login', () => {
  it('returns a dev-mode token without querying the DB when AUTH_PASSWORD is unset', async () => {
    env.AUTH_PASSWORD = undefined
    const res = fakeRes()
    await getHandler('/login', 'post')({ body: {} }, res, () => {})
    expect(mockQuery).not.toHaveBeenCalled()
    const data = (res.json.mock.calls[0][0] as { data: { devMode: boolean; user: { id: string } } }).data
    expect(data.devMode).toBe(true)
    expect(data.user.id).toBe('dev')
  })

  it('400s when password is missing', async () => {
    const res = fakeRes()
    await getHandler('/login', 'post')({ body: { username: 'bob' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  describe('legacy single-password mode (no users exist yet)', () => {
    it('401s on the wrong password', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
      const res = fakeRes()
      await getHandler('/login', 'post')({ body: { password: 'wrong' } }, res, () => {})
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('creates the first admin user, defaulting username to "admin", and sets the cookie', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'admin' }] } as never)
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { password: 'test-auth-password' } }, res, () => {})

      expect(mockQuery.mock.calls[1][1]).toEqual(['admin', 'hashed:test-auth-password'])
      expect(res.cookie).toHaveBeenCalledWith('devbrain_token', expect.any(String), expect.any(Object))
      const data = (res.json.mock.calls[0][0] as { data: { devMode: boolean; user: { username: string } } }).data
      expect(data.devMode).toBe(false)
      expect(data.user.username).toBe('admin')
    })

    it('uses the provided username when given', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', role: 'admin' }] } as never)
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: '  alice  ', password: 'test-auth-password' } }, res, () => {})

      expect(mockQuery.mock.calls[1][1]).toEqual(['alice', 'hashed:test-auth-password'])
    })
  })

  describe('multi-user mode (users already exist)', () => {
    it('400s when username is missing or blank', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      const res = fakeRes()
      await getHandler('/login', 'post')({ body: { password: 'x' } }, res, () => {})
      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('403s when the account is deactivated', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'bob', role: 'member', is_active: false, password_hash: 'h' }] } as never)
      const res = fakeRes()
      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('401s on an incorrect password', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'bob', role: 'member', is_active: true, password_hash: 'h' }] } as never)
      mockCompare.mockResolvedValueOnce(false)
      const res = fakeRes()
      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'wrong' } }, res, () => {})
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('logs in with a correct password and sets the cookie', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'bob', role: 'member', is_active: true, password_hash: 'h' }] } as never)
      mockCompare.mockResolvedValueOnce(true)
      const res = fakeRes()
      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'right' } }, res, () => {})
      expect(res.cookie).toHaveBeenCalled()
      const data = (res.json.mock.calls[0][0] as { data: { user: { username: string } } }).data
      expect(data.user.username).toBe('bob')
    })

    it('runs a dummy bcrypt compare and 401s when the user is not found (no LDAP configured)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never) // user lookup: not found
      mockQuery.mockResolvedValueOnce({ rows: [] } as never) // ldap_settings: none
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: 'ghost', password: 'x' } }, res, () => {})

      expect(mockCompare).toHaveBeenCalledWith('x', 'dummy-hash')
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('401s when LDAP is configured but authentication fails', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { url: 'ldap://x', bindPasswordEnc: 'enc:pw' } }] } as never)
      mockLdapAuth.mockResolvedValueOnce(null)
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})

      expect(mockDecrypt).toHaveBeenCalledWith('enc:pw')
      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('logs in via LDAP, upserting the local user record', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ value: { url: 'ldap://x' } }] } as never)
      mockLdapAuth.mockResolvedValueOnce({ username: 'bob', email: 'bob@x.com', dn: 'cn=bob' } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', role: 'member', is_active: true }] } as never)
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})

      expect(mockQuery.mock.calls[3][1]).toEqual(['bob', 'bob@x.com', 'cn=bob'])
      expect(res.cookie).toHaveBeenCalled()
      const data = (res.json.mock.calls[0][0] as { data: { user: { id: string } } }).data
      expect(data.user.id).toBe('u2')
    })

    it('403s when the LDAP-linked local user is deactivated', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ value: {} }] } as never)
      mockLdapAuth.mockResolvedValueOnce({ username: 'bob', email: 'bob@x.com', dn: 'cn=bob' } as never)
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', role: 'member', is_active: false }] } as never)
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})

      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('logs and falls through to 401 when the LDAP settings lookup throws', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
      mockQuery.mockResolvedValueOnce({ rows: [] } as never)
      mockQuery.mockRejectedValueOnce(new Error('db down'))
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const res = fakeRes()

      await getHandler('/login', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})

      expect(errSpy).toHaveBeenCalledWith('LDAP login check failed:', expect.any(Error))
      expect(res.status).toHaveBeenCalledWith(401)
      errSpy.mockRestore()
    })
  })
})

describe('POST /api/auth/logout', () => {
  it('clears the cookie and confirms', async () => {
    const res = fakeRes()
    await getHandler('/logout', 'post')({}, res, () => {})
    expect(res.clearCookie).toHaveBeenCalledWith('devbrain_token')
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })
})

describe('POST /api/auth/register', () => {
  it('forces the admin role on the very first registration (no auth required)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1', username: 'first', role: 'admin' }] } as never)
    const res = fakeRes()

    await getHandler('/register', 'post')({ body: { username: 'first', password: 'password1', role: 'viewer' }, headers: {} }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['first', null, 'hashed:password1', 'admin'])
    expect(res.cookie).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('400s on an invalid body', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    const res = fakeRes()
    await getHandler('/register', 'post')({ body: { username: 'a' }, headers: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('401s without an admin Bearer token and no invite token, once users already exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    const res = fakeRes()
    await getHandler('/register', 'post')({ body: { username: 'new', password: 'password1' }, headers: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('401s with a malformed Bearer token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    const res = fakeRes()
    await getHandler('/register', 'post')({
      body: { username: 'new', password: 'password1' }, headers: { authorization: 'Bearer not-a-jwt' },
    }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid session' })
  })

  it('403s when the Bearer token is valid but not an admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    const token = signValid({ userId: 'u1', role: 'member' })
    const res = fakeRes()
    await getHandler('/register', 'post')({
      body: { username: 'new', password: 'password1' }, headers: { authorization: `Bearer ${token}` },
    }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('registers a new user when authenticated as admin, without setting a cookie', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u2', username: 'new', role: 'member' }] } as never)
    const token = signValid({ userId: 'admin1', role: 'admin' })
    const res = fakeRes()

    await getHandler('/register', 'post')({
      body: { username: 'new', password: 'password1', email: 'n@x.com', role: 'member' },
      headers: { authorization: `Bearer ${token}` },
    }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['new', 'n@x.com', 'hashed:password1', 'member'])
    expect(res.cookie).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('registers via a valid invite token, applying the invite\'s role/email and deleting it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ email: 'invited@x.com', role: 'viewer' }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // delete invite
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u3', username: 'invitee', role: 'viewer' }] } as never)
    const res = fakeRes()

    await getHandler('/register', 'post')({
      body: { username: 'invitee', password: 'password1', role: 'admin', token: 'raw-token' }, headers: {},
    }, res, () => {})

    expect(String(mockQuery.mock.calls[2][0])).toContain('DELETE FROM user_invites')
    expect(mockQuery.mock.calls[3][1]).toEqual(['invitee', 'invited@x.com', 'hashed:password1', 'viewer'])
    expect(res.cookie).toHaveBeenCalled()
  })

  it('401s on an invalid or expired invite token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 1 }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/register', 'post')({
      body: { username: 'invitee', password: 'password1', token: 'bad' }, headers: {},
    }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('409s when the username is already taken', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
    mockQuery.mockRejectedValueOnce(new Error('duplicate key value'))
    const res = fakeRes()
    await getHandler('/register', 'post')({ body: { username: 'taken', password: 'password1' }, headers: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('responds via serverError on any other insert failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never)
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))
    const res = fakeRes()
    await getHandler('/register', 'post')({ body: { username: 'validname', password: 'password1' }, headers: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/auth/me', () => {
  it('reports dev mode without inspecting cookies/tokens when AUTH_PASSWORD is unset', async () => {
    env.AUTH_PASSWORD = undefined
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: {} }, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { devMode: boolean } }).data
    expect(data.devMode).toBe(true)
  })

  it('reports unauthenticated when there is no cookie or bearer token', async () => {
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: {}, cookies: {} }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: false } })
  })

  it('prefers the cookie token over a bearer token when both are present', async () => {
    const token = signValid({ userId: 'u1', username: 'bob', role: 'member' })
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: { authorization: 'Bearer garbage' }, cookies: { devbrain_token: token } }, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { authed: boolean } }).data
    expect(data.authed).toBe(true)
  })

  it('authenticates via an API token', async () => {
    mockTryApiToken.mockResolvedValueOnce({ id: 'u1', username: 'bot', role: 'member' } as never)
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: { authorization: 'Bearer dbrn_abc123' }, cookies: {} }, res, () => {})
    expect(mockTryApiToken).toHaveBeenCalledWith('dbrn_abc123')
    expect(res.json).toHaveBeenCalledWith({ data: { authed: true, devMode: false, user: { id: 'u1', username: 'bot', role: 'member' } } })
  })

  it('reports unauthenticated when the API token is invalid', async () => {
    mockTryApiToken.mockResolvedValueOnce(null)
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: { authorization: 'Bearer dbrn_bad' }, cookies: {} }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: false } })
  })

  it('reports unauthenticated when tryApiToken throws (the .catch(() => null) fallback)', async () => {
    mockTryApiToken.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: { authorization: 'Bearer dbrn_bad' }, cookies: {} }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: false } })
  })

  it('authenticates via a valid JWT', async () => {
    const token = signValid({ userId: 'u1', username: 'bob', role: 'admin' })
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: {}, cookies: { devbrain_token: token } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: true, devMode: false, user: { id: 'u1', username: 'bob', role: 'admin' } } })
  })

  it('reports unauthenticated for an expired/invalid JWT', async () => {
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: {}, cookies: { devbrain_token: 'not-a-real-jwt' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: false } })
  })

  it('reports unauthenticated for a validly-signed token missing userId', async () => {
    const token = signValid({ foo: 'bar' })
    const res = fakeRes()
    await getHandler('/me', 'get')({ headers: {}, cookies: { devbrain_token: token } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { authed: false } })
  })
})

describe('POST /api/auth/change-password', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/change-password', 'post')({ user: { id: 'u1' }, body: { currentPassword: '', newPassword: 'short' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s in legacy/dev mode', async () => {
    const res = fakeRes()
    await getHandler('/change-password', 'post')({ user: { id: 'dev' }, body: { currentPassword: 'a', newPassword: 'newpass1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the user has no password on file (LDAP-only)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/change-password', 'post')({ user: { id: 'u1' }, body: { currentPassword: 'a', newPassword: 'newpass1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('401s on an incorrect current password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'stored' }] } as never)
    mockCompare.mockResolvedValueOnce(false)
    const res = fakeRes()
    await getHandler('/change-password', 'post')({ user: { id: 'u1' }, body: { currentPassword: 'wrong', newPassword: 'newpass1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('updates the password and logs an audit event', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ password_hash: 'stored' }] } as never)
    mockCompare.mockResolvedValueOnce(true)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/change-password', 'post')({ user: { id: 'u1', username: 'bob' }, body: { currentPassword: 'right', newPassword: 'newpass1' } }, res, () => {})

    expect(mockQuery.mock.calls[1][1]).toEqual(['hashed:newpass1', 'u1'])
    expect(mockLogAudit).toHaveBeenCalledWith('u1', 'bob', 'user', 'u1', 'bob', 'update', { changed: ['password_hash'] })
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })
})

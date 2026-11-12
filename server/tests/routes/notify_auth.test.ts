import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import crypto from 'node:crypto'

// Mutable so individual tests can flip AUTH_PASSWORD on/off (requireAuth reads it per request).
const mockEnv = vi.hoisted(() => ({
  AUTH_PASSWORD: 'test-password' as string | undefined,
  JWT_SECRET: 'test-secret-test-secret-test-secret',
}))
vi.mock('../../lib/env.js', () => ({ env: mockEnv }))

vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../services/notifier.js', () => ({ sendAppriseNotification: vi.fn() }))
vi.mock('../../services/notifications.js', () => ({ getUsersToNotify: vi.fn() }))
vi.mock('../../services/crypto.js', () => ({ encrypt: vi.fn(), decrypt: vi.fn() }))

import notifyRouter from '../../routes/notify.js'
import { pool } from '../../db/pool.js'
import { sendAppriseNotification } from '../../services/notifier.js'
import { getUsersToNotify } from '../../services/notifications.js'

const mockQuery = vi.mocked(pool.query)
const mockSend = vi.mocked(sendAppriseNotification)
const mockUsers = vi.mocked(getUsersToNotify)

type Handle = (req: unknown, res: unknown, next: () => void) => unknown
type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: Handle }[] } }

// Runs POST / through its full middleware chain in order (real requireAuth + real handler), stopping
// as soon as a layer doesn't call next() — which is what Express does after a 401.
async function postNotify(headers: Record<string, string>, body: unknown = { project: 'proj', title: 'T', body: 'B' }) {
  const layer = (notifyRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === '/' && s.route.methods.post
  )!
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  const req = { headers, body, cookies: {} }
  for (const { handle } of layer.route!.stack) {
    let advanced = false
    await handle(req, res, () => { advanced = true })
    if (!advanced) break
  }
  return res
}

function signJwt(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    { userId: 'u1', username: 'jagdeep', role: 'admin', ...overrides },
    mockEnv.JWT_SECRET,
    { issuer: 'devbrain', audience: 'devbrain-client', expiresIn: '1h' },
  )
}

// A project row, then one user with a single successful channel delivery.
function primeSuccessfulNotify() {
  mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'proj' }] } as never)
  mockUsers.mockResolvedValueOnce(['u1'])
  mockSend.mockResolvedValueOnce([{ delivery_status: 'sent' }] as never)
}

beforeEach(() => {
  vi.resetAllMocks()
  mockEnv.AUTH_PASSWORD = 'test-password'
})

describe('POST /api/notify — authentication (real requireAuth)', () => {
  it('401s with no credentials and never reaches the handler', async () => {
    const res = await postNotify({})
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' })
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('401s on a malformed / wrongly-signed JWT', async () => {
    const forged = jwt.sign({ userId: 'u1', username: 'x', role: 'admin' }, 'some-other-secret-some-other-secret',
      { issuer: 'devbrain', audience: 'devbrain-client' })
    for (const token of ['not-a-jwt', forged]) {
      const res = await postNotify({ authorization: `Bearer ${token}` })
      expect(res.status).toHaveBeenCalledWith(401)
    }
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('401s on a JWT missing the required claims (legacy token)', async () => {
    const res = await postNotify({ authorization: `Bearer ${signJwt({ userId: undefined })}` })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('401s on an unknown dbrn_ API token', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // token lookup
    const res = await postNotify({ authorization: 'Bearer dbrn_doesnotexist' })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired API token' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('401s on an expired dbrn_ API token', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ token_id: 't1', user_id: 'u1', username: 'jagdeep', role: 'admin', expires_at: '2020-01-01T00:00:00Z' }],
    } as never)
    const res = await postNotify({ authorization: 'Bearer dbrn_expired' })
    expect(res.status).toHaveBeenCalledWith(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('200s with a valid JWT and delivers', async () => {
    primeSuccessfulNotify()
    const res = await postNotify({ authorization: `Bearer ${signJwt()}` })
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, delivered_to: 1 } })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('200s with a valid dbrn_ API token (hashed lookup) and delivers', async () => {
    // Query order: token lookup, the fire-and-forget last_used_at UPDATE, then the project lookup.
    mockQuery
      .mockResolvedValueOnce({ rows: [{ token_id: 't1', user_id: 'u1', username: 'jagdeep', role: 'member', expires_at: null }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'proj' }] } as never)
    mockUsers.mockResolvedValueOnce(['u1'])
    mockSend.mockResolvedValueOnce([{ delivery_status: 'sent' }] as never)

    const token = 'dbrn_abc123'
    const res = await postNotify({ authorization: `Bearer ${token}` })

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, delivered_to: 1 } })
    // The raw token must never reach the DB — only its sha256.
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('token_hash')
    expect(params).toEqual([crypto.createHash('sha256').update(token).digest('hex')])
  })

  it('still validates the body once authenticated (400, no delivery)', async () => {
    const res = await postNotify({ authorization: `Bearer ${signJwt()}` }, { project: 'proj' })
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('is a pass-through when AUTH_PASSWORD is unset (local dev)', async () => {
    mockEnv.AUTH_PASSWORD = undefined
    primeSuccessfulNotify()
    const res = await postNotify({})
    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, delivered_to: 1 } })
  })
})

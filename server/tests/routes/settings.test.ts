import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

vi.mock('../../services/ldap.js', () => ({
  ldapAuth: vi.fn(),
}))

vi.mock('../../lib/env.js', () => ({
  env: {
    AI_PROVIDER: 'ollama',
    OLLAMA_CHAT_MODEL: 'mistral',
    GEMINI_CHAT_MODEL: 'gemini-2.0-flash',
    OLLAMA_URL: 'http://localhost:11434',
    AUTH_PASSWORD: undefined,
  },
}))

import settingsRouter from '../../routes/settings.js'
import { pool } from '../../db/pool.js'
import { encrypt, decrypt } from '../../services/crypto.js'
import { ldapAuth } from '../../services/ldap.js'
import { env } from '../../lib/env.js'

const mockQuery   = vi.mocked(pool.query)
const mockEncrypt = vi.mocked(encrypt)
const mockDecrypt = vi.mocked(decrypt)
const mockLdapAuth = vi.mocked(ldapAuth)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put') {
  const layer = (settingsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
  env.AI_PROVIDER = 'ollama'
  env.AUTH_PASSWORD = undefined
})

describe('GET /api/settings/ldap', () => {
  it('returns null when no settings row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/ldap', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: null })
  })

  it('returns config with hasPassword=true when a bindPasswordEnc is stored', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { url: 'ldap://x', bindDn: 'cn=admin', searchBase: 'dc=x', userAttr: 'uid', bindPasswordEnc: 'enc:secret' } }],
    } as never)
    const res = fakeRes()
    await getHandler('/ldap', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({
      data: { url: 'ldap://x', bindDn: 'cn=admin', searchBase: 'dc=x', userAttr: 'uid', hasPassword: true },
    })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/ldap', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/settings/ldap', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/ldap', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('encrypts a new bind password and stores it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/ldap', 'put')({ body: { url: 'ldap://x', bindDn: 'cn=admin', bindPassword: 'secret', searchBase: 'dc=x' } }, res, () => {})

    expect(mockEncrypt).toHaveBeenCalledWith('secret')
    const [, params] = mockQuery.mock.calls[1]
    const stored = JSON.parse((params as string[])[0])
    expect(stored.bindPasswordEnc).toBe('enc:secret')
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('preserves the existing encrypted password when none is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { bindPasswordEnc: 'enc:old' } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/ldap', 'put')({ body: { url: 'ldap://x', bindDn: 'cn=admin', searchBase: 'dc=x' } }, res, () => {})

    expect(mockEncrypt).not.toHaveBeenCalled()
    const [, params] = mockQuery.mock.calls[1]
    const stored = JSON.parse((params as string[])[0])
    expect(stored.bindPasswordEnc).toBe('enc:old')
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/ldap', 'put')({ body: { url: 'ldap://x', bindDn: 'cn=admin', searchBase: 'dc=x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/settings/ldap/test', () => {
  it('400s when username or password is missing', async () => {
    const res = fakeRes()
    await getHandler('/ldap/test', 'post')({ body: { username: 'bob' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('falls back to stored settings (decrypting the stored password) when not overridden', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ value: { url: 'ldap://stored', bindDn: 'cn=stored', searchBase: 'dc=stored', userAttr: 'uid', bindPasswordEnc: 'enc:storedpw' } }],
    } as never)
    mockLdapAuth.mockResolvedValueOnce({ username: 'bob', dn: 'cn=bob' } as never)
    const res = fakeRes()

    await getHandler('/ldap/test', 'post')({ body: { username: 'bob', password: 'testpw' } }, res, () => {})

    expect(mockDecrypt).toHaveBeenCalledWith('enc:storedpw')
    expect(mockLdapAuth).toHaveBeenCalledWith('bob', 'testpw', {
      url: 'ldap://stored', bindDn: 'cn=stored', searchBase: 'dc=stored', userAttr: 'uid', bindPassword: 'storedpw',
    })
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true, user: { username: 'bob', dn: 'cn=bob' } } })
  })

  it('uses overridden config fields when provided, without touching the stored password', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockLdapAuth.mockResolvedValueOnce({ username: 'bob' } as never)
    const res = fakeRes()

    await getHandler('/ldap/test', 'post')({
      body: { username: 'bob', password: 'testpw', url: 'ldap://override', bindDn: 'cn=o', searchBase: 'dc=o', bindPassword: 'overridepw' },
    }, res, () => {})

    expect(mockDecrypt).not.toHaveBeenCalled()
    expect(mockLdapAuth).toHaveBeenCalledWith('bob', 'testpw', expect.objectContaining({ url: 'ldap://override', bindPassword: 'overridepw' }))
  })

  it('401s when authentication fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockLdapAuth.mockResolvedValueOnce(null)
    const res = fakeRes()

    await getHandler('/ldap/test', 'post')({ body: { username: 'bob', password: 'wrong' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(401)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/ldap/test', 'post')({ body: { username: 'bob', password: 'x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/settings', () => {
  it('reports the ollama chat model by default', async () => {
    const res = fakeRes()
    await getHandler('/', 'get')({}, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { ai: { chatModel: string } } }).data
    expect(data.ai.chatModel).toBe('mistral')
  })

  it('reports the fixed claude-sonnet chat model when AI_PROVIDER=claude', async () => {
    env.AI_PROVIDER = 'claude'
    const res = fakeRes()
    await getHandler('/', 'get')({}, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { ai: { chatModel: string } } }).data
    expect(data.ai.chatModel).toBe('claude-sonnet-4-6')
  })

  it('reports the configured gemini chat model when AI_PROVIDER=gemini', async () => {
    env.AI_PROVIDER = 'gemini'
    const res = fakeRes()
    await getHandler('/', 'get')({}, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { ai: { chatModel: string } } }).data
    expect(data.ai.chatModel).toBe('gemini-2.0-flash')
  })

  it('reports auth disabled / dev mode when no AUTH_PASSWORD is set', async () => {
    const res = fakeRes()
    await getHandler('/', 'get')({}, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { auth: { enabled: boolean; devMode: boolean } } }).data
    expect(data.auth).toEqual({ enabled: false, devMode: true })
  })

  it('reports auth enabled / not dev mode when AUTH_PASSWORD is set', async () => {
    env.AUTH_PASSWORD = 'secret'
    const res = fakeRes()
    await getHandler('/', 'get')({}, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { auth: { enabled: boolean; devMode: boolean } } }).data
    expect(data.auth).toEqual({ enabled: true, devMode: false })
  })
})

describe('GET/PUT /api/settings/claude', () => {
  it('GET returns null scan_root when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/claude', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { scan_root: null } })
  })

  it('GET returns the stored scan_root', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { scan_root: '/repos' } }] } as never)
    const res = fakeRes()
    await getHandler('/claude', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { scan_root: '/repos' } })
  })

  it('GET responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/claude', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/claude', 'put')({ body: { scan_root: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores a new scan_root (nullable)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/claude', 'put')({ body: { scan_root: null } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify({ scan_root: null })])
    expect(res.json).toHaveBeenCalledWith({ data: { scan_root: null } })
  })

  it('PUT responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/claude', 'put')({ body: { scan_root: '/x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET/PUT /api/settings/antigravity', () => {
  it('GET returns null scan_root when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/antigravity', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { scan_root: null } })
  })

  it('PUT 400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/antigravity', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores a new scan_root', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/antigravity', 'put')({ body: { scan_root: '/repos' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([JSON.stringify({ scan_root: '/repos' })])
  })

  it('GET responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/antigravity', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/antigravity', 'put')({ body: { scan_root: '/repos' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

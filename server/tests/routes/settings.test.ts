import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os   from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'

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

vi.mock('../../services/backup.js', () => ({
  triggerBackupNow: vi.fn(),
  DEFAULT_BACKUP_RETENTION_COUNT: 30,
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
import { triggerBackupNow } from '../../services/backup.js'
import { env } from '../../lib/env.js'

const mockQuery   = vi.mocked(pool.query)
const mockConnect = vi.mocked(pool.connect)
const mockEncrypt = vi.mocked(encrypt)
const mockDecrypt = vi.mocked(decrypt)
const mockLdapAuth = vi.mocked(ldapAuth)
const mockTriggerBackupNow = vi.mocked(triggerBackupNow)

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

function fakeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
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

describe('GET /api/settings/backup', () => {
  function mockAllQueries(overrides: Partial<Record<'projects' | 'documents' | 'issues' | 'commands' | 'releases' | 'runbooks' | 'tasks', unknown[]>> = {}) {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('FROM projects'))  return { rows: overrides.projects  ?? [] }
      if (text.includes('FROM documents')) return { rows: overrides.documents ?? [] }
      if (text.includes('FROM issues'))    return { rows: overrides.issues    ?? [] }
      if (text.includes('FROM commands'))  return { rows: overrides.commands  ?? [] }
      if (text.includes('FROM releases'))  return { rows: overrides.releases  ?? [] }
      if (text.includes('FROM runbooks'))  return { rows: overrides.runbooks  ?? [] }
      if (text.includes('FROM tasks'))     return { rows: overrides.tasks     ?? [] }
      throw new Error(`unexpected query: ${text}`)
    })
  }

  it('exports all tables as a JSON backup', async () => {
    mockAllQueries({ projects: [{ id: 'p1' }], documents: [{ id: 'd1' }] })
    const res = fakeRes()

    await getHandler('/backup', 'get')({}, res, () => {})

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json')
    const body = res.json.mock.calls[0][0] as { version: number; data: { projects: unknown[]; documents: unknown[] } }
    expect(body.version).toBe(1)
    expect(body.data.projects).toEqual([{ id: 'p1' }])
    expect(body.data.documents).toEqual([{ id: 'd1' }])
  })

  it('falls back to an empty tasks array when the tasks table query fails', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('FROM tasks')) throw new Error('tasks table missing')
      return { rows: [] }
    })
    const res = fakeRes()

    await getHandler('/backup', 'get')({}, res, () => {})

    const body = res.json.mock.calls[0][0] as { data: { tasks: unknown[] } }
    expect(body.data.tasks).toEqual([])
  })

  it('responds 500 when a non-tasks query fails', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      if (String(sql).includes('FROM projects')) throw new Error('db down')
      return { rows: [] }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/backup', 'get')({}, res, () => {})

    expect(errSpy).toHaveBeenCalledWith('backup error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('POST /api/settings/import', () => {
  it('400s when the backup is missing data or has the wrong version', async () => {
    const res = fakeRes()
    await getHandler('/import', 'post')({ query: {}, body: { version: 2, data: {} } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('dry run: tallies created vs. skipped without opening a transaction', async () => {
    mockQuery.mockImplementation(async (sql: unknown, params?: unknown) => {
      const text = String(sql)
      if (text.includes('FROM projects'))  return { rows: [{ n: 1 }] } // 1 of 2 exists
      return { rows: [{ n: 0 }] } // nothing else exists
      void params
    })
    const res = fakeRes()
    const backup = { version: 1, data: { projects: [{ id: 'p1' }, { id: 'p2' }], documents: [{ id: 'd1' }] } }

    await getHandler('/import', 'post')({ query: { dry_run: 'true' }, body: backup }, res, () => {})

    expect(mockConnect).not.toHaveBeenCalled()
    const data = (res.json.mock.calls[0][0] as { data: { dry_run: boolean; summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.dry_run).toBe(true)
    expect(data.summary.projects).toEqual({ skipped: 1, created: 1 })
    expect(data.summary.documents).toEqual({ skipped: 0, created: 1 })
  })

  it('dry run: skips the existence query entirely for a table with no ids', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()

    await getHandler('/import', 'post')({ query: { dry_run: 'true' }, body: { version: 1, data: {} } }, res, () => {})

    expect(mockQuery).not.toHaveBeenCalled()
    const data = (res.json.mock.calls[0][0] as { data: { summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.summary.projects).toEqual({ skipped: 0, created: 0 })
  })

  it('real import: inserts each table, tallying created vs. ON CONFLICT skips, then commits', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] }
      if (sql.includes('INSERT INTO projects')) return { rowCount: 1 }
      if (sql.includes('INSERT INTO documents')) return { rowCount: 0 } // conflict -> skipped
      return { rowCount: 1 }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    const backup = {
      version: 1,
      data: {
        projects: [{ id: 'p1', name: 'P', short_name: 'p' }],
        documents: [{ id: 'd1', title: 'D' }],
        issues: [{ id: 'i1', title: 'I' }],
        commands: [{ id: 'c1', title: 'C', command: 'echo hi' }],
        releases: [{ id: 'r1', project_id: 'p1', version: '1.0', date: '2026-01-01' }],
        runbooks: [{ id: 'rb1', title: 'RB' }],
      },
    }

    await getHandler('/import', 'post')({ query: {}, body: backup }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()
    const data = (res.json.mock.calls[0][0] as { data: { dry_run: boolean; summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.dry_run).toBe(false)
    expect(data.summary.projects).toEqual({ created: 1, skipped: 0 })
    expect(data.summary.documents).toEqual({ created: 0, skipped: 1 })
    expect(data.summary.issues).toEqual({ created: 1, skipped: 0 })
    expect(data.summary.commands).toEqual({ created: 1, skipped: 0 })
    expect(data.summary.releases).toEqual({ created: 1, skipped: 0 })
    expect(data.summary.runbooks).toEqual({ created: 1, skipped: 0 })
  })

  it('real import: rolls back, releases the client, and 500s on failure', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO projects')) throw new Error('constraint violation')
      return { rows: [], rowCount: 0 }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/import', 'post')({ query: {}, body: { version: 1, data: { projects: [{ id: 'p1' }] } } }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET/PUT /api/settings/backup-config', () => {
  it('GET returns defaults when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/backup-config', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { path: null, schedule: 'off', last_backup_at: null, retention_count: 30 } })
  })

  it('GET falls back to the default retention_count when the stored row predates that field', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/x', schedule: 'daily', last_backup_at: '2026-01-01' } }] } as never)
    const res = fakeRes()
    await getHandler('/backup-config', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { path: '/x', schedule: 'daily', last_backup_at: '2026-01-01', retention_count: 30 } })
  })

  it('GET responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/backup-config', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/backup-config', 'put')({ body: { path: '/x', schedule: 'bogus' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT 400s on a retention_count outside the allowed range', async () => {
    const res = fakeRes()
    await getHandler('/backup-config', 'put')({ body: { path: '/x', schedule: 'off', retention_count: 0 } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT merges into any existing extra fields and stores, defaulting retention_count when never set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/old', schedule: 'off', last_backup_at: '2026-01-01' } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/backup-config', 'put')({ body: { path: '/new', schedule: 'daily' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { path: '/new', schedule: 'daily', last_backup_at: '2026-01-01', retention_count: 30 } })
  })

  it('PUT stores an explicit retention_count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/old', schedule: 'off', last_backup_at: null, retention_count: 30 } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/backup-config', 'put')({ body: { path: '/new', schedule: 'daily', retention_count: 5 } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { path: '/new', schedule: 'daily', last_backup_at: null, retention_count: 5 } })
  })

  it('PUT preserves the existing retention_count when the request omits it', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/old', schedule: 'daily', last_backup_at: null, retention_count: 5 } }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/backup-config', 'put')({ body: { path: '/old', schedule: 'weekly' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { path: '/old', schedule: 'weekly', last_backup_at: null, retention_count: 5 } })
  })

  it('PUT responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/backup-config', 'put')({ body: { path: '/x', schedule: 'off' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/settings/backup-now', () => {
  it('400s when no backup path is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/backup-now', 'post')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockTriggerBackupNow).not.toHaveBeenCalled()
  })

  it('triggers a backup at the configured path, defaulting retention_count when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/backups' } }] } as never)
    const res = fakeRes()

    await getHandler('/backup-now', 'post')({}, res, () => {})

    expect(mockTriggerBackupNow).toHaveBeenCalledWith('/backups', 30)
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true, path: '/backups' } })
  })

  it('passes a configured retention_count through to triggerBackupNow', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/backups', retention_count: 5 } }] } as never)
    const res = fakeRes()

    await getHandler('/backup-now', 'post')({}, res, () => {})

    expect(mockTriggerBackupNow).toHaveBeenCalledWith('/backups', 5)
  })

  it('responds via serverError when the backup fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ value: { path: '/backups' } }] } as never)
    mockTriggerBackupNow.mockRejectedValueOnce(new Error('disk full'))
    const res = fakeRes()

    await getHandler('/backup-now', 'post')({}, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/settings/zip-import', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-zip-import-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  function buildZip(entries: { name: string; content: string }[]): string {
    const zip = new AdmZip()
    for (const e of entries) zip.addFile(e.name, Buffer.from(e.content, 'utf-8'))
    const zipPath = path.join(tmpDir, 'import.zip')
    zip.writeZip(zipPath)
    return zipPath
  }

  const docMd = '---\ntitle: API Notes\ntags:\n  - api\n---\nSome document content.'
  const issueMd = '---\ntitle: Login broken\nstatus: open\npriority: high\n---\nUsers cannot log in.'
  const cmdMd = '---\ntitle: Deploy\nlanguage: bash\n---\n```bash\nnpm run deploy\n```'

  it('400s when no file was uploaded', async () => {
    const res = fakeRes()
    await getHandler('/zip-import', 'post')({ file: undefined, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('dry run: counts new documents/issues/commands, skips duplicates, unknown projects, and non-.md/directory entries', async () => {
    const zipPath = buildZip([
      { name: 'playcru/documents/api-notes.md', content: docMd },
      { name: 'playcru/issues/login-broken.md', content: issueMd },
      { name: 'playcru/commands/deploy.md', content: cmdMd },
      { name: 'playcru/documents/README.txt', content: 'not markdown' }, // wrong extension
      { name: 'playcru/unknown-dir/thing.md', content: '---\ntitle: X\n---\nY' }, // unrecognized entityDir
      { name: 'unknownproject/documents/orphan.md', content: '---\ntitle: X\n---\nY' }, // unknown project slug
      { name: 'toplevel.md', content: 'x' }, // too few path segments
    ])
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('FROM projects')) return { rows: [{ id: 'p1', short_name: 'playcru' }] }
      if (text.includes('FROM documents')) return { rows: [] } // no existing doc
      if (text.includes('FROM issues'))    return { rows: [] }
      if (text.includes('FROM commands'))  return { rows: [] }
      throw new Error(`unexpected query: ${text}`)
    })
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: { dry_run: 'true' } }, res, () => {})

    expect(mockConnect).not.toHaveBeenCalled()
    const data = (res.json.mock.calls[0][0] as { data: { dry_run: boolean; summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.dry_run).toBe(true)
    expect(data.summary).toEqual({
      documents: { created: 1, skipped: 0 },
      issues:    { created: 1, skipped: 0 },
      commands:  { created: 1, skipped: 0 },
    })
  })

  it('dry run: counts an already-existing document as skipped', async () => {
    const zipPath = buildZip([{ name: 'playcru/documents/api-notes.md', content: docMd }])
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('FROM projects'))  return { rows: [{ id: 'p1', short_name: 'playcru' }] }
      if (text.includes('FROM documents')) return { rows: [{ id: 'existing' }] }
      throw new Error(`unexpected query: ${text}`)
    })
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: { dry_run: 'true' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.summary.documents).toEqual({ created: 0, skipped: 1 })
  })

  it('real import: inserts a document, issue, and command inside a transaction, extracting the command from its code fence', async () => {
    const zipPath = buildZip([
      { name: 'playcru/documents/api-notes.md', content: docMd },
      { name: 'playcru/issues/login-broken.md', content: issueMd },
      { name: 'playcru/commands/deploy.md', content: cmdMd },
    ])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'playcru' }] } as never) // project map
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] }
      if (sql.startsWith('SELECT id FROM')) return { rows: [] } // no existing rows
      return { rows: [] } // INSERT
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: {} }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('BEGIN')
    expect(client.query).toHaveBeenCalledWith('COMMIT')
    expect(client.release).toHaveBeenCalled()

    const insertDoc = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO documents'))
    expect(insertDoc![1]).toEqual(['p1', 'API Notes', 'md', ['api'], '', 'Some document content.', expect.any(String)])

    const insertCmd = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO commands'))
    expect(insertCmd![1]).toEqual(['p1', 'Deploy', 'npm run deploy', 'bash', '', [], false, expect.any(String)])

    const data = (res.json.mock.calls[0][0] as { data: { summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.summary.documents.created).toBe(1)
    expect(data.summary.issues.created).toBe(1)
    expect(data.summary.commands.created).toBe(1)
  })

  it('real import: skips a document, issue, and command whose titles already exist for the project', async () => {
    const zipPath = buildZip([
      { name: 'playcru/documents/api-notes.md', content: docMd },
      { name: 'playcru/issues/login-broken.md', content: issueMd },
      { name: 'playcru/commands/deploy.md', content: cmdMd },
    ])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'playcru' }] } as never)
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [] }
      if (sql.startsWith('SELECT id FROM')) return { rows: [{ id: 'existing' }] }
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: {} }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.summary).toEqual({
      documents: { created: 0, skipped: 1 },
      issues:    { created: 0, skipped: 1 },
      commands:  { created: 0, skipped: 1 },
    })
    expect(client.query.mock.calls.some(c => String(c[0]).startsWith('INSERT INTO'))).toBe(false)
  })

  it('silently skips an entry with malformed frontmatter', async () => {
    const zipPath = buildZip([
      { name: 'playcru/documents/broken.md', content: '---\ntitle: [oops\n---\nbody' },
      { name: 'playcru/documents/api-notes.md', content: docMd },
    ])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'playcru' }] } as never)
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: {} }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { summary: Record<string, { created: number; skipped: number }> } }).data
    expect(data.summary.documents).toEqual({ created: 1, skipped: 0 })
  })

  it('real import: rolls back, releases the client, and responds via serverError on failure', async () => {
    const zipPath = buildZip([{ name: 'playcru/documents/api-notes.md', content: docMd }])
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'playcru' }] } as never)
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql === 'BEGIN') return { rows: [] }
      if (sql.startsWith('SELECT id FROM')) throw new Error('db exploded')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()

    await getHandler('/zip-import', 'post')({ file: { path: zipPath }, query: {} }, res, () => {})

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET/PUT /api/settings/notifications', () => {
  it('GET returns defaults when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/notifications', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({
      data: { stale_threshold_days: 14, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true },
    })
  })

  it('GET responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/notifications', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: { stale_threshold_days: 0 } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores validated rules with defaults applied', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: { stale_threshold_days: 30 } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({
      data: { stale_threshold_days: 30, stale_issues_enabled: true, sync_alerts_enabled: true, ai_task_alerts_enabled: true },
    })
  })

  it('PUT responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/notifications', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET/PUT /api/settings/digest', () => {
  it('GET returns defaults when unset', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/digest', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { enabled: false, time: '09:00' } })
  })

  it('GET responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('PUT 400s on an invalid time format', async () => {
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: { enabled: true, time: '9am' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('PUT stores validated digest settings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: { enabled: true, time: '18:30' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { enabled: true, time: '18:30' } })
  })

  it('PUT responds via serverError on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest', 'put')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

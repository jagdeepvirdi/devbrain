import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

vi.mock('../../services/integrations.js', () => ({
  syncGitHub: vi.fn(),
  syncJira:   vi.fn(),
  syncLinear: vi.fn(),
}))

vi.mock('../../services/notifications.js', () => ({
  createNotification: vi.fn(),
}))

import integrationsRouter from '../../routes/integrations.js'
import { pool } from '../../db/pool.js'
import { encrypt, decrypt } from '../../services/crypto.js'
import { syncGitHub, syncJira, syncLinear } from '../../services/integrations.js'
import { createNotification } from '../../services/notifications.js'

const mockQuery      = vi.mocked(pool.query)
const mockEncrypt    = vi.mocked(encrypt)
const mockDecrypt     = vi.mocked(decrypt)
const mockSyncGitHub = vi.mocked(syncGitHub)
const mockSyncJira   = vi.mocked(syncJira)
const mockSyncLinear = vi.mocked(syncLinear)
const mockCreateNotification = vi.mocked(createNotification)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (integrationsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

describe('GET /api/integrations/config', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the configured integrations', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', provider: 'github' }] } as never)
    const res = fakeRes()

    await getHandler('/config', 'get')({}, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'i1', provider: 'github' }] })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()

    await getHandler('/config', 'get')({}, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'db down' })
  })
})

describe('POST /api/integrations', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { provider: 'github' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('encrypts the token and inserts a new integration', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1', provider: 'github' }] } as never)
    const res = fakeRes()
    const body = { provider: 'github', project_id: '11111111-1111-1111-1111-111111111111', external_project_id: 'o/r', token: 'gh-token' }

    await getHandler('/', 'post')({ body }, res, () => {})

    expect(mockEncrypt).toHaveBeenCalledWith('gh-token')
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO integrations')
    expect(params).toEqual(['github', '11111111-1111-1111-1111-111111111111', 'o/r', 'enc:gh-token', {}])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'i1', provider: 'github' } })
  })

  it('stores a null token when none is provided (existing token preserved via COALESCE)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    const res = fakeRes()
    const body = { provider: 'linear', project_id: '11111111-1111-1111-1111-111111111111', external_project_id: 'TEAM' }

    await getHandler('/', 'post')({ body }, res, () => {})

    expect(mockEncrypt).not.toHaveBeenCalled()
    expect(mockQuery.mock.calls[0][1]).toEqual(['linear', '11111111-1111-1111-1111-111111111111', 'TEAM', null, {}])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('conflict'))
    const res = fakeRes()
    const body = { provider: 'jira', project_id: '11111111-1111-1111-1111-111111111111', external_project_id: 'PROJ' }

    await getHandler('/', 'post')({ body }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/integrations/:id', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes the integration', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'i1' } }, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM integrations WHERE id = $1', ['i1'])
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('fk violation'))
    const res = fakeRes()

    await getHandler('/:id', 'delete')({ params: { id: 'i1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/integrations/:id/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('UPDATE integrations')) return { rows: [] }
      if (text.includes("key = 'notification_rules'")) return { rows: [] }
      throw new Error(`unexpected query: ${text}`)
    })
  })

  function integrationRow(overrides: Record<string, unknown> = {}) {
    return { id: 'i1', provider: 'github', project_id: 'p1', external_project_id: 'o/r', token_enc: null, ...overrides }
  }

  it('404s when the integration does not exist', async () => {
    mockQuery.mockReset()
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'missing' }, user: { id: 'u1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockSyncGitHub).not.toHaveBeenCalled()
  })

  it('decrypts the stored token and calls syncGitHub for a github integration', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow({ token_enc: 'enc:gh' })] }))
    mockSyncGitHub.mockResolvedValueOnce({ created: 2, skipped: 1, total: 3 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockDecrypt).toHaveBeenCalledWith('enc:gh')
    expect(mockSyncGitHub).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), 'gh')
    expect(res.json).toHaveBeenCalledWith({ data: { created: 2, skipped: 1, total: 3 } })
  })

  it('does not decrypt when no token is stored, and calls syncJira for a jira integration', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow({ provider: 'jira' })] }))
    mockSyncJira.mockResolvedValueOnce({ created: 0, skipped: 0, total: 0 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockDecrypt).not.toHaveBeenCalled()
    expect(mockSyncJira).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), null)
  })

  it('calls syncLinear for a linear integration', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow({ provider: 'linear' })] }))
    mockSyncLinear.mockResolvedValueOnce({ created: 0, skipped: 0, total: 0 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockSyncLinear).toHaveBeenCalled()
  })

  it('defaults to a zeroed result for an unrecognized provider, without calling any sync function', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow({ provider: 'bitbucket' })] }))
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockSyncGitHub).not.toHaveBeenCalled()
    expect(mockSyncJira).not.toHaveBeenCalled()
    expect(mockSyncLinear).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { created: 0, skipped: 0, total: 0 } })
  })

  it('updates last_synced_at with the integration id', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow()] }))
    mockSyncGitHub.mockResolvedValueOnce({ created: 0, skipped: 0, total: 0 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE integrations'))
    expect(updateCall![1]).toEqual(['i1'])
  })

  it('sends a sync-complete notification by default', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow()] }))
    mockSyncGitHub.mockResolvedValueOnce({ created: 5, skipped: 0, total: 5 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockCreateNotification).toHaveBeenCalledWith('u1', {
      type: 'sync_complete',
      title: 'Sync Complete: github',
      body: 'Successfully imported 5 new issues from github.',
      entityType: 'project',
      entityId: 'p1',
    })
  })

  it('skips the notification when sync_alerts_enabled is explicitly false', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow()] }))
    mockQuery.mockImplementationOnce(async () => ({ rows: [] })) // UPDATE integrations
    mockQuery.mockImplementationOnce(async () => ({ rows: [{ value: { sync_alerts_enabled: false } }] }))
    mockSyncGitHub.mockResolvedValueOnce({ created: 0, skipped: 0, total: 0 })
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(mockCreateNotification).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { created: 0, skipped: 0, total: 0 } })
  })

  it('logs and continues when the notification lookup fails, still returning the sync result', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow()] }))
    mockQuery.mockImplementationOnce(async () => ({ rows: [] })) // UPDATE integrations
    mockQuery.mockImplementationOnce(async () => { throw new Error('settings query failed') })
    mockSyncGitHub.mockResolvedValueOnce({ created: 1, skipped: 0, total: 1 })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(errSpy).toHaveBeenCalledWith('Failed to create integration sync notification:', expect.any(Error))
    expect(res.json).toHaveBeenCalledWith({ data: { created: 1, skipped: 0, total: 1 } })
    errSpy.mockRestore()
  })

  it('responds 500 when the sync itself throws, without updating last_synced_at', async () => {
    mockQuery.mockImplementationOnce(async () => ({ rows: [integrationRow()] }))
    mockSyncGitHub.mockRejectedValueOnce(new Error('GitHub API error: 403'))
    const res = fakeRes()

    await getHandler('/:id/sync', 'post')({ params: { id: 'i1' }, user: { id: 'u1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'GitHub API error: 403' })
    const updateCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('UPDATE integrations'))
    expect(updateCall).toBeUndefined()
  })
})

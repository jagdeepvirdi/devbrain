import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/notifier.js', () => ({
  sendAppriseNotification: vi.fn(),
}))

vi.mock('../../services/notifications.js', () => ({
  getUsersToNotify: vi.fn(),
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn((s: string) => `encrypted_${s}`),
  decrypt: vi.fn((s: string) => s.replace('encrypted_', '')),
}))

import notifyRouter from '../../routes/notify.js'
import { pool } from '../../db/pool.js'
import { sendAppriseNotification } from '../../services/notifier.js'
import { getUsersToNotify } from '../../services/notifications.js'
import { encrypt, decrypt } from '../../services/crypto.js'

const mockQuery = vi.mocked(pool.query)
const mockSendApprise = vi.mocked(sendAppriseNotification)
const mockGetUsersToNotify = vi.mocked(getUsersToNotify)
const mockEncrypt = vi.mocked(encrypt)
const mockDecrypt = vi.mocked(decrypt)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete' | 'patch') {
  const layer = (notifyRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('POST /api/notify', () => {
  it('400s when project, title, or body is missing', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project: 'x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sums delivered_to across users with differing per-user delivery counts', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'proj' }] } as never)
    mockGetUsersToNotify.mockResolvedValueOnce(['u1', 'u2', 'u3'])
    mockSendApprise
      .mockResolvedValueOnce([{ delivery_status: 'sent' }, { delivery_status: 'sent' }] as never) // u1: 2 channels
      .mockResolvedValueOnce([] as never)                                                          // u2: no channels configured
      .mockResolvedValueOnce([{ delivery_status: 'failed' }] as never)                              // u3: 1 channel
    const res = fakeRes()

    await getHandler('/', 'post')({ body: { project: 'proj', title: 'T', body: 'B' } }, res, () => {})

    expect(mockSendApprise).toHaveBeenCalledTimes(3)
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, delivered_to: 3 } })
  })

  it('404s when the project short_name does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project: 'ghost', title: 'T', body: 'B' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { project: 'x', title: 'T', body: 'B' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/notify/send-digest', () => {
  it.each(['::1', '::ffff:127.0.0.1'])('accepts localhost variant %s', async (ip) => {
    mockSendApprise.mockResolvedValueOnce([])
    const res = fakeRes()
    await getHandler('/send-digest', 'post')({ socket: { remoteAddress: ip }, body: { title: 'T', body: 'B', userId: 'u1' } }, res, () => {})
    expect(res.status).not.toHaveBeenCalledWith(403)
  })

  it('400s when title, body, or userId is missing', async () => {
    const res = fakeRes()
    await getHandler('/send-digest', 'post')({ socket: { remoteAddress: '127.0.0.1' }, body: { title: 'T' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('responds 500 on a failure', async () => {
    mockSendApprise.mockRejectedValueOnce(new Error('boom'))
    const res = fakeRes()
    await getHandler('/send-digest', 'post')({ socket: { remoteAddress: '127.0.0.1' }, body: { title: 'T', body: 'B', userId: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/notify/log', () => {
  it('applies all filters with sequential placeholders and value transforms', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/log', 'get')({
      user: { id: 'u1' },
      query: { project: 'p1', level: 'error', channel: 'Telegram', status: 'sent', dateFrom: '2026-01-01', dateTo: '2026-01-31' },
    }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('n.entity_id = $2')
    expect(String(sql)).toContain('n.type = $3')
    expect(String(sql)).toContain('n.channel = $4')
    expect(String(sql)).toContain('n.delivery_status = $5')
    expect(String(sql)).toContain('n.created_at >= $6')
    expect(String(sql)).toContain('n.created_at <= $7')
    expect(values).toEqual(['u1', 'p1', 'external_error', 'telegram', 'sent', new Date('2026-01-01'), new Date('2026-01-31')])
  })

  it('defaults to limit 50 and clamps to a max of 200', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res1 = fakeRes()
    await getHandler('/log', 'get')({ user: { id: 'u1' }, query: {} }, res1, () => {})
    expect((mockQuery.mock.calls[1][1] as unknown[]).slice(-2)).toEqual([50, 0])

    vi.resetAllMocks()
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res2 = fakeRes()
    await getHandler('/log', 'get')({ user: { id: 'u1' }, query: { limit: '9999' } }, res2, () => {})
    expect((mockQuery.mock.calls[1][1] as unknown[]).slice(-2)).toEqual([200, 0])
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/log', 'get')({ user: { id: 'u1' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/notify/test', () => {
  it('400s when no channels are configured', async () => {
    mockSendApprise.mockResolvedValueOnce([])
    const res = fakeRes()
    await getHandler('/test', 'post')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('500s with details when any channel fails to deliver', async () => {
    mockSendApprise.mockResolvedValueOnce([{ delivery_status: 'sent' }, { delivery_status: 'failed' }] as never)
    const res = fakeRes()
    await getHandler('/test', 'post')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'One or more notification channels failed to deliver.', details: expect.any(Array) })
  })

  it('responds 500 on a failure', async () => {
    mockSendApprise.mockRejectedValueOnce(new Error('boom'))
    const res = fakeRes()
    await getHandler('/test', 'post')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/notify/retry/:id', () => {
  it('404s when the notification does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/retry/:id', 'post')({ user: { id: 'u1' }, params: { id: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('retries with the stripped level and project id, deleting the log entry on success', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'n1', type: 'external_error', title: 'T', body: 'B', entity_type: 'project', entity_id: 'p1' }],
    } as never)
    mockSendApprise.mockResolvedValueOnce([{ delivery_status: 'sent' }] as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()

    await getHandler('/retry/:id', 'post')({ user: { id: 'u1' }, params: { id: 'n1' } }, res, () => {})

    expect(mockSendApprise).toHaveBeenCalledWith({ userId: 'u1', title: 'T', body: 'B', level: 'error', projectId: 'p1' })
    expect(mockQuery.mock.calls[1]).toEqual(['DELETE FROM notifications WHERE id = $1', ['n1']])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, details: [{ delivery_status: 'sent' }] } })
  })

  it('nulls projectId for a non-project notification, and does not delete on continued failure', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'n1', type: 'external_info', title: 'T', body: 'B', entity_type: 'issue', entity_id: 'i1' }],
    } as never)
    mockSendApprise.mockResolvedValueOnce([{ delivery_status: 'failed' }] as never)
    const res = fakeRes()

    await getHandler('/retry/:id', 'post')({ user: { id: 'u1' }, params: { id: 'n1' } }, res, () => {})

    expect(mockSendApprise).toHaveBeenCalledWith(expect.objectContaining({ projectId: null }))
    expect(mockQuery).toHaveBeenCalledTimes(1) // no DELETE issued
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/retry/:id', 'post')({ user: { id: 'u1' }, params: { id: 'n1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/notify/channels', () => {
  it('leaves a short URL unmasked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', apprise_url: 'encrypted_short' }] } as never)
    const res = fakeRes()
    await getHandler('/channels', 'get')({ user: { id: 'u1' } }, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { apprise_url: string }[] }).data
    expect(data[0].apprise_url).toBe('short')
  })

  it('masks a decrypt failure to an empty string instead of throwing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', apprise_url: 'not-decryptable' }] } as never)
    mockDecrypt.mockImplementationOnce(() => { throw new Error('bad ciphertext') })
    const res = fakeRes()
    await getHandler('/channels', 'get')({ user: { id: 'u1' } }, res, () => {})
    const data = (res.json.mock.calls[0][0] as { data: { apprise_url: string }[] }).data
    expect(data[0].apprise_url).toBe('')
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/channels', 'get')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/notify/channels', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/channels', 'post')({ user: { id: 'u1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('encrypts the URL and creates the channel', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'Tg', enabled: true }] } as never)
    const res = fakeRes()
    await getHandler('/channels', 'post')({ user: { id: 'u1' }, body: { name: 'Tg', apprise_url: 'tgram://x' } }, res, () => {})
    expect(mockEncrypt).toHaveBeenCalledWith('tgram://x')
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'Tg', 'encrypted_tgram://x', true])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/channels', 'post')({ user: { id: 'u1' }, body: { name: 'Tg', apprise_url: 'tgram://x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/notify/channels/:id', () => {
  it('deletes the channel', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/channels/:id', 'delete')({ user: { id: 'u1' }, params: { id: 'c1' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['c1', 'u1'])
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/channels/:id', 'delete')({ user: { id: 'u1' }, params: { id: 'c1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/notify/channels/:id', () => {
  it('400s when enabled is not a boolean', async () => {
    const res = fakeRes()
    await getHandler('/channels/:id', 'patch')({ user: { id: 'u1' }, params: { id: 'c1' }, body: { enabled: 'yes' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('updates the enabled flag', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', enabled: false }] } as never)
    const res = fakeRes()
    await getHandler('/channels/:id', 'patch')({ user: { id: 'u1' }, params: { id: 'c1' }, body: { enabled: false } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([false, 'c1', 'u1'])
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'c1', enabled: false } })
  })

  it('404s when the channel does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/channels/:id', 'patch')({ user: { id: 'u1' }, params: { id: 'missing' }, body: { enabled: true } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/channels/:id', 'patch')({ user: { id: 'u1' }, params: { id: 'c1' }, body: { enabled: true } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/notify/project-prefs', () => {
  it('returns all preferences', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'pref1' }] } as never)
    const res = fakeRes()
    await getHandler('/project-prefs', 'get')({}, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'pref1' }] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/project-prefs', 'get')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/notify/project-prefs', () => {
  it('400s when project_id, channel_id, or enabled is missing', async () => {
    const res = fakeRes()
    await getHandler('/project-prefs', 'put')({ body: { project_id: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('upserts the preference', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 'p1', channel_id: 'c1', enabled: false }] } as never)
    const res = fakeRes()
    await getHandler('/project-prefs', 'put')({ body: { project_id: 'p1', channel_id: 'c1', enabled: false } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', 'c1', false])
    expect(res.json).toHaveBeenCalledWith({ data: { project_id: 'p1', channel_id: 'c1', enabled: false } })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/project-prefs', 'put')({ body: { project_id: 'p1', channel_id: 'c1', enabled: true } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

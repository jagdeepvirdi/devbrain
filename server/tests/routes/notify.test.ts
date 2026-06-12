import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../services/notifier.js', () => ({
  sendAppriseNotification: vi.fn(),
}))

vi.mock('../../services/notifications.js', () => ({
  getUsersToNotify: vi.fn(),
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn((val) => `encrypted_${val}`),
  decrypt: vi.fn((val) => val.replace('encrypted_', '')),
}))

import router from '../../routes/notify.js'
import { pool } from '../../db/pool.js'
import { sendAppriseNotification } from '../../services/notifier.js'
import { getUsersToNotify } from '../../services/notifications.js'

const mockQuery = vi.mocked(pool.query)
const mockSendApprise = vi.mocked(sendAppriseNotification)
const mockGetUsersToNotify = vi.mocked(getUsersToNotify)

describe('Notify Route Handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POST / — triggers notification delivery for project members', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', short_name: 'testproj' }] } as any)
    mockGetUsersToNotify.mockResolvedValueOnce(['u1', 'u2'])
    mockSendApprise.mockResolvedValue([{ id: 'n1', delivery_status: 'sent' } as any])

    const req = { body: { project: 'testproj', title: 'Hello', body: 'World', level: 'info' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockGetUsersToNotify).toHaveBeenCalledWith('p1')
    expect(mockSendApprise).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, delivered_to: 2 } })
  })

  it('POST /send-digest — loops back from localhost to send digest', async () => {
    mockSendApprise.mockResolvedValueOnce([{ id: 'n2', delivery_status: 'sent' } as any])

    const req = {
      socket: { remoteAddress: '127.0.0.1' },
      body: { title: 'Digest', body: 'Summary', userId: 'u1' }
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/send-digest') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockSendApprise).toHaveBeenCalledWith({
      userId: 'u1',
      title: 'Digest',
      body: 'Summary',
      level: 'info'
    })
    expect(res.json).toHaveBeenCalledWith({ data: { success: true, details: [{ id: 'n2', delivery_status: 'sent' }] } })
  })

  it('POST /send-digest — blocks non-localhost IP', async () => {
    const req = {
      socket: { remoteAddress: '192.168.1.5' },
      body: { title: 'Digest', body: 'Summary', userId: 'u1' }
    }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/send-digest') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden — localhost only' })
  })

  it('GET /log — returns paginated log of external notifications', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 5 }] } as any) // count query
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n3', title: 'Test log' }] } as any) // data query

    const req = { user: { id: 'u1' }, query: { limit: '10', offset: '0', project: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/log') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith({
      data: {
        items: [{ id: 'n3', title: 'Test log' }],
        total: 5
      }
    })
  })

  it('POST /test — delivers test notification to user channels', async () => {
    mockSendApprise.mockResolvedValueOnce([{ id: 'n4', delivery_status: 'sent' } as any])

    const req = { user: { id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/test') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockSendApprise).toHaveBeenCalledWith({
      userId: 'u1',
      title: 'DevBrain Test Notification',
      body: 'This is a test notification dispatched from your DevBrain settings.',
      level: 'success'
    })
    expect(res.json).toHaveBeenCalledWith({
      data: {
        success: true,
        details: [{ id: 'n4', delivery_status: 'sent' }]
      }
    })
  })

  it('GET /channels — lists channels and decrypts the apprise URLs', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'c1', name: 'Test Chan', apprise_url: 'encrypted_tgram://bot:12345/chat', enabled: true }] } as any)

    const req = { user: { id: 'u1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const routeStack = router.stack.find(s => s.route?.path === '/channels') as any
    const handler = routeStack.route.stack[routeStack.route.stack.length - 1].handle
    await handler(req as any, res as any, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('FROM notification_channels'),
      ['u1']
    )
    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          id: 'c1',
          name: 'Test Chan',
          apprise_url: 'tgram://...5/chat',
          enabled: true
        }
      ]
    })
  })
})

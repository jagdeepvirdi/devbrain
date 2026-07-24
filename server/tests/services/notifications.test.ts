import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
    // Advisory-lock client: always "acquires" the lock in these tests so the
    // pre-existing pool.query-mocked assertions below don't need to change —
    // the lock-contention path itself is covered separately in advisoryLock.test.ts.
    connect: vi.fn(async () => ({
      query: vi.fn((sql: string) =>
        Promise.resolve(sql.includes('pg_try_advisory') ? { rows: [{ locked: true }] } : { rows: [] })
      ),
      release: vi.fn(),
    })),
  },
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

const {
  createNotification,
  getUsersToNotify,
  scanStaleIssues,
  startNotificationScheduler,
  startDigestScheduler,
} = await import('../../services/notifications.js')
const { pool } = await import('../../db/pool.js')
const { spawn } = await import('child_process')

const mockQuery = vi.mocked(pool.query)
const mockSpawn = vi.mocked(spawn)

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts with default channel/deliveryStatus and null entity fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)

    const result = await createNotification('u1', { type: 'test', title: 'T', body: 'B' })

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO notifications')
    expect(params).toEqual(['u1', 'test', 'T', 'B', null, null, 'in_app', 'delivered'])
    expect(result).toEqual({ id: 'n1' })
  })

  it('respects explicit channel, deliveryStatus, and entity fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n2' }] } as never)

    await createNotification('u2', {
      type: 'stale_issue', title: 'T', body: 'B',
      entityType: 'issue', entityId: 'i1', channel: 'telegram', deliveryStatus: 'sent',
    })

    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['u2', 'stale_issue', 'T', 'B', 'issue', 'i1', 'telegram', 'sent'])
  })
})

describe('getUsersToNotify', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always includes active admins, and notifies all active users when projectId is null', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes("role = 'admin'")) return { rows: [{ id: 'admin1' }] }
      if (text.includes('FROM users WHERE is_active')) return { rows: [{ id: 'admin1' }, { id: 'user2' }] }
      throw new Error(`unexpected query: ${text}`)
    })

    const result = await getUsersToNotify(null)

    expect(result.sort()).toEqual(['admin1', 'user2'])
  })

  it('notifies active project members (deduped with admins) when projectId is set', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes("role = 'admin'")) return { rows: [{ id: 'admin1' }] }
      if (text.includes('project_members')) return { rows: [{ user_id: 'admin1' }, { user_id: 'member2' }] }
      throw new Error(`unexpected query: ${text}`)
    })

    const result = await getUsersToNotify('p1')

    expect(result.sort()).toEqual(['admin1', 'member2']) // admin1 not duplicated
    const membersCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('project_members'))
    expect(membersCall![1]).toEqual(['p1'])
  })
})

describe('scanStaleIssues', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function baseMock(overrides: {
    settingsRow?: unknown
    admins?: unknown[]
    globalUsers?: unknown[]
    projectMembers?: unknown[]
    staleIssues?: unknown[]
    existingNotif?: unknown[]
  } = {}) {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes("key = 'notification_rules'")) return { rows: overrides.settingsRow ? [overrides.settingsRow] : [] }
      if (text.includes("role = 'admin'")) return { rows: overrides.admins ?? [{ id: 'admin1' }] }
      if (text.includes('project_members')) return { rows: overrides.projectMembers ?? [] }
      if (text.includes('FROM users WHERE is_active')) return { rows: overrides.globalUsers ?? overrides.admins ?? [{ id: 'admin1' }] }
      if (text.includes('FROM issues i')) return { rows: overrides.staleIssues ?? [] }
      if (text.includes('FROM notifications') && text.includes("type = 'stale_issue'")) return { rows: overrides.existingNotif ?? [] }
      if (text.includes('INSERT INTO notifications')) return { rows: [{ id: 'n1' }] }
      throw new Error(`unexpected query: ${text}`)
    })
  }

  it('does nothing further (after reading settings) when stale_issues_enabled is false', async () => {
    baseMock({ settingsRow: { value: { stale_issues_enabled: false } } })

    await scanStaleIssues()

    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('uses a 14-day default threshold when no settings row exists', async () => {
    baseMock({ staleIssues: [] })

    await scanStaleIssues()

    const issuesCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM issues i'))
    expect(issuesCall![1]).toEqual(['14 days'])
  })

  it('uses a custom threshold from settings', async () => {
    baseMock({ settingsRow: { value: { stale_threshold_days: 30 } }, staleIssues: [] })

    await scanStaleIssues()

    const issuesCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM issues i'))
    expect(issuesCall![1]).toEqual(['30 days'])
  })

  it('creates a notification for a stale issue when the user has not been notified in 24h', async () => {
    baseMock({ staleIssues: [{ id: 'i1', title: 'Broken', project_id: null }], existingNotif: [] })

    await scanStaleIssues()

    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notifications'))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toEqual([
      'admin1', 'stale_issue', 'Stale Issue: Broken',
      'This issue has been open for more than 14 days with no updates.',
      'issue', 'i1', 'in_app', 'delivered',
    ])
  })

  it('skips a user already notified about the same stale issue in the last 24h', async () => {
    baseMock({ staleIssues: [{ id: 'i1', title: 'Broken', project_id: null }], existingNotif: [{ x: 1 }] })

    await scanStaleIssues()

    const insertCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO notifications'))
    expect(insertCall).toBeUndefined()
  })

  it('notifies project members (not just admins) for a project-scoped stale issue', async () => {
    baseMock({
      staleIssues: [{ id: 'i1', title: 'Broken', project_id: 'p1' }],
      projectMembers: [{ user_id: 'member9' }],
    })

    await scanStaleIssues()

    const insertCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO notifications'))
    const notifiedUsers = insertCalls.map(c => (c[1] as unknown[])[0])
    expect(notifiedUsers.sort()).toEqual(['admin1', 'member9'])
  })

  it('catches and logs errors without throwing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(scanStaleIssues()).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith('[Notification Scheduler] Error scanning stale issues:', expect.any(Error))
    errSpy.mockRestore()
  })
})

describe('startNotificationScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs scanStaleIssues once after the initial delay, and again on the hourly interval', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValue({ rows: [] } as never)

    startNotificationScheduler()
    await vi.advanceTimersByTimeAsync(15_000)
    const callsAfterFirst = mockQuery.mock.calls.length
    expect(callsAfterFirst).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterFirst)

    vi.useRealTimers()
  })
})

describe('startDigestScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spawns the python digest scheduler with inherited stdio', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child as never)

    await startDigestScheduler()

    expect(mockSpawn).toHaveBeenCalledWith('python', ['server/scripts/digest_scheduler.py'], {
      stdio: 'inherit',
      env: process.env,
    })
  })

  it('logs an error when the child process errors', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await startDigestScheduler()
    child.emit('error', new Error('spawn failed'))

    expect(errSpy).toHaveBeenCalledWith('[Digest Scheduler Process] Error:', 'spawn failed')
    errSpy.mockRestore()
  })

  it('logs the exit code when the child process closes', async () => {
    const child = new EventEmitter()
    mockSpawn.mockReturnValue(child as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await startDigestScheduler()
    child.emit('close', 0)

    expect(logSpy).toHaveBeenCalledWith('[Digest Scheduler Process] Exited with code 0')
    logSpy.mockRestore()
  })

  it('skips spawning when another instance already holds the digest lock', async () => {
    const { pool } = await import('../../db/pool.js')
    vi.mocked(pool.connect).mockResolvedValueOnce({
      query: vi.fn().mockResolvedValue({ rows: [{ locked: false }] }),
      release: vi.fn(),
    } as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await startDigestScheduler()

    expect(mockSpawn).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith('  digest-scheduler: another instance already owns this lock — skipping')
    logSpy.mockRestore()
  })
})

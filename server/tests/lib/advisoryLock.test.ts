import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { connect: vi.fn() },
}))

const { withAdvisoryLock, tryAcquireLongLivedLock, LOCK_KEYS } = await import('../../lib/advisoryLock.js')
const { pool } = await import('../../db/pool.js')

function makeClient(lockedResult: boolean) {
  return {
    query: vi.fn((sql: string) =>
      Promise.resolve(sql.includes('pg_try_advisory') ? { rows: [{ locked: lockedResult }] } : { rows: [] })
    ),
    release: vi.fn(),
  }
}

describe('withAdvisoryLock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs fn and commits when the lock is acquired', async () => {
    const client = makeClient(true)
    vi.mocked(pool.connect).mockResolvedValue(client as never)
    const fn = vi.fn().mockResolvedValue(undefined)

    await withAdvisoryLock(LOCK_KEYS.backup, fn)

    expect(fn).toHaveBeenCalledOnce()
    const calls = client.query.mock.calls.map(c => String(c[0]))
    expect(calls).toEqual(['BEGIN', expect.stringContaining('pg_try_advisory_xact_lock'), 'COMMIT'])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('skips fn and rolls back when another instance already holds the lock', async () => {
    const client = makeClient(false)
    vi.mocked(pool.connect).mockResolvedValue(client as never)
    const fn = vi.fn()

    await withAdvisoryLock(LOCK_KEYS.backup, fn)

    expect(fn).not.toHaveBeenCalled()
    const calls = client.query.mock.calls.map(c => String(c[0]))
    expect(calls).toEqual(['BEGIN', expect.stringContaining('pg_try_advisory_xact_lock'), 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back, releases the client, and rethrows when fn throws', async () => {
    const client = makeClient(true)
    vi.mocked(pool.connect).mockResolvedValue(client as never)
    const fn = vi.fn().mockRejectedValue(new Error('job failed'))

    await expect(withAdvisoryLock(LOCK_KEYS.backup, fn)).rejects.toThrow('job failed')

    const calls = client.query.mock.calls.map(c => String(c[0]))
    expect(calls).toEqual(['BEGIN', expect.stringContaining('pg_try_advisory_xact_lock'), 'ROLLBACK'])
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe('tryAcquireLongLivedLock', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a release function when the lock is acquired', async () => {
    const client = makeClient(true)
    vi.mocked(pool.connect).mockResolvedValue(client as never)

    const release = await tryAcquireLongLivedLock(LOCK_KEYS.dailyDigest)

    expect(release).not.toBeNull()
    expect(client.release).not.toHaveBeenCalled() // client stays checked out until release() is called

    await release!()
    expect(client.query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [LOCK_KEYS.dailyDigest])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('returns null and releases the client when another instance already holds the lock', async () => {
    const client = makeClient(false)
    vi.mocked(pool.connect).mockResolvedValue(client as never)

    const release = await tryAcquireLongLivedLock(LOCK_KEYS.dailyDigest)

    expect(release).toBeNull()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('is safe to call release() more than once', async () => {
    const client = makeClient(true)
    vi.mocked(pool.connect).mockResolvedValue(client as never)

    const release = await tryAcquireLongLivedLock(LOCK_KEYS.dailyDigest)
    await release!()
    await release!()

    expect(client.release).toHaveBeenCalledOnce()
  })
})

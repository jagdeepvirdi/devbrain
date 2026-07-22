import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

import { captureSnapshot, pruneOldSnapshots, startEmbeddingHealthScheduler } from '../../services/embeddingHealthSnapshot.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('captureSnapshot', () => {
  it('counts documents by embedding_status and inserts one snapshot row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ pending: 2, processing: 1, done: 10, failed: 3 }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await captureSnapshot()

    expect(mockQuery.mock.calls[0][0]).toContain('FROM documents')
    expect(mockQuery.mock.calls[1]).toEqual([
      expect.stringContaining('INSERT INTO embedding_health_snapshots'),
      [2, 1, 10, 3],
    ])
  })
})

describe('pruneOldSnapshots', () => {
  it('deletes snapshots older than the 30-day retention window', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await pruneOldSnapshots()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM embedding_health_snapshots'),
      [30]
    )
  })
})

describe('startEmbeddingHealthScheduler', () => {
  it('captures a snapshot and prunes old ones once after the 30s startup delay', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValue({ rows: [{ pending: 0, processing: 0, done: 0, failed: 0 }] } as never)

    startEmbeddingHealthScheduler()
    await vi.advanceTimersByTimeAsync(30_000)

    // capture (SELECT + INSERT) + prune (DELETE) = 3 calls
    expect(mockQuery).toHaveBeenCalledTimes(3)
    expect(String(mockQuery.mock.calls[1][0])).toContain('INSERT INTO embedding_health_snapshots')
    expect(String(mockQuery.mock.calls[2][0])).toContain('DELETE FROM embedding_health_snapshots')
  })

  it('runs again every hour after the initial tick', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValue({ rows: [{ pending: 0, processing: 0, done: 0, failed: 0 }] } as never)

    startEmbeddingHealthScheduler()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mockQuery).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockQuery).toHaveBeenCalledTimes(6)
  })

  it('swallows a capture failure without throwing, skipping prune for that tick', async () => {
    vi.useFakeTimers()
    mockQuery.mockRejectedValueOnce(new Error('db not ready'))

    startEmbeddingHealthScheduler()
    await expect(vi.advanceTimersByTimeAsync(30_000)).resolves.not.toThrow()

    // Only the failed SELECT — pruneOldSnapshots never reached this tick.
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })
})

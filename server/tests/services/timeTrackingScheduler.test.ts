import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/advisoryLock.js', () => ({
  LOCK_KEYS: { timeImport: 727_006 },
  withAdvisoryLock: vi.fn(async (_key: number, fn: () => Promise<void>) => { await fn() }),
}))
vi.mock('../../services/timeTracking.js', () => ({
  importActivityWatch: vi.fn(), importSessions: vi.fn(), estimateGitHours: vi.fn(),
}))

import {
  runTimeImportTick, startTimeTrackingScheduler, resetTimeSchedulerState, SLOW_REFRESH_MS,
} from '../../services/timeTrackingScheduler.js'
import { withAdvisoryLock } from '../../lib/advisoryLock.js'
import { importActivityWatch, importSessions, estimateGitHours } from '../../services/timeTracking.js'

const mockAw   = vi.mocked(importActivityWatch)
const mockSess = vi.mocked(importSessions)
const mockGit  = vi.mocked(estimateGitHours)
const mockLock = vi.mocked(withAdvisoryLock)

// Local noon on Fri 2026-11-13 — far from midnight so day math is timezone-independent.
const NOW = new Date(2026, 10, 13, 12, 0).getTime()

beforeEach(() => {
  vi.resetAllMocks()
  resetTimeSchedulerState()
  mockAw.mockResolvedValue({ days: 1, entries: 1 })
  mockSess.mockResolvedValue([])
  mockGit.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('runTimeImportTick', () => {
  it('imports ActivityWatch for yesterday through today', async () => {
    await runTimeImportTick(NOW)
    expect(mockAw).toHaveBeenCalledWith('2026-11-12', '2026-11-13')
  })

  it('computes "yesterday" correctly across a month boundary', async () => {
    await runTimeImportTick(new Date(2026, 11, 1, 9, 0).getTime())
    expect(mockAw).toHaveBeenCalledWith('2026-11-30', '2026-12-01')
  })

  it('runs ActivityWatch before the git estimate (which skips days AW covers)', async () => {
    const order: string[] = []
    mockAw.mockImplementation(async () => { order.push('aw'); return { days: 0, entries: 0 } })
    mockSess.mockImplementation(async () => { order.push('sessions'); return [] })
    mockGit.mockImplementation(async () => { order.push('git'); return [] })
    await runTimeImportTick(NOW)
    expect(order).toEqual(['aw', 'sessions', 'git'])
  })

  it('throttles the slow sources: ActivityWatch every tick, sessions/git at most every 6h', async () => {
    await runTimeImportTick(NOW)
    await runTimeImportTick(NOW + 60 * 60 * 1000)                       // +1h
    await runTimeImportTick(NOW + SLOW_REFRESH_MS - 1)                  // just under 6h
    expect(mockAw).toHaveBeenCalledTimes(3)
    expect(mockSess).toHaveBeenCalledTimes(1)
    expect(mockGit).toHaveBeenCalledTimes(1)

    await runTimeImportTick(NOW + SLOW_REFRESH_MS)                      // exactly 6h
    expect(mockSess).toHaveBeenCalledTimes(2)
    expect(mockGit).toHaveBeenCalledTimes(2)
  })

  it('keeps going to sessions and git when ActivityWatch is not running', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockAw.mockRejectedValue(new Error('ActivityWatch not reachable at http://localhost:5600'))
    await runTimeImportTick(NOW)
    expect(mockSess).toHaveBeenCalled()
    expect(mockGit).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('logs an ActivityWatch failure once, not every hour, and again if the error changes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockAw.mockRejectedValue(new Error('not reachable'))
    await runTimeImportTick(NOW)
    await runTimeImportTick(NOW + 3_600_000)
    await runTimeImportTick(NOW + 7_200_000)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('not reachable')

    mockAw.mockRejectedValue(new Error('responded 500'))
    await runTimeImportTick(NOW + 10_800_000)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('logs again after ActivityWatch recovers and then fails anew', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockAw.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ days: 1, entries: 1 }).mockRejectedValueOnce(new Error('down'))
    await runTimeImportTick(NOW)
    await runTimeImportTick(NOW + 3_600_000)
    await runTimeImportTick(NOW + 7_200_000)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('reports per-project slow-source errors once (e.g. a linked folder that is not a git repo)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGit.mockResolvedValue([{ project: 'Outpost', error: 'not a git repository' }, { project: 'DevBrain', hours: 1 }])
    await runTimeImportTick(NOW)
    await runTimeImportTick(NOW + SLOW_REFRESH_MS)                      // same error again → silent
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('Outpost: not a git repository')
    expect(warn.mock.calls[0][0]).not.toContain('DevBrain')
    warn.mockRestore()
  })

  it('stays silent when there are no slow-source errors', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runTimeImportTick(NOW)
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('startTimeTrackingScheduler', () => {
  it('waits 90s, then ticks under the advisory lock and repeats hourly', async () => {
    vi.useFakeTimers()
    startTimeTrackingScheduler()
    expect(mockLock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(90_000)
    expect(mockLock).toHaveBeenCalledTimes(1)
    expect(mockLock.mock.calls[0][0]).toBe(727_006)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockLock).toHaveBeenCalledTimes(2)
  })

  it('swallows a tick that throws (e.g. the DB is down) instead of crashing the process', async () => {
    vi.useFakeTimers()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSess.mockRejectedValue(new Error('db down'))

    startTimeTrackingScheduler()
    await vi.advanceTimersByTimeAsync(90_000)

    expect(err).toHaveBeenCalledWith('[Time Tracking] tick failed:', 'db down')
    err.mockRestore()
  })
})

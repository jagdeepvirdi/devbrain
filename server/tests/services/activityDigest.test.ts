import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const envMock = vi.hoisted(() => ({ AI_PROVIDER: 'ollama' as string, OLLAMA_CHAT_MODEL: 'mistral' }))
vi.mock('../../lib/env.js', () => ({ env: envMock }))
vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/advisoryLock.js', () => ({
  LOCK_KEYS: { activityDigest: 727_005 },
  withAdvisoryLock: vi.fn(async (_key: number, fn: () => Promise<void>) => { await fn() }),
}))
vi.mock('../../services/notifier.js', () => ({ sendAppriseNotification: vi.fn() }))
vi.mock('../../services/gitDigest.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/gitDigest.js')>('../../services/gitDigest.js')
  return { ...actual, buildProjectDigest: vi.fn() }
})

import {
  generateDigests, formatDigestMessage, lastCompletedWeek, runWeeklyDigest,
  startActivityDigestScheduler, type DigestRow,
} from '../../services/activityDigest.js'
import { pool } from '../../db/pool.js'
import { withAdvisoryLock } from '../../lib/advisoryLock.js'
import { sendAppriseNotification } from '../../services/notifier.js'
import { buildProjectDigest } from '../../services/gitDigest.js'
import { LocalAIRequiredError } from '../../lib/requireLocalAI.js'

const mockQuery = vi.mocked(pool.query)
const mockBuild = vi.mocked(buildProjectDigest)
const mockSend = vi.mocked(sendAppriseNotification)
const mockLock = vi.mocked(withAdvisoryLock)

const DIGEST = {
  week_start: '2026-11-02', week_end: '2026-11-09', commit_count: 2, branches: ['main'],
  stats: { files_changed: 2, insertions: 3, deletions: 1 },
  summary: { highlights: [], features: [], fixes: [], risks: [], summary: 'Did things.' },
}

const row = (over: Partial<DigestRow> = {}): DigestRow => ({
  id: 'd1', project_id: 'p1', week_start: '2026-11-02', week_end: '2026-11-09', commit_count: 2,
  branches: ['main'], stats: DIGEST.stats, summary: DIGEST.summary, ...over,
})

beforeEach(() => { vi.resetAllMocks(); envMock.AI_PROVIDER = 'ollama' })
afterEach(() => { vi.useRealTimers() })

describe('lastCompletedWeek', () => {
  it('returns the Monday of the previous week', () => {
    expect(lastCompletedWeek(new Date('2026-11-13T10:00:00Z'))).toBe('2026-11-02') // Fri
    expect(lastCompletedWeek(new Date('2026-11-09T00:30:00Z'))).toBe('2026-11-02') // Monday itself
    expect(lastCompletedWeek(new Date('2026-11-15T23:59:00Z'))).toBe('2026-11-02') // Sunday
  })
})

describe('generateDigests', () => {
  it('only queries projects missing a digest when onlyMissing is set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await generateDigests('2026-11-04', { onlyMissing: true })
    expect(String(mockQuery.mock.calls[0][0])).toContain('NOT EXISTS')
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-11-02'])   // normalized to Monday
  })

  it('combines projectId and onlyMissing with correct placeholders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await generateDigests('2026-11-04', { projectId: 'p1', onlyMissing: true })
    const sql = String(mockQuery.mock.calls[0][0])
    expect(sql).toContain('id = $1')
    expect(sql).toContain('d.week_start = $2')
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', '2026-11-02'])
  })

  it('rejects an invalid week before touching the database', async () => {
    await expect(generateDigests('garbage', { onlyMissing: true })).rejects.toThrow('week must be')
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('pairs each generated row with its project name', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'DevBrain', fs_path: '/r' }] } as never)
      .mockResolvedValueOnce({ rows: [row()] } as never)
    mockBuild.mockResolvedValueOnce(DIGEST)
    const r = await generateDigests('2026-11-04')
    expect(r.generated).toEqual([{ project: 'DevBrain', row: row() }])
    expect(r.digests).toEqual([row()])
  })
})

describe('formatDigestMessage', () => {
  it('lists projects with commits, totals and a truncated summary', () => {
    const long = 'x'.repeat(500)
    const { title, body } = formatDigestMessage([
      { project: 'A', row: row({ summary: { ...DIGEST.summary, summary: long } }) },
      { project: 'B', row: row({ commit_count: 3 }) },
      { project: 'Idle', row: row({ commit_count: 0 }) },
    ])
    expect(title).toBe('Weekly git digest: 2026-11-02 to 2026-11-09')
    expect(body).toContain('5 commits across 2 project(s)')
    expect(body).toContain('• B: 3 commits (+3/-1) — Did things.')
    expect(body).not.toContain('Idle')
    expect(body.split('\n')[1]).toMatch(/…$/)
  })

  it('says so when no project had commits', () => {
    const { body } = formatDigestMessage([{ project: 'A', row: row({ commit_count: 0 }) }])
    expect(body).toBe('No commits in any linked project this week.')
  })

  it('omits the dash when a summary is empty', () => {
    const { body } = formatDigestMessage([
      { project: 'A', row: row({ summary: { ...DIGEST.summary, summary: '' } }) },
    ])
    expect(body).toContain('• A: 2 commits (+3/-1)')
    expect(body).not.toContain('—')
  })
})

describe('runWeeklyDigest', () => {
  const NOW = new Date('2026-11-13T10:00:00Z')

  it('does nothing (no queries, no model) when a cloud provider is configured', async () => {
    envMock.AI_PROVIDER = 'claude'
    await runWeeklyDigest(NOW)
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('generates missing digests for last week and notifies every active user once', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'DevBrain', fs_path: '/r' }] } as never) // missing projects
      .mockResolvedValueOnce({ rows: [row()] } as never)                                         // upsert
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] } as never)                    // active users
    mockBuild.mockResolvedValueOnce(DIGEST)

    await runWeeklyDigest(NOW)

    expect(mockBuild).toHaveBeenCalledWith('/r', '2026-11-02')
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend.mock.calls[0][0]).toMatchObject({ userId: 'u1', level: 'info', title: expect.stringContaining('2026-11-02') })
  })

  it('is a no-op (no notification) when every project already has a digest', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await runWeeklyDigest(NOW)
    expect(mockBuild).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('does not notify when generation failed for every project, and logs each error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'A', fs_path: '/gone' }] } as never)
    mockBuild.mockRejectedValueOnce(new Error('ENOENT'))
    await runWeeklyDigest(NOW)
    expect(mockSend).not.toHaveBeenCalled()
    expect(err).toHaveBeenCalledWith('[Activity Digest] A: ENOENT')
    err.mockRestore()
  })

  it('keeps notifying remaining users when one delivery throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'A', fs_path: '/r' }] } as never)
      .mockResolvedValueOnce({ rows: [row()] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'u1' }, { id: 'u2' }] } as never)
    mockBuild.mockResolvedValueOnce(DIGEST)
    mockSend.mockRejectedValueOnce(new Error('apprise down')).mockResolvedValueOnce([])

    await runWeeklyDigest(NOW)

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(err).toHaveBeenCalledWith('[Activity Digest] notify failed for user u1:', 'apprise down')
    err.mockRestore()
  })

  it('propagates the local-AI guard error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'A', fs_path: '/r' }] } as never)
    mockBuild.mockRejectedValueOnce(new LocalAIRequiredError('claude'))
    await expect(runWeeklyDigest(NOW)).rejects.toThrow('AI_PROVIDER=ollama')
  })
})

describe('startActivityDigestScheduler', () => {
  it('waits 60s, then ticks under the advisory lock and repeats hourly', async () => {
    vi.useFakeTimers()
    mockQuery.mockResolvedValue({ rows: [] } as never)

    startActivityDigestScheduler()
    expect(mockLock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(mockLock).toHaveBeenCalledTimes(1)
    expect(mockLock.mock.calls[0][0]).toBe(727_005)

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mockLock).toHaveBeenCalledTimes(2)
  })

  it('swallows a failing tick instead of crashing the process', async () => {
    vi.useFakeTimers()
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockQuery.mockRejectedValue(new Error('db down'))

    startActivityDigestScheduler()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(err).toHaveBeenCalledWith('[Activity Digest] tick failed:', 'db down')
    err.mockRestore()
  })
})

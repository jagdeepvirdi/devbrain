import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const client = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }))
vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }))
vi.mock('../../lib/env.js', () => ({ env: { ACTIVITYWATCH_URL: 'http://localhost:5600' } }))
vi.mock('../../services/session-reader.js', () => ({ readSessions: vi.fn() }))
vi.mock('../../services/activityWatch.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/activityWatch.js')>('../../services/activityWatch.js')
  return { ...actual, fetchAwData: vi.fn() }
})

import {
  replaceEntries, importActivityWatch, estimateGitHours, importSessions, getTimeReport,
} from '../../services/timeTracking.js'
import { pool } from '../../db/pool.js'
import { readSessions } from '../../services/session-reader.js'
import { fetchAwData } from '../../services/activityWatch.js'

const mockQuery    = vi.mocked(pool.query)
const mockConnect  = vi.mocked(pool.connect)
const mockSessions = vi.mocked(readSessions)
const mockFetchAw  = vi.mocked(fetchAwData)

beforeEach(() => {
  vi.resetAllMocks()
  client.query.mockResolvedValue({ rows: [] })
  mockConnect.mockResolvedValue(client as never)
})

const sqls = () => client.query.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' ').trim())
const iso = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()

describe('replaceEntries', () => {
  it('deletes then inserts inside one transaction (project scope)', async () => {
    await replaceEntries('git-estimate', [{ project_id: 'p1', day: '2026-11-10', seconds: 3600.4, detail: { a: 1 } }], { projectIds: ['p1'] })

    const s = sqls()
    expect(s[0]).toBe('BEGIN')
    expect(s[1]).toContain('DELETE FROM time_entries WHERE source = $1 AND project_id = ANY($2::text[])')
    expect(s[2]).toContain('INSERT INTO time_entries')
    expect(s[3]).toBe('COMMIT')
    expect(client.query.mock.calls[1][1]).toEqual(['git-estimate', ['p1']])
    // Seconds are rounded to integers; detail is serialized for jsonb.
    expect(client.query.mock.calls[2][1]).toEqual(['git-estimate', ['p1'], ['2026-11-10'], [3600], ['{"a":1}']])
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('uses a day-range delete for the ActivityWatch scope and allows null (Unassigned) projects', async () => {
    await replaceEntries('activitywatch', [{ project_id: null, day: '2026-11-10', seconds: 60 }], { from: '2026-11-04', to: '2026-11-10' })
    expect(sqls()[1]).toContain('day BETWEEN $2 AND $3')
    expect(client.query.mock.calls[1][1]).toEqual(['activitywatch', '2026-11-04', '2026-11-10'])
    expect(client.query.mock.calls[2][1]![1]).toEqual([null])
  })

  it('still clears the old rows when there is nothing new to insert', async () => {
    await replaceEntries('git-estimate', [], { projectIds: ['p1'] })
    expect(sqls().some(s => s.includes('INSERT'))).toBe(false)
    expect(sqls()).toContain('COMMIT')
  })

  it('rolls back, releases the client and rethrows when the insert fails', async () => {
    client.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes('INSERT')) throw new Error('boom')
      return { rows: [] }
    })
    await expect(replaceEntries('git-estimate', [{ project_id: 'p1', day: '2026-11-10', seconds: 60 }], { projectIds: ['p1'] }))
      .rejects.toThrow('boom')
    expect(sqls()).toContain('ROLLBACK')
    expect(sqls()).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(1)
  })
})

describe('importActivityWatch', () => {
  it('classifies events with the stored rules and replaces the range (idempotent re-import)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ project_id: 'p1', kind: 'app', pattern: 'Android Studio', priority: 0 }] } as never)
    mockFetchAw.mockResolvedValue({
      windowEvents: [{ timestamp: iso(10, 9), duration: 1800, data: { app: 'Android Studio', title: 't' } }],
      afkEvents: null, editorEvents: [],
    })

    const r = await importActivityWatch('2026-11-10', '2026-11-10')

    expect(r).toEqual({ days: 1, entries: 1 })
    const [fromIso, toIso] = mockFetchAw.mock.calls[0]
    expect(Date.parse(toIso as string) - Date.parse(fromIso as string)).toBeGreaterThanOrEqual(23 * 3_600_000)   // `to` is inclusive
    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT'))!
    expect(insert[1]).toEqual(['activitywatch', ['p1'], ['2026-11-10'], [1800], ['{"apps":{"Android Studio":1800}}']])
    expect(client.query.mock.calls.find(c => String(c[0]).includes('DELETE'))![1]).toEqual(['activitywatch', '2026-11-10', '2026-11-10'])
  })

  it('propagates "not reachable" and writes nothing', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    mockFetchAw.mockRejectedValue(new Error('ActivityWatch not reachable at http://localhost:5600'))
    await expect(importActivityWatch('2026-11-10', '2026-11-10')).rejects.toThrow('not reachable')
    expect(mockConnect).not.toHaveBeenCalled()
  })
})

// ── git estimate (real temp repo) ────────────────────────────────────────────

function mkRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'timetrack-'))
  const run = (args: string[], date?: string) => execFileSync('git', args, {
    cwd: dir, stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
           GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } as NodeJS.ProcessEnv,
  })
  run(['init', '-q', '-b', 'main'])
  let n = 0
  const commit = (when: string) => { writeFileSync(path.join(dir, `f${n++}`), 'x'); run(['add', '.']); run(['commit', '-q', '-m', 'c'], when) }
  // No Z suffix → git reads these as local time, matching the app's local-day bucketing.
  commit('2026-11-09T10:00:00')   // day A: two commits 1h apart → 1h + 30m credit = 1.5h
  commit('2026-11-09T11:00:00')
  commit('2026-11-10T14:00:00')   // day B: lone commit → 30m credit
  return dir
}
const repo = mkRepo()
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('estimateGitHours', () => {
  const project = { id: 'p1', name: 'DevBrain', fs_path: repo }

  it('clusters commits into sessions per day and replaces the project estimate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)               // no ActivityWatch days
      .mockResolvedValueOnce({ rows: [project] } as never)         // linked projects

    const [r] = await estimateGitHours()

    expect(r).toMatchObject({ project: 'DevBrain', commits: 3, days: 2, hours: 2 })
    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT'))!
    expect(insert[1]).toEqual(['git-estimate', ['p1', 'p1'], ['2026-11-09', '2026-11-10'], [5400, 1800], ['{}', '{}']])
  })

  it('never overwrites ActivityWatch days — those days are skipped', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ day: '2026-11-09' }] } as never)
      .mockResolvedValueOnce({ rows: [project] } as never)

    const [r] = await estimateGitHours()

    expect(r.days).toBe(1)
    const insert = client.query.mock.calls.find(c => String(c[0]).includes('INSERT'))!
    expect(insert[1]![2]).toEqual(['2026-11-10'])
  })

  it('honours a custom gap and credit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never).mockResolvedValueOnce({ rows: [project] } as never)
    // gap 0 → every commit its own session; credit 0 → worth nothing → no entries at all.
    const [r] = await estimateGitHours({ gapMs: 0, creditMs: 0 })
    expect(r.days).toBe(0)
    expect(sqls().some(s => s.includes('INSERT'))).toBe(false)
  })

  it('reports a failing project without aborting the others', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'p0', name: 'Gone', fs_path: path.join(repo, 'does-not-exist') }, project] } as never)

    const results = await estimateGitHours()

    expect(results[0]).toMatchObject({ project: 'Gone' })
    expect(results[0].error).toBeTruthy()
    expect(results[1]).toMatchObject({ project: 'DevBrain', days: 2 })
  })
})

describe('importSessions', () => {
  const project = { id: 'p1', name: 'DevBrain', fs_path: '/repo' }
  const sess = (started: string, ended?: string) => ({ started, ...(ended ? { ended } : {}) }) as never

  it('turns completed sessions into per-day seconds; skips active, inverted and unparsable ones', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [project] } as never)
    mockSessions.mockResolvedValue([
      sess(iso(10, 9), iso(10, 11)),     // 2h
      sess(iso(10, 14)),                  // never ended → skipped
      sess(iso(10, 16), iso(10, 15)),     // ended before start → skipped
      sess('garbage', iso(10, 15)),       // unparsable → skipped
    ])
    const [r] = await importSessions()
    expect(r).toMatchObject({ project: 'DevBrain', days: 1, hours: 2 })
    expect(client.query.mock.calls.find(c => String(c[0]).includes('INSERT'))![1]![3]).toEqual([7200])
  })

  it('caps a forgotten multi-day session at 12 hours', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [project] } as never)
    mockSessions.mockResolvedValue([sess(iso(10, 9), iso(14, 9))])
    const [r] = await importSessions()
    expect(r.hours).toBe(12)
  })

  it('reports a per-project error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [project] } as never)
    mockSessions.mockRejectedValue(new Error('EACCES'))
    expect((await importSessions())[0]).toEqual({ project: 'DevBrain', error: 'EACCES' })
  })
})

describe('getTimeReport', () => {
  it('picks one source per project-day by trust order and groups by the requested period', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ period: '2026-11-09', project_id: 'p1', seconds: 3600, sources: ['activitywatch'] }] } as never)
      .mockResolvedValueOnce({ rows: [{ source: 'activitywatch', seconds: 3600 }] } as never)

    const r = await getTimeReport({ from: '2026-11-01', to: '2026-11-30', group: 'week' })

    const sql = String(mockQuery.mock.calls[0][0]).replace(/\s+/g, ' ')
    expect(sql).toContain('DISTINCT ON (COALESCE(project_id')
    expect(sql).toContain("WHEN 'activitywatch' THEN 1 WHEN 'claude-session' THEN 2 ELSE 3")
    expect(sql).toContain("date_trunc('week', b.day)")
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-11-01', '2026-11-30'])
    expect(r.rows).toHaveLength(1)
    expect(r.by_source).toEqual([{ source: 'activitywatch', seconds: 3600 }])
  })

  it('filters both queries by project when given', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)
    await getTimeReport({ from: 'a', to: 'b', projectId: 'p9', group: 'day' })
    expect(mockQuery.mock.calls[0][1]).toEqual(['a', 'b', 'p9'])
    expect(String(mockQuery.mock.calls[0][0])).toContain('project_id = $3')
    expect(mockQuery.mock.calls[1][1]).toEqual(['a', 'b', 'p9'])
  })
})

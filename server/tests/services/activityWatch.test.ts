import { describe, it, expect, vi } from 'vitest'

vi.mock('../../lib/env.js', () => ({ env: { ACTIVITYWATCH_URL: 'http://localhost:5600/' } }))

import {
  eventsToSegments, activeIntervals, classify, computeAggregates, fetchAwData, awBaseUrl,
  type AwEvent, type Rule, type AwData,
} from '../../services/activityWatch.js'

// Local-time ISO strings keep day boundaries timezone-independent.
const iso = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).toISOString()
const ev = (day: number, h: number, m: number, minutes: number, data: Record<string, unknown>): AwEvent =>
  ({ timestamp: iso(day, h, m), duration: minutes * 60, data })

const rule = (project_id: string, kind: Rule['kind'], pattern: string, priority = 0): Rule => ({ project_id, kind, pattern, priority })

describe('eventsToSegments', () => {
  it('converts events and drops zero-duration and unparsable ones', () => {
    const segs = eventsToSegments([
      ev(10, 9, 0, 10, { app: 'Code.exe', title: 'x' }),
      { timestamp: iso(10, 9), duration: 0, data: {} },
      { timestamp: 'not a date', duration: 60, data: {} },
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0].end - segs[0].start).toBe(600_000)
    expect(segs[0]).toMatchObject({ app: 'Code.exe', title: 'x' })
  })
})

describe('activeIntervals', () => {
  it('returns null when there is no afk watcher (no filtering possible)', () => {
    expect(activeIntervals(null)).toBeNull()
  })
  it('keeps only not-afk time and merges touching heartbeats', () => {
    const iv = activeIntervals([
      ev(10, 9, 0, 30, { status: 'not-afk' }),
      ev(10, 9, 30, 30, { status: 'not-afk' }),   // adjacent → one stretch
      ev(10, 10, 0, 30, { status: 'afk' }),
    ])!
    expect(iv).toHaveLength(1)
    expect(iv[0].end - iv[0].start).toBe(3_600_000)
  })
})

describe('classify (rule priority)', () => {
  const seg = { start: 0, end: 1, app: 'Code.exe', title: 'index.ts - devbrain - Visual Studio Code', project: 'devbrain', file: 'D:/Project/devbrain/index.ts' }

  it('matches each rule kind', () => {
    expect(classify(seg, [rule('A', 'app', 'code.exe')])).toBe('A')                 // case-insensitive exact
    expect(classify(seg, [rule('A', 'app', 'code')])).toBeNull()                    // app is exact, not substring
    expect(classify(seg, [rule('B', 'title', 'visual studio')])).toBe('B')          // substring
    expect(classify(seg, [rule('C', 'editor_project', 'DevBrain')])).toBe('C')
    expect(classify(seg, [rule('D', 'path', 'project/devbrain')])).toBe('D')        // via file
    expect(classify({ ...seg, file: undefined }, [rule('D', 'path', 'devbrain')])).toBe('D')   // via title
  })

  it('higher priority wins regardless of order; ties go to the earlier rule', () => {
    expect(classify(seg, [rule('LOW', 'app', 'Code.exe', 1), rule('HIGH', 'title', 'devbrain', 10)])).toBe('HIGH')
    expect(classify(seg, [rule('FIRST', 'app', 'Code.exe', 5), rule('SECOND', 'title', 'devbrain', 5)])).toBe('FIRST')
  })

  it('returns null with no rules or no match, and never treats a pattern as a regex', () => {
    expect(classify(seg, [])).toBeNull()
    expect(classify(seg, [rule('X', 'title', '.*')])).toBeNull()
  })

  it('does not match when the field is missing', () => {
    expect(classify({ start: 0, end: 1 }, [rule('X', 'app', 'Code.exe')])).toBeNull()
  })
})

describe('computeAggregates', () => {
  const rules = [rule('DEV', 'editor_project', 'devbrain'), rule('PLAY', 'app', 'Android Studio'), rule('DEV', 'title', 'devbrain')]
  const totals = (aggs: ReturnType<typeof computeAggregates>) =>
    Object.fromEntries(aggs.map(a => [`${a.project_id ?? ''}:${a.day}`, a.seconds]))

  it('drops afk time: window events are clipped to not-afk intervals', () => {
    const data: AwData = {
      windowEvents: [ev(10, 9, 0, 60, { app: 'Android Studio', title: 'x' })],
      afkEvents: [ev(10, 9, 0, 20, { status: 'not-afk' }), ev(10, 9, 20, 30, { status: 'afk' }), ev(10, 9, 50, 10, { status: 'not-afk' })],
      editorEvents: [],
    }
    expect(totals(computeAggregates(data, rules))).toEqual({ 'PLAY:2026-11-10': 30 * 60 })
  })

  it('without an afk watcher all window time counts', () => {
    const data: AwData = { windowEvents: [ev(10, 9, 0, 60, { app: 'Android Studio' })], afkEvents: null, editorEvents: [] }
    expect(totals(computeAggregates(data, rules))).toEqual({ 'PLAY:2026-11-10': 3600 })
  })

  it('editor project claims its interval first, so window time is not double counted', () => {
    const data: AwData = {
      // The user was in Chrome for the hour (classified nowhere)...
      windowEvents: [ev(10, 9, 0, 60, { app: 'chrome.exe', title: 'docs' })],
      afkEvents: null,
      // ...but the VS Code watcher says 40 of those minutes were devbrain.
      editorEvents: [ev(10, 9, 10, 40, { project: 'devbrain', file: 'a.ts' })],
    }
    expect(totals(computeAggregates(data, rules))).toEqual({
      'DEV:2026-11-10': 40 * 60,
      ':2026-11-10': 20 * 60,       // remaining 20 min → Unassigned (project_id null)
    })
  })

  it('unclassified time lands in the Unassigned bucket (project_id null)', () => {
    const data: AwData = { windowEvents: [ev(10, 9, 0, 10, { app: 'spotify.exe', title: 'song' })], afkEvents: null, editorEvents: [] }
    expect(computeAggregates(data, rules)).toEqual([
      { project_id: null, day: '2026-11-10', seconds: 600, apps: { 'spotify.exe': 600 } },
    ])
  })

  it('ignores editor segments that map to no project (window time still counts them)', () => {
    const data: AwData = {
      windowEvents: [ev(10, 9, 0, 30, { app: 'Code.exe', title: 'other repo' })],
      afkEvents: null,
      editorEvents: [ev(10, 9, 0, 30, { project: 'some-other-repo' })],
    }
    expect(totals(computeAggregates(data, rules))).toEqual({ ':2026-11-10': 1800 })
  })

  it('splits activity across midnight into two days', () => {
    const data: AwData = { windowEvents: [ev(10, 23, 30, 60, { app: 'Android Studio' })], afkEvents: null, editorEvents: [] }
    expect(totals(computeAggregates(data, rules))).toEqual({ 'PLAY:2026-11-10': 30 * 60, 'PLAY:2026-11-11': 30 * 60 })
  })

  it('keeps only the top 5 apps per bucket and never stores window titles', () => {
    const windowEvents = Array.from({ length: 7 }, (_, i) => ev(10, 9 + i, 0, 10 + i, { app: `app${i}.exe`, title: 'SECRET TITLE' }))
    const [agg] = computeAggregates({ windowEvents, afkEvents: null, editorEvents: [] }, [])
    expect(Object.keys(agg.apps)).toHaveLength(5)
    expect(JSON.stringify(agg)).not.toContain('SECRET TITLE')
    expect(Object.keys(agg.apps)[0]).toBe('app6.exe')   // largest first
  })

  it('returns nothing for no events', () => {
    expect(computeAggregates({ windowEvents: [], afkEvents: [], editorEvents: [] }, rules)).toEqual([])
  })
})

describe('fetchAwData (mocked REST API)', () => {
  const buckets = {
    'aw-watcher-window_pc': { type: 'currentwindow' },
    'aw-watcher-afk_pc':    { type: 'afkstatus' },
    'aw-watcher-vscode_pc': { type: 'app.editor.activity' },
    'aw-watcher-web_pc':    { type: 'web.tab.current' },
  }
  const json = (body: unknown, ok = true, status = 200) => ({ ok, status, json: async () => body }) as Response

  it('strips the trailing slash from the configured base URL', () => {
    expect(awBaseUrl()).toBe('http://localhost:5600')
  })

  it('loads events from window, afk and editor buckets only', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.endsWith('/api/0/buckets/')) return json(buckets)
      return json([{ timestamp: iso(10, 9), duration: 60, data: { from: url } }])
    })
    const d = await fetchAwData('2026-11-10T00:00:00Z', '2026-11-11T00:00:00Z', f as unknown as typeof fetch)
    expect(d.windowEvents).toHaveLength(1)
    expect(d.afkEvents).toHaveLength(1)
    expect(d.editorEvents).toHaveLength(1)
    const urls = f.mock.calls.map(c => c[0] as string)
    expect(urls.some(u => u.includes('aw-watcher-web_pc'))).toBe(false)   // browser watcher is Step 4's business
    expect(urls.find(u => u.includes('aw-watcher-window_pc'))).toContain('limit=-1')
  })

  it('reports afkEvents as null when there is no afk watcher', async () => {
    const f = vi.fn(async (url: string) => url.endsWith('/buckets/') ? json({ w: { type: 'currentwindow' } }) : json([]))
    const d = await fetchAwData('a', 'b', f as unknown as typeof fetch)
    expect(d.afkEvents).toBeNull()
  })

  it('throws a clear "not reachable" error when ActivityWatch is down', async () => {
    const f = vi.fn(async () => { throw new Error('ECONNREFUSED') })
    await expect(fetchAwData('a', 'b', f as unknown as typeof fetch)).rejects.toThrow('ActivityWatch not reachable at http://localhost:5600')
  })

  it('throws on a non-OK events response', async () => {
    const f = vi.fn(async (url: string) => url.endsWith('/buckets/') ? json({ w: { type: 'currentwindow' } }) : json({}, false, 500))
    await expect(fetchAwData('a', 'b', f as unknown as typeof fetch)).rejects.toThrow('responded 500')
  })
})

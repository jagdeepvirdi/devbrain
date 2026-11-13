import { describe, it, expect } from 'vitest'
import {
  mergeIntervals, intersect, subtract, splitByDay, sumByDay, clusterCommitTimes,
  localDay, dayStart, DEFAULT_GAP_MS, DEFAULT_CREDIT_MS,
} from '../../lib/timeMath.js'

// Local-time constructors so the tests don't depend on the machine's timezone.
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime()
const H = 3_600_000, MIN = 60_000

describe('localDay / dayStart', () => {
  it('round-trips a local calendar date', () => {
    expect(localDay(at(10, 23, 59))).toBe('2026-11-10')
    expect(localDay(dayStart('2026-11-10'))).toBe('2026-11-10')
    expect(dayStart('2026-11-11') - dayStart('2026-11-10')).toBeGreaterThanOrEqual(23 * H)
  })
})

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals, sorts, drops empty ones', () => {
    expect(mergeIntervals([
      { start: 10, end: 20 }, { start: 0, end: 5 }, { start: 5, end: 8 }, { start: 15, end: 30 }, { start: 40, end: 40 },
    ])).toEqual([{ start: 0, end: 8 }, { start: 10, end: 30 }])
  })
  it('bridges gaps up to gapMs', () => {
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 12, end: 20 }], 2)).toEqual([{ start: 0, end: 20 }])
    expect(mergeIntervals([{ start: 0, end: 10 }, { start: 13, end: 20 }], 2)).toHaveLength(2)
  })
  it('does not mutate its input', () => {
    const input = [{ start: 5, end: 10 }, { start: 0, end: 6 }]
    mergeIntervals(input)
    expect(input).toEqual([{ start: 5, end: 10 }, { start: 0, end: 6 }])
  })
})

describe('intersect / subtract', () => {
  const a = [{ start: 0, end: 10 }, { start: 20, end: 30 }]
  it('intersects across multiple intervals', () => {
    expect(intersect(a, [{ start: 5, end: 25 }])).toEqual([{ start: 5, end: 10 }, { start: 20, end: 25 }])
    expect(intersect(a, [{ start: 11, end: 19 }])).toEqual([])
  })
  it('subtracts a middle chunk, an edge, and everything', () => {
    expect(subtract([{ start: 0, end: 10 }], [{ start: 3, end: 5 }])).toEqual([{ start: 0, end: 3 }, { start: 5, end: 10 }])
    expect(subtract([{ start: 0, end: 10 }], [{ start: -5, end: 4 }])).toEqual([{ start: 4, end: 10 }])
    expect(subtract([{ start: 0, end: 10 }], [{ start: -1, end: 11 }])).toEqual([])
    expect(subtract(a, [])).toEqual(a)
  })
  it('handles several cuts inside one interval', () => {
    expect(subtract([{ start: 0, end: 20 }], [{ start: 2, end: 4 }, { start: 8, end: 10 }]))
      .toEqual([{ start: 0, end: 2 }, { start: 4, end: 8 }, { start: 10, end: 20 }])
  })
})

describe('splitByDay / sumByDay', () => {
  it('keeps a same-day interval whole', () => {
    expect([...splitByDay({ start: at(10, 9), end: at(10, 11) })]).toEqual([['2026-11-10', 2 * 3600]])
  })
  it('splits an interval crossing local midnight', () => {
    const m = splitByDay({ start: at(10, 23), end: at(11, 1) })
    expect(m.get('2026-11-10')).toBeCloseTo(3600, 0)
    expect(m.get('2026-11-11')).toBeCloseTo(3600, 0)
  })
  it('splits across several days', () => {
    const m = splitByDay({ start: at(10, 12), end: at(12, 12) })
    expect([...m.keys()]).toEqual(['2026-11-10', '2026-11-11', '2026-11-12'])
  })
  it('sums multiple intervals per day', () => {
    const m = sumByDay([{ start: at(10, 9), end: at(10, 10) }, { start: at(10, 14), end: at(10, 15) }])
    expect(m.get('2026-11-10')).toBe(2 * 3600)
  })
})

describe('clusterCommitTimes (git-hours heuristic)', () => {
  it('defaults match the documented constants', () => {
    expect(DEFAULT_GAP_MS).toBe(2 * H)
    expect(DEFAULT_CREDIT_MS).toBe(30 * MIN)
  })

  it('returns nothing for no commits', () => {
    expect(clusterCommitTimes([])).toEqual([])
  })

  it('credits a lone commit with the first-commit allowance', () => {
    const t = at(10, 12)
    expect(clusterCommitTimes([t])).toEqual([{ start: t - 30 * MIN, end: t }])
  })

  it('keeps commits <= 2h apart in one session (length = last - first + credit)', () => {
    const [s, ...rest] = clusterCommitTimes([at(10, 9), at(10, 10, 30), at(10, 12, 30)])
    expect(rest).toHaveLength(0)
    expect((s.end - s.start) / MIN).toBe(3 * 60 + 30 + 30)   // 9:00→12:30 (3h30) plus the 30 min credit
  })

  it('splits on a gap over 2h, and a gap of exactly 2h stays together', () => {
    expect(clusterCommitTimes([at(10, 9), at(10, 12, 1)])).toHaveLength(2)
    expect(clusterCommitTimes([at(10, 9), at(10, 11)])).toHaveLength(1)
  })

  it('sorts unordered input and honours custom gap/credit', () => {
    const out = clusterCommitTimes([at(10, 12), at(10, 9)], { gapMs: 4 * H, creditMs: 0 })
    expect(out).toEqual([{ start: at(10, 9), end: at(10, 12) }])
  })

  it('a session starting before midnight credits both days', () => {
    const days = sumByDay(clusterCommitTimes([at(10, 23, 50), at(11, 0, 10)]))
    expect(days.get('2026-11-10')! + days.get('2026-11-11')!).toBeCloseTo(50 * 60, 0)   // 20 min + 30 credit
  })
})

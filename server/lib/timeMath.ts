// Pure interval / day math for Phase 46 Step 3 time tracking. No I/O, no DB.
// All timestamps are epoch milliseconds; "days" are LOCAL calendar dates (YYYY-MM-DD), since
// "which day did I work" is a wall-clock question for the person, not a UTC one.

export interface Interval { start: number; end: number }

export const DEFAULT_GAP_MS    = 2 * 60 * 60 * 1000   // commits closer than this = same session
export const DEFAULT_CREDIT_MS = 30 * 60 * 1000       // credit for the work before a session's first commit

export function localDay(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Local midnight at the start of YYYY-MM-DD (as epoch ms). */
export function dayStart(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function nextLocalMidnight(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Sort and merge overlapping intervals (and ones separated by <= gapMs). Drops empty/inverted ones. */
export function mergeIntervals(intervals: Interval[], gapMs = 0): Interval[] {
  const sorted = intervals.filter(i => i.end > i.start).map(i => ({ ...i })).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const cur of sorted) {
    const last = out[out.length - 1]
    if (last && cur.start <= last.end + gapMs) last.end = Math.max(last.end, cur.end)
    else out.push(cur)
  }
  return out
}

/** Intersection of two interval sets. */
export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a), B = mergeIntervals(b)
  const out: Interval[] = []
  let i = 0, j = 0
  while (i < A.length && j < B.length) {
    const start = Math.max(A[i].start, B[j].start)
    const end   = Math.min(A[i].end, B[j].end)
    if (end > start) out.push({ start, end })
    if (A[i].end < B[j].end) i++; else j++
  }
  return out
}

/** `a` minus `b`. */
export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const cut = mergeIntervals(b)
  const out: Interval[] = []
  for (const iv of mergeIntervals(a)) {
    let start = iv.start
    for (const c of cut) {
      if (c.end <= start) continue
      if (c.start >= iv.end) break
      if (c.start > start) out.push({ start, end: c.start })
      start = Math.max(start, c.end)
    }
    if (start < iv.end) out.push({ start, end: iv.end })
  }
  return out
}

/** Seconds per local day for one interval; an interval crossing midnight is split. */
export function splitByDay(iv: Interval): Map<string, number> {
  const out = new Map<string, number>()
  let cursor = iv.start
  while (cursor < iv.end) {
    const boundary = Math.min(nextLocalMidnight(cursor), iv.end)
    const day = localDay(cursor)
    out.set(day, (out.get(day) ?? 0) + (boundary - cursor) / 1000)
    cursor = boundary
  }
  return out
}

export function sumByDay(intervals: Interval[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const iv of intervals) for (const [day, s] of splitByDay(iv)) out.set(day, (out.get(day) ?? 0) + s)
  return out
}

/**
 * git-hours heuristic: sort commit times; a gap <= gapMs keeps the same session; a session
 * runs from (first commit - creditMs) to its last commit, so a lone commit is worth creditMs
 * and a session's length is (last - first + creditMs).
 */
export function clusterCommitTimes(
  timesMs: number[],
  { gapMs = DEFAULT_GAP_MS, creditMs = DEFAULT_CREDIT_MS }: { gapMs?: number; creditMs?: number } = {},
): Interval[] {
  const times = [...timesMs].sort((a, b) => a - b)
  const out: Interval[] = []
  let first = 0, prev = 0
  times.forEach((t, i) => {
    if (i === 0) { first = prev = t; return }
    if (t - prev > gapMs) { out.push({ start: first - creditMs, end: prev }); first = t }
    prev = t
  })
  if (times.length) out.push({ start: first - creditMs, end: prev })
  return out
}

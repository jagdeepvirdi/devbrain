import { env } from '../lib/env.js'
import {
  type Interval, mergeIntervals, intersect, subtract, splitByDay,
} from '../lib/timeMath.js'

// ActivityWatch import (Phase 46 Step 3) — reads the LOCAL REST API only (ACTIVITYWATCH_URL,
// default http://localhost:5600). Pure classification logic lives here too so it's testable
// without a running ActivityWatch. No AI is involved, so the requireLocalAI guard isn't needed;
// window titles are never persisted (only per-app seconds), see `detail` below.

export type RuleKind = 'path' | 'title' | 'app' | 'editor_project'
export interface Rule { id?: string; project_id: string; kind: RuleKind; pattern: string; priority: number }

export interface AwEvent { timestamp: string; duration: number; data: Record<string, unknown> }

export interface Segment extends Interval { app?: string; title?: string; project?: string; file?: string }

export interface AwData { windowEvents: AwEvent[]; afkEvents: AwEvent[] | null; editorEvents: AwEvent[] }

export interface DayAggregate { project_id: string | null; day: string; seconds: number; apps: Record<string, number> }

// ── Events → segments ────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

export function eventsToSegments(events: AwEvent[]): Segment[] {
  const out: Segment[] = []
  for (const e of events) {
    const start = Date.parse(e.timestamp)
    if (!Number.isFinite(start) || !(e.duration > 0)) continue
    out.push({
      start, end: start + e.duration * 1000,
      app: str(e.data?.app), title: str(e.data?.title),
      project: str(e.data?.project), file: str(e.data?.file),
    })
  }
  return out
}

/** Intervals where the user was present. null afk data (no afk watcher) = no filtering. */
export function activeIntervals(afkEvents: AwEvent[] | null): Interval[] | null {
  if (!afkEvents) return null
  const active = eventsToSegments(afkEvents.filter(e => e.data?.status === 'not-afk'))
  // Adjacent not-afk events (heartbeat boundaries) are one continuous stretch of presence.
  return mergeIntervals(active, 1000)
}

// ── Classification ───────────────────────────────────────────────────────────

const eq  = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase() === b.toLowerCase()
const has = (a: string | undefined, b: string) => a !== undefined && a.toLowerCase().includes(b.toLowerCase())

function matches(seg: Segment, r: Rule): boolean {
  switch (r.kind) {
    case 'app':            return eq(seg.app, r.pattern)
    case 'editor_project': return eq(seg.project, r.pattern)
    case 'title':          return has(seg.title, r.pattern)
    // A path can appear in the editor's file field or, for terminals/IDEs, in the window title.
    case 'path':           return has(seg.file, r.pattern) || has(seg.title, r.pattern)
  }
}

/** Highest priority wins; ties go to the earlier rule. Plain substring matching — no user regex. */
export function classify(seg: Segment, rules: Rule[]): string | null {
  const ordered = rules.map((r, i) => ({ r, i })).sort((a, b) => b.r.priority - a.r.priority || a.i - b.i)
  for (const { r } of ordered) if (matches(seg, r)) return r.project_id
  return null
}

// ── Timeline → per-project/day aggregates ────────────────────────────────────

const TOP_APPS = 5

/**
 * 1. Drop afk time (clip everything to not-afk intervals).
 * 2. Editor-watcher segments are the most reliable signal: those that map to a project claim
 *    their time interval for that project first.
 * 3. Window segments cover what the editors didn't claim, classified by the rules; anything
 *    no rule matches goes to the Unassigned bucket (project_id null).
 */
export function computeAggregates(data: AwData, rules: Rule[]): DayAggregate[] {
  const active = activeIntervals(data.afkEvents)
  const clip = (iv: Interval[]) => (active ? intersect(iv, active) : mergeIntervals(iv))

  const acc = new Map<string, DayAggregate>()
  const add = (project: string | null, iv: Interval, app?: string) => {
    for (const [day, seconds] of splitByDay(iv)) {
      const key = `${project ?? ''}\u0000${day}`
      const cur = acc.get(key) ?? { project_id: project, day, seconds: 0, apps: {} }
      cur.seconds += seconds
      if (app) cur.apps[app] = (cur.apps[app] ?? 0) + seconds
      acc.set(key, cur)
    }
  }

  // Step 2 — editor claims.
  const claimedByProject = new Map<string, Interval[]>()
  for (const seg of eventsToSegments(data.editorEvents)) {
    const pid = classify(seg, rules)
    if (!pid) continue
    claimedByProject.set(pid, [...(claimedByProject.get(pid) ?? []), seg])
  }
  const allClaimed: Interval[] = []
  for (const [pid, ivs] of claimedByProject) {
    for (const iv of clip(ivs)) { add(pid, iv, 'editor'); allClaimed.push(iv) }
  }

  // Step 3 — window time not already claimed.
  for (const seg of eventsToSegments(data.windowEvents)) {
    const pid = classify(seg, rules)
    for (const iv of subtract(clip([seg]), allClaimed)) add(pid, iv, seg.app)
  }

  return [...acc.values()].map(a => ({
    ...a,
    seconds: Math.round(a.seconds),
    apps: Object.fromEntries(
      Object.entries(a.apps).sort((x, y) => y[1] - x[1]).slice(0, TOP_APPS).map(([k, v]) => [k, Math.round(v)]),
    ),
  })).filter(a => a.seconds > 0)
}

// ── REST client ──────────────────────────────────────────────────────────────

const BUCKET_TYPES = { window: 'currentwindow', afk: 'afkstatus', editor: 'app.editor.activity' } as const

export function awBaseUrl(): string {
  return (env.ACTIVITYWATCH_URL || 'http://localhost:5600').replace(/\/+$/, '')
}

async function getJson<T>(url: string, fetchImpl: typeof fetch): Promise<T> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) throw new Error(`ActivityWatch responded ${res.status} for ${new URL(url).pathname}`)
  return await res.json() as T
}

/** Fetch window/afk/editor events in [fromIso, toIso). Throws a clear error if AW isn't running. */
export async function fetchAwData(fromIso: string, toIso: string, fetchImpl: typeof fetch = fetch): Promise<AwData> {
  const base = awBaseUrl()
  let buckets: Record<string, { type: string }>
  try {
    buckets = await getJson(`${base}/api/0/buckets/`, fetchImpl)
  } catch (err) {
    throw new Error(`ActivityWatch not reachable at ${base} (${(err as Error).message})`)
  }

  const idsOf = (type: string) => Object.entries(buckets).filter(([, b]) => b.type === type).map(([id]) => id)
  const load = async (ids: string[]) => {
    const all: AwEvent[] = []
    for (const id of ids) {
      const qs = new URLSearchParams({ start: fromIso, end: toIso, limit: '-1' })
      all.push(...await getJson<AwEvent[]>(`${base}/api/0/buckets/${encodeURIComponent(id)}/events?${qs}`, fetchImpl))
    }
    return all
  }

  const afkIds = idsOf(BUCKET_TYPES.afk)
  return {
    windowEvents: await load(idsOf(BUCKET_TYPES.window)),
    afkEvents:    afkIds.length ? await load(afkIds) : null,   // no afk watcher → can't filter
    editorEvents: await load(idsOf(BUCKET_TYPES.editor)),
  }
}

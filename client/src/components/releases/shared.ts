// Shared across every Releases sub-component — split out of the former
// monolithic pages/Releases.tsx (TASKS.md tech-debt audit, 2026-08-17).

export const TYPE_STYLE: Record<string, { dot: string; bg: string; text: string; border: string }> = {
  major:  { dot: '#EF4444', bg: 'rgba(239,68,68,.12)',   text: '#EF4444', border: 'rgba(239,68,68,.3)' },
  minor:  { dot: '#6366F1', bg: 'rgba(99,102,241,.12)',  text: '#818CF8', border: 'rgba(99,102,241,.3)' },
  patch:  { dot: '#22C55E', bg: 'rgba(34,197,94,.12)',   text: '#22C55E', border: 'rgba(34,197,94,.3)' },
  hotfix: { dot: '#F59E0B', bg: 'rgba(245,158,11,.12)',  text: '#F59E0B', border: 'rgba(245,158,11,.3)' },
}

export function typeStyle(t: string) { return TYPE_STYLE[t] ?? TYPE_STYLE.patch }

export function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function today() { return new Date().toISOString().split('T')[0] }

// Label for a linked-issue badge — the issue's title (which carries the Case ID as
// its leading token for bulk-imported NT Billing issues, e.g. "CASE-1234 — ...")
// when resolved, falling back to a truncated id for releases where the join hasn't
// run yet (just-created/just-edited releases — see linked_issue_details in api.ts).
export function issueLabel(id: string, details?: { id: string; title: string }[]) {
  return details?.find(d => d.id === id)?.title ?? `#${id.slice(0, 8)}`
}

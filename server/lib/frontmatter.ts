// gray-matter's YAML parser auto-parses an unquoted ISO timestamp (the format
// every TASKS.md/SESSION.md template and hook writes, e.g.
// `last_updated: 2025-05-17T10:30:00`) into a JS Date — plain String(date)
// would give a locale string like "Fri May 17 2025 ...", not an ISO date,
// which breaks any consumer that treats the value as one (e.g.
// TasksTab.tsx's `.slice(0, 10)` date display).
export function frontmatterString(value: unknown): string | undefined {
  if (value == null) return undefined
  return value instanceof Date ? value.toISOString() : String(value)
}

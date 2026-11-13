// Week math (UTC, Monday-based) — mirrors server/services/gitDigest.ts's weekBounds().

const DAY_MS = 86_400_000

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

export function mondayOf(day: string): string {
  const offset = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(day, -offset)
}

export function shiftWeek(week: string, weeks: number): string {
  return addDays(week, weeks * 7)
}

/** The most recently completed week — what the server's weekly scheduler generates. */
export function lastCompletedWeek(now: Date = new Date()): string {
  return mondayOf(new Date(now.getTime() - 7 * DAY_MS).toISOString().slice(0, 10))
}

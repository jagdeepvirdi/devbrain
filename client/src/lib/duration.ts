/** 5400 -> "1h 30m", 1800 -> "30m", 3600 -> "1h", 0 -> "0m". Rounds to the nearest minute. */
export function fmtDuration(seconds: number): string {
  const totalMin = Math.round(seconds / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

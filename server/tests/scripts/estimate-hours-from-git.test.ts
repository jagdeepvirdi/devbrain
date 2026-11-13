import { describe, it, expect, vi } from 'vitest'

// Importing the script must not connect to a database or run main() (the entry-point guard).
vi.mock('../../db/pool.js', () => ({ pool: { end: vi.fn() } }))
vi.mock('../../services/timeTracking.js', () => ({ estimateGitHours: vi.fn() }))

import { parseArgs } from '../../scripts/estimate-hours-from-git.js'

describe('estimate-hours-from-git parseArgs', () => {
  it('returns defaults (undefined) with no arguments', () => {
    expect(parseArgs([])).toEqual({})
  })
  it('parses both flags', () => {
    expect(parseArgs(['--gap-hours', '3', '--credit-minutes', '15'])).toEqual({ gapHours: 3, creditMinutes: 15 })
  })
  it('accepts zero credit', () => {
    expect(parseArgs(['--credit-minutes', '0'])).toEqual({ creditMinutes: 0 })
  })
  it('rejects unknown flags, missing values, negatives and non-numbers', () => {
    expect(parseArgs(['--nope']).error).toContain('Unknown argument')
    expect(parseArgs(['--gap-hours']).error).toContain('non-negative number')
    expect(parseArgs(['--gap-hours', '-1']).error).toContain('non-negative number')
    expect(parseArgs(['--credit-minutes', 'abc']).error).toContain('non-negative number')
  })
})

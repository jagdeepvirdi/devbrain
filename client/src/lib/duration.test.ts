import { describe, it, expect } from 'vitest'
import { fmtDuration } from './duration'

describe('fmtDuration', () => {
  it.each([
    [0, '0m'], [29, '0m'], [30, '1m'], [1800, '30m'], [3600, '1h'], [5400, '1h 30m'], [3600 * 12 + 60, '12h 1m'],
  ])('%i seconds -> %s', (seconds, expected) => {
    expect(fmtDuration(seconds)).toBe(expected)
  })
})

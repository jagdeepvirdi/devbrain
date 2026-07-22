import { describe, it, expect } from 'vitest'
import { frontmatterString } from '../../lib/frontmatter.js'

describe('frontmatterString', () => {
  it('returns undefined for null/undefined', () => {
    expect(frontmatterString(null)).toBeUndefined()
    expect(frontmatterString(undefined)).toBeUndefined()
  })

  it('normalizes a Date (as produced by YAML auto-parsing an unquoted timestamp) to a real ISO string', () => {
    expect(frontmatterString(new Date('2026-01-01T10:30:00Z'))).toBe('2026-01-01T10:30:00.000Z')
  })

  it('passes an already-string value through unchanged', () => {
    expect(frontmatterString('not-a-real-date')).toBe('not-a-real-date')
  })

  it('stringifies other non-nullish types', () => {
    expect(frontmatterString(42)).toBe('42')
  })
})

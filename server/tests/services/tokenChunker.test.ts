import { describe, it, expect } from 'vitest'
import { countTokens, splitByTokenWindow, TARGET_CHUNK_TOKENS, OVERLAP_TOKENS } from '../../services/tokenChunker.js'

describe('countTokens', () => {
  it('counts tokens for a simple string', () => {
    expect(countTokens('hello world')).toBeGreaterThan(0)
  })
})

describe('splitByTokenWindow', () => {
  it('returns a single chunk for short text', () => {
    const chunks = splitByTokenWindow('hello world')
    expect(chunks).toEqual(['hello world'])
  })

  it('splits long text into overlapping windows', () => {
    const text = Array.from({ length: TARGET_CHUNK_TOKENS * 3 }, (_, i) => `word${i}`).join(' ')
    const chunks = splitByTokenWindow(text)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(countTokens(chunk)).toBeLessThanOrEqual(TARGET_CHUNK_TOKENS)
    }
  })

  it('drops a window that decodes to whitespace only', () => {
    // A pure-whitespace window decodes+trims to an empty string, which must
    // not be pushed as a chunk (only overlap padding, no real content).
    const chunks = splitByTokenWindow(' '.repeat(OVERLAP_TOKENS + 5))
    expect(chunks.every(c => c.length > 0)).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(splitByTokenWindow('')).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { normalizeLines, lineSimilarity } from '../../services/duplicateDetector.js'

describe('normalizeLines', () => {
  it('trims each line and drops blank lines', () => {
    expect(normalizeLines('  foo  \n\n  bar\n   \nbaz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('returns an empty array for empty or whitespace-only content', () => {
    expect(normalizeLines('')).toEqual([])
    expect(normalizeLines('   \n  \n')).toEqual([])
  })
})

describe('lineSimilarity', () => {
  it('returns 1 for identical content', () => {
    const content = 'function foo() {\n  return 1\n}'
    expect(lineSimilarity(content, content)).toBe(1)
  })

  it('returns 1 for two files identical after trimming whitespace differences', () => {
    const a = 'function foo() {\n  return 1\n}'
    const b = 'function foo() {\n    return 1\n}' // different indentation only
    expect(lineSimilarity(a, b)).toBe(1)
  })

  it('returns 0 for completely disjoint content', () => {
    const a = 'alpha\nbeta\ngamma'
    const b = 'one\ntwo\nthree'
    expect(lineSimilarity(a, b)).toBe(0)
  })

  it('scores a near-duplicate (one changed line out of many) close to 1', () => {
    const a = ['function greet(name) {', '  console.log("Hello " + name)', '  return true', '}'].join('\n')
    const b = ['function greet(name) {', '  console.log("Hi " + name)', '  return true', '}'].join('\n')
    // 3 of 4 lines shared each side -> 2*3 / (4+4) = 0.75
    expect(lineSimilarity(a, b)).toBeCloseTo(0.75, 5)
  })

  it('is symmetric', () => {
    const a = 'one\ntwo\nthree'
    const b = 'one\ntwo\nfour'
    expect(lineSimilarity(a, b)).toBe(lineSimilarity(b, a))
  })

  it('is multiset-aware — a line repeated more times on one side only partially counts', () => {
    const a = 'x\nx\nx' // three copies of "x"
    const b = 'x'       // one copy of "x"
    // shared = min(3,1) = 1 -> 2*1 / (3+1) = 0.5
    expect(lineSimilarity(a, b)).toBeCloseTo(0.5, 5)
  })

  it('returns 1 when both contents are empty', () => {
    expect(lineSimilarity('', '')).toBe(1)
  })

  it('returns 0 when exactly one content is empty', () => {
    expect(lineSimilarity('some code', '')).toBe(0)
    expect(lineSimilarity('', 'some code')).toBe(0)
  })

  it('is insensitive to line reordering', () => {
    const a = 'one\ntwo\nthree'
    const b = 'three\none\ntwo'
    expect(lineSimilarity(a, b)).toBe(1)
  })
})

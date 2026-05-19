import { describe, it, expect } from 'vitest'
import { buildSetClause, buildWhereClause } from '../../lib/db.js'

describe('buildSetClause', () => {
  it('generates SET clause starting at $2', () => {
    const { setClauses, params } = buildSetClause(['title', 'tags'], ['My Doc', ['a', 'b']])
    expect(setClauses).toBe('title = $2, tags = $3')
    expect(params).toEqual(['My Doc', ['a', 'b']])
  })

  it('handles a single column', () => {
    const { setClauses, params } = buildSetClause(['status'], ['open'])
    expect(setClauses).toBe('status = $2')
    expect(params).toEqual(['open'])
  })

  it('preserves order of columns and values', () => {
    const cols = ['a', 'b', 'c']
    const vals = [1, 2, 3]
    const { setClauses, params } = buildSetClause(cols, vals)
    expect(setClauses).toBe('a = $2, b = $3, c = $4')
    expect(params).toEqual([1, 2, 3])
  })

  it('returns empty string for empty columns', () => {
    const { setClauses, params } = buildSetClause([], [])
    expect(setClauses).toBe('')
    expect(params).toEqual([])
  })
})

describe('buildWhereClause', () => {
  it('returns empty where for empty filters', () => {
    const { where, params, next } = buildWhereClause({})
    expect(where).toBe('')
    expect(params).toEqual([])
    expect(next).toBe(1)
  })

  it('builds a single condition', () => {
    const { where, params, next } = buildWhereClause({ project_id: 'abc' })
    expect(where).toBe('WHERE project_id = $1')
    expect(params).toEqual(['abc'])
    expect(next).toBe(2)
  })

  it('builds multiple AND conditions', () => {
    const { where, params, next } = buildWhereClause({ status: 'open', priority: 'high' })
    expect(where).toBe('WHERE status = $1 AND priority = $2')
    expect(params).toEqual(['open', 'high'])
    expect(next).toBe(3)
  })

  it('skips null and undefined values', () => {
    const { where, params, next } = buildWhereClause({ project_id: null, status: 'open', tag: undefined })
    expect(where).toBe('WHERE status = $1')
    expect(params).toEqual(['open'])
    expect(next).toBe(2)
  })

  it('advances next correctly for use with LIMIT/OFFSET', () => {
    const { next } = buildWhereClause({ a: 1, b: 2, c: 3 })
    expect(next).toBe(4)
  })
})

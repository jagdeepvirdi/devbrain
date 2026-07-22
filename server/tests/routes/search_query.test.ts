import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiEmbed: vi.fn(),
}))

import searchRouter from '../../routes/search.js'
import { pool } from '../../db/pool.js'
import { aiEmbed } from '../../services/ai.js'

const mockQuery = vi.mocked(pool.query)
const mockAiEmbed = vi.mocked(aiEmbed)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (searchRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function emptyRows() {
  return { rows: [] }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /api/search — empty query', () => {
  it('returns recent items from each type with no project filter', async () => {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes("'doc' AS type"))     return { rows: [{ id: 'd1' }] }
      if (text.includes("'issue' AS type"))   return { rows: [{ id: 'i1' }] }
      if (text.includes("'command' AS type")) return { rows: [{ id: 'c1' }] }
      if (text.includes("'release' AS type")) return { rows: [{ id: 'r1' }] }
      if (text.includes("'runbook' AS type")) return { rows: [{ id: 'rb1' }] }
      throw new Error(`unexpected: ${text}`)
    })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: {} }, res, () => {})

    for (const call of mockQuery.mock.calls) {
      expect(String(call[0])).not.toContain('WHERE')
      expect(call[1]).toEqual([10]) // default limit
    }
    expect(res.json).toHaveBeenCalledWith({
      data: { docs: [{ id: 'd1' }], issues: [{ id: 'i1' }], commands: [{ id: 'c1' }], releases: [{ id: 'r1' }], runbooks: [{ id: 'rb1' }] },
    })
  })

  it('filters by project when projectId is given', async () => {
    mockQuery.mockResolvedValue(emptyRows() as never)
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { projectId: 'p1' } }, res, () => {})

    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('WHERE d.project_id = $1')
    expect(values).toEqual(['p1', 10])
  })

  it('clamps limit to between 1 and 50', async () => {
    mockQuery.mockResolvedValue(emptyRows() as never)
    const res1 = fakeRes()
    await getHandler('/', 'get')({ query: { limit: '0' } }, res1, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([1])

    vi.resetAllMocks()
    mockQuery.mockResolvedValue(emptyRows() as never)
    const res2 = fakeRes()
    await getHandler('/', 'get')({ query: { limit: '9999' } }, res2, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([50])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/', 'get')({ query: {} }, res, () => {})

    expect(errSpy).toHaveBeenCalledWith('search error:', expect.any(Error))
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('GET /api/search — non-empty query (hybrid search)', () => {
  function mockHybridQueries(overrides: Partial<Record<'docs' | 'docsFallback' | 'issuesPrimary' | 'issuesFallback' | 'commandsPrimary' | 'commandsFallback' | 'releases' | 'runbooks', unknown[]>> = {}) {
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('document_chunks'))                          return { rows: overrides.docs ?? [] }
      if (text.includes("'doc' AS type"))                            return { rows: overrides.docsFallback ?? [] }
      if (text.includes("'issue' AS type") && text.includes('tsv @@'))     return { rows: overrides.issuesPrimary ?? [] }
      if (text.includes("'issue' AS type") && text.includes('ILIKE'))      return { rows: overrides.issuesFallback ?? [] }
      if (text.includes("'command' AS type") && text.includes('tsv @@'))   return { rows: overrides.commandsPrimary ?? [] }
      if (text.includes("'command' AS type") && text.includes('ILIKE'))    return { rows: overrides.commandsFallback ?? [] }
      if (text.includes("'release' AS type"))                        return { rows: overrides.releases ?? [] }
      if (text.includes("'runbook' AS type"))                        return { rows: overrides.runbooks ?? [] }
      throw new Error(`unexpected: ${text}`)
    })
  }

  it('embeds the query for vector doc search when Ollama is available', async () => {
    mockAiEmbed.mockResolvedValueOnce([0.1, 0.2])
    mockHybridQueries({ docs: [{ id: 'd1' }] })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash' } }, res, () => {})

    expect(mockAiEmbed).toHaveBeenCalledWith('crash')
    const docCall = mockQuery.mock.calls.find(c => String(c[0]).includes('document_chunks'))
    expect(docCall![1]).toEqual(['[0.1,0.2]', 10])
    const data = (res.json.mock.calls[0][0] as { data: { docs: unknown[] } }).data
    expect(data.docs).toEqual([{ id: 'd1' }])
  })

  it('falls back to tsvector/ILIKE doc search when aiEmbed fails', async () => {
    mockAiEmbed.mockRejectedValueOnce(new Error('ollama down'))
    mockHybridQueries({ docsFallback: [{ id: 'd1' }] })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash' } }, res, () => {})

    const docCall = mockQuery.mock.calls.find(c => String(c[0]).includes('document_chunks') === false && String(c[0]).includes("'doc' AS type"))
    expect(docCall![1]).toEqual(['crash', 10])
    const data = (res.json.mock.calls[0][0] as { data: { docs: unknown[] } }).data
    expect(data.docs).toEqual([{ id: 'd1' }])
  })

  it('applies the project filter to the ILIKE doc fallback query too', async () => {
    mockAiEmbed.mockRejectedValueOnce(new Error('ollama down'))
    mockHybridQueries()
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash', projectId: 'p1' } }, res, () => {})

    const docCall = mockQuery.mock.calls.find(c => String(c[0]).includes('document_chunks') === false && String(c[0]).includes("'doc' AS type"))
    expect(docCall![1]).toEqual(['crash', 'p1', 10])
  })

  it('applies the project filter to the vector doc query', async () => {
    mockAiEmbed.mockResolvedValueOnce([0.1])
    mockHybridQueries()
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'x', projectId: 'p1' } }, res, () => {})

    const docCall = mockQuery.mock.calls.find(c => String(c[0]).includes('document_chunks'))
    expect(String(docCall![0])).toContain('AND d.project_id = $2')
    expect(docCall![1]).toEqual(['[0.1]', 'p1', 10])
  })

  it('uses the primary tsvector match for issues and commands when results are found', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries({ issuesPrimary: [{ id: 'i1' }], commandsPrimary: [{ id: 'c1' }] })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'x' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { issues: unknown[]; commands: unknown[] } }).data
    expect(data.issues).toEqual([{ id: 'i1' }])
    expect(data.commands).toEqual([{ id: 'c1' }])
    expect(mockQuery.mock.calls.some(c => String(c[0]).includes("'issue' AS type") && String(c[0]).includes('ILIKE'))).toBe(false)
  })

  it('falls back to ILIKE for issues and commands when the tsvector match is empty', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries({ issuesFallback: [{ id: 'i2' }], commandsFallback: [{ id: 'c2' }] })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'x' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { issues: unknown[]; commands: unknown[] } }).data
    expect(data.issues).toEqual([{ id: 'i2' }])
    expect(data.commands).toEqual([{ id: 'c2' }])
  })

  it('searches releases and runbooks via ILIKE', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries({ releases: [{ id: 'r1' }], runbooks: [{ id: 'rb1' }] })
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'x' } }, res, () => {})

    const data = (res.json.mock.calls[0][0] as { data: { releases: unknown[]; runbooks: unknown[] } }).data
    expect(data.releases).toEqual([{ id: 'r1' }])
    expect(data.runbooks).toEqual([{ id: 'rb1' }])
  })

  it('records search history in the background when a user is present', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries()
    mockQuery.mockResolvedValue({ rows: [] } as never) // covers the history insert/cleanup too
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash' }, user: { id: 'u1' } }, res, () => {})

    await vi.waitFor(() => expect(mockQuery.mock.calls.some(
      c => String(c[0]).includes('INSERT INTO search_history') && (c[1] as unknown[])[0] === 'u1' && (c[1] as unknown[])[1] === 'crash'
    )).toBe(true))
    await vi.waitFor(() => expect(mockQuery.mock.calls.some(c => String(c[0]).includes('DELETE FROM search_history'))).toBe(true))
  })

  it('does not record search history without a user', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries()
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash' } }, res, () => {})

    expect(mockQuery.mock.calls.some(c => String(c[0]).includes('search_history'))).toBe(false)
  })

  it('logs and continues silently when the search-history write fails', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockHybridQueries()
    // First call after the hybrid-search queries settle is the history insert — reject it
    let hybridDone = false
    mockQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql)
      if (text.includes('INSERT INTO search_history')) throw new Error('db down')
      if (text.includes('DELETE FROM search_history')) return { rows: [] }
      hybridDone = true
      return { rows: [] }
    })
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'crash' }, user: { id: 'u1' } }, res, () => {})

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith('failed to update search history:', expect.any(Error)))
    expect(hybridDone).toBe(true)
    errSpy.mockRestore()
  })

  it('responds 500 on a query failure', async () => {
    mockAiEmbed.mockResolvedValueOnce([])
    mockQuery.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()

    await getHandler('/', 'get')({ query: { q: 'x' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('GET /api/search/suggestions', () => {
  it('combines up to 3 issues and 2 docs, with no project filter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'i1' }] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
    const res = fakeRes()

    await getHandler('/suggestions', 'get')({ query: {} }, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'i1' }, { id: 'd1' }] })
  })

  it('filters by project', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/suggestions', 'get')({ query: { projectId: 'p1' } }, res, () => {})
    expect(String(mockQuery.mock.calls[0][0])).toContain('AND i.project_id = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1'])
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await getHandler('/suggestions', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('GET /api/search/history — error path', () => {
  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await getHandler('/history', 'get')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('GET /api/search/filters — error path', () => {
  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await getHandler('/filters', 'get')({ user: { id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('POST /api/search/filters — validation and errors', () => {
  it('400s when name, entity_type, or filter_json is missing', async () => {
    const res = fakeRes()
    await getHandler('/filters', 'post')({ user: { id: 'u1' }, body: { name: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await getHandler('/filters', 'post')({ user: { id: 'u1' }, body: { name: 'X', entity_type: 'issues', filter_json: {} } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

describe('DELETE /api/search/filters/:id', () => {
  it('404s when the filter does not exist or is not owned by the user', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0 } as never)
    const res = fakeRes()
    await getHandler('/filters/:id', 'delete')({ user: { id: 'u1' }, params: { id: 'f1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = fakeRes()
    await getHandler('/filters/:id', 'delete')({ user: { id: 'u1' }, params: { id: 'f1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
    errSpy.mockRestore()
  })
})

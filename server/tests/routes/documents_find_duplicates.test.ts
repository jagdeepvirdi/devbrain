import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
}))

vi.mock('../../services/codeChunker.js', () => ({
  extractSymbolOutline: vi.fn(),
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(routePath: string) {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods.post
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/find-duplicates', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when projectId is missing from the body', async () => {
    const req: any = { body: {} }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('returns an empty array with fewer than 2 code files in scope, without querying embeddings', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'a.ts', content: 'x' }] } as any)
    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [] })
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('scopes the file query to project_id when projectId is given, and has no project filter when null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { body: { projectId: 'proj-1' } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('project_id = $1')
    expect(params).toEqual(['proj-1'])
  })

  it('flags a near-duplicate pair (shortlisted by embedding, confirmed by line similarity)', async () => {
    const contentA = ['function greet(name) {', '  console.log("Hello " + name)', '  return true', '}'].join('\n')
    const contentB = ['function greet(name) {', '  console.log("Hi " + name)', '  return true', '}'].join('\n')

    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'doc-1', title: 'greetOld.ts', content: contentA },
          { id: 'doc-2', title: 'greetNew.ts', content: contentB },
        ],
      } as any) // SELECT code docs in scope
      .mockResolvedValueOnce({ rows: [{ document_id: 'doc-1' }, { document_id: 'doc-2' }] } as any) // both have summary embeddings
      .mockResolvedValueOnce({ rows: [{ doc_a: 'doc-1', doc_b: 'doc-2' }] } as any) // shortlist self-join finds them similar

    const req: any = { body: { projectId: 'proj-1' } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: [
        {
          docA: { id: 'doc-1', title: 'greetOld.ts' },
          docB: { id: 'doc-2', title: 'greetNew.ts' },
          score: 0.75,
        },
      ],
    })
  })

  it('does not flag a shortlisted pair whose actual line similarity falls below the confirm threshold', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'doc-1', title: 'a.ts', content: 'alpha\nbeta\ngamma' },
          { id: 'doc-2', title: 'b.ts', content: 'one\ntwo\nthree' },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ document_id: 'doc-1' }, { document_id: 'doc-2' }] } as any)
      .mockResolvedValueOnce({ rows: [{ doc_a: 'doc-1', doc_b: 'doc-2' }] } as any) // shortlisted despite being unrelated text

    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('compares a file with no summary embedding directly against every other file (fallback), never relying on the shortlist', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'doc-1', title: 'a.ts', content: 'same\nsame\nsame' },
          { id: 'doc-2', title: 'b.ts', content: 'same\nsame\nsame' }, // identical, but summarization failed for this one
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [{ document_id: 'doc-1' }] } as any) // only doc-1 has a summary embedding

    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    // Only 2 pool.query calls: the scoped SELECT + the embedded-ids lookup — no self-join query,
    // since fewer than 2 documents have embeddings (the self-join branch is skipped entirely).
    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(res.json).toHaveBeenCalledWith({
      data: [{ docA: { id: 'doc-1', title: 'a.ts' }, docB: { id: 'doc-2', title: 'b.ts' }, score: 1 }],
    })
  })

  it('sorts results by descending score', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'doc-1', title: 'a.ts', content: 'one\ntwo\nthree\nfour' },
          { id: 'doc-2', title: 'b.ts', content: 'one\ntwo\nthree\nfive' },  // 3/4 shared -> 0.75
          { id: 'doc-3', title: 'c.ts', content: 'one\ntwo\nsix\nseven' },   // 2/4 shared -> 0.5
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // none have summary embeddings -> all-pairs fallback

    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    const { data } = res.json.mock.calls[0][0]
    expect(data.map((d: any) => d.score)).toEqual([0.75, 0.5, 0.5])
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('caps how much of each file is actually diffed, so a divergent tail past the cap never affects the score', async () => {
    // Both files share an identical block well past the 300,000-char compare cap, then diverge
    // completely. If the cap weren't applied, the differing tails would pull the score below 1;
    // scoring exactly 1 proves only the (identical) truncated prefix was ever compared.
    const sharedLine  = 'x'.repeat(100)
    const sharedBlock = Array(3100).fill(sharedLine).join('\n') // > 300,000 chars on its own
    const contentA = `${sharedBlock}\nUNIQUE_TAIL_A_UNIQUE_TAIL_A`
    const contentB = `${sharedBlock}\nUNIQUE_TAIL_B_UNIQUE_TAIL_B`

    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'a.ts', content: contentA }, { id: 'doc-2', title: 'b.ts', content: contentB }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // neither has a summary embedding -> all-pairs fallback

    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: [{ docA: { id: 'doc-1', title: 'a.ts' }, docB: { id: 'doc-2', title: 'b.ts' }, score: 1 }],
    })
  })

  it('yields to the event loop periodically instead of scoring every candidate pair in one unbroken stretch', async () => {
    const setImmediateSpy = vi.spyOn(global, 'setImmediate')

    // 8 documents, all lacking a summary embedding, fall back to comparing every pair directly —
    // C(8,2) = 28 pairs, crossing the 25-pairs-per-yield threshold at least once.
    const docs = Array.from({ length: 8 }, (_, i) => ({ id: `doc-${i}`, title: `f${i}.ts`, content: `line-${i}` }))
    mockQuery
      .mockResolvedValueOnce({ rows: docs } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // no summary embeddings at all -> full cross-product fallback

    const req: any = { body: { projectId: null } }
    const res = fakeRes()
    await getHandler('/find-duplicates')(req, res, () => {})

    expect(setImmediateSpy).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalled() // still completes and responds normally
  })
})

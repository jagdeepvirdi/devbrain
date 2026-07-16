import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { embedDocument } from '../../services/embedder.js'

const mockQuery = vi.mocked(pool.query)
const mockEmbed = vi.mocked(embedDocument)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/:id/save-explanation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req: any = { params: { id: 'missing' } }
    const res = fakeRes()

    await getHandler('/:id/save-explanation', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('rejects non-code documents', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'notes', explanation: 'x', project_id: null, component: null, tags: [], file_type: 'txt' }],
    } as any)

    const req: any = { params: { id: 'doc-1' } }
    const res = fakeRes()

    await getHandler('/:id/save-explanation', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rejects code documents with no explanation yet', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ title: 'index.ts', explanation: null, project_id: null, component: null, tags: [], file_type: 'code' }],
    } as any)

    const req: any = { params: { id: 'doc-2' } }
    const res = fakeRes()

    await getHandler('/:id/save-explanation', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No explanation yet — generate one first' })
  })

  it('creates a new linked document on first save', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'index.ts', explanation: 'It exports x.', project_id: 'proj-1', component: 'core', tags: ['sap'], file_type: 'code' }] } as any) // source lookup
      .mockResolvedValueOnce({ rows: [] } as any) // existing-linked-doc lookup -> none
      .mockResolvedValueOnce({ rows: [{ id: 'new-doc-1' }] } as any) // insert
      .mockResolvedValueOnce({ rows: [] } as any) // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'new-doc-1', title: 'index.ts — Explained' }] } as any) // final select
    mockEmbed.mockResolvedValue(1)

    const req: any = { params: { id: 'doc-3' } }
    const res = fakeRes()

    await getHandler('/:id/save-explanation', 'post')(req, res, () => {})

    const insertCall = mockQuery.mock.calls[2]
    expect(insertCall[0]).toContain('INSERT INTO documents')
    expect(insertCall[1]).toEqual([
      'proj-1', 'index.ts — Explained', 'It exports x.', ['sap', 'code-explanation'], 'core',
      'Generated from "index.ts"', expect.any(String), 'doc-3',
    ])
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'new-doc-1', created: true }) })
  })

  it('updates the existing linked document on a repeat save (idempotent)', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ title: 'index.ts', explanation: 'Updated explanation.', project_id: 'proj-1', component: 'core', tags: [], file_type: 'code' }] } as any) // source lookup
      .mockResolvedValueOnce({ rows: [{ id: 'linked-doc-1' }] } as any) // existing-linked-doc lookup -> found
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE
      .mockResolvedValueOnce({ rows: [] } as any) // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'linked-doc-1', title: 'index.ts — Explained' }] } as any) // final select
    mockEmbed.mockResolvedValue(1)

    const req: any = { params: { id: 'doc-3' } }
    const res = fakeRes()

    await getHandler('/:id/save-explanation', 'post')(req, res, () => {})

    expect(mockQuery.mock.calls[2][0]).toContain('UPDATE documents')
    expect(mockQuery.mock.calls[2][1]).toEqual(['linked-doc-1', 'index.ts — Explained', 'Updated explanation.', expect.any(String)])
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'linked-doc-1', created: false }) })
  })
})

describe('GET /api/documents/:id — reports a linked explanation doc, if one exists', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes linked_explanation_id/title in the query so the client knows without a round-trip', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'doc-3', title: 'index.ts', linked_explanation_id: 'linked-doc-1', linked_explanation_title: 'index.ts — Explained' }],
    } as any)

    const req: any = { params: { id: 'doc-3' } }
    const res = fakeRes()

    await getHandler('/:id', 'get')(req, res, () => {})

    expect(mockQuery.mock.calls[0][0]).toContain('linked_explanation_id')
    expect(mockQuery.mock.calls[0][0]).toContain('linked_explanation_title')
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ linked_explanation_id: 'linked-doc-1', linked_explanation_title: 'index.ts — Explained' }),
    })
  })

  it('includes the explanation_stale computed column in the query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'doc-4', title: 'index.ts', explanation_stale: true }],
    } as any)

    const req: any = { params: { id: 'doc-4' } }
    const res = fakeRes()

    await getHandler('/:id', 'get')(req, res, () => {})

    expect(mockQuery.mock.calls[0][0]).toContain('explanation_stale')
    expect(mockQuery.mock.calls[0][0]).toContain('explanation_hash <> d.content_hash')
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ explanation_stale: true }) })
  })

  it('includes the diagram_stale computed column in the query', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'doc-5', title: 'index.ts', diagram_stale: true }],
    } as any)

    const req: any = { params: { id: 'doc-5' } }
    const res = fakeRes()

    await getHandler('/:id', 'get')(req, res, () => {})

    expect(mockQuery.mock.calls[0][0]).toContain('diagram_stale')
    expect(mockQuery.mock.calls[0][0]).toContain('diagram_hash <> d.content_hash')
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ diagram_stale: true }) })
  })
})

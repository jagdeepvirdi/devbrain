import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument:      vi.fn(),
  embedDocumentsBatch: vi.fn(),
  searchChunks:       vi.fn(),
}))

vi.mock('../../services/links.js', () => ({
  deleteLinksFor: vi.fn(),
}))

vi.mock('../../services/ai.js', () => ({
  aiChat: vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { parseFile, parseUrl } from '../../services/parser.js'
import { embedDocument } from '../../services/embedder.js'
import { deleteLinksFor } from '../../services/links.js'
import { aiChat } from '../../services/ai.js'
import dns from 'node:dns/promises'

const mockQuery      = vi.mocked(pool.query)
const mockConnect    = vi.mocked(pool.connect)
const mockParseFile  = vi.mocked(parseFile)
const mockParseUrl   = vi.mocked(parseUrl)
const mockEmbed      = vi.mocked(embedDocument)
const mockDeleteLinksFor = vi.mocked(deleteLinksFor)
const mockAiChat     = vi.mocked(aiChat)
const mockDnsLookup  = vi.mocked(dns.lookup)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete' | 'patch') {
  const layer = (documentsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function fakeClient() {
  return { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockDnsLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 })
})

describe('GET /api/documents', () => {
  function req(query: Record<string, unknown> = {}) {
    return { query }
  }

  it('applies no filters when none are given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ n: 0 }] } as never).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req(), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('WHERE')
    expect(values).toEqual([])
    expect(res.json).toHaveBeenCalledWith({ data: { items: [], total: 0 } })
  })

  it('combines specific project ids with "global" via an OR clause', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectIds: 'p1,p2,global' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('(d.project_id = ANY($1) OR d.project_id IS NULL)')
    expect(values).toEqual([['p1', 'p2']])
  })

  it('filters for global-only (no project) documents', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectIds: 'global' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('d.project_id IS NULL')
    expect(values).toEqual([])
  })

  it('filters by a single project id via the singular projectId param', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ projectId: 'p1' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('d.project_id = ANY($1)')
    expect(values).toEqual([['p1']])
  })

  it('filters by fileType, tags, and component (array params)', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ fileType: ['code', 'md'], tags: 'a,b', component: 'SAP' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('d.file_type = ANY($1)')
    expect(String(sql)).toContain('d.tags && $2::text[]')
    expect(String(sql)).toContain('d.component = ANY($3)')
    expect(values).toEqual([['code', 'md'], ['a', 'b'], ['SAP']])
  })

  it('filters by a date range', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('d.created_at >= $1::timestamptz')
    expect(String(sql)).toContain('d.created_at <= $2::timestamptz')
    expect(values).toEqual(['2026-01-01', '2026-01-31'])
  })

  it('applies a full-text + ILIKE search via either q or search, sharing placeholders', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ search: 'sap notes' }), res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain(`d.tsv @@ plainto_tsquery('english', $1)`)
    expect(String(sql)).toContain('d.title ILIKE $2')
    expect(String(sql)).toContain('d.content ILIKE $2')
    expect(values).toEqual(['sap notes', '%sap notes%'])
  })

  it('clamps limit to 100 and respects a custom offset', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ limit: '500', offset: '10' }), res, () => {})
    const dataValues = mockQuery.mock.calls[1][1] as unknown[]
    expect(dataValues.slice(-2)).toEqual([100, 10])
  })

  it('coerces a non-string, non-array param value to a single-item array', async () => {
    mockQuery.mockResolvedValue({ rows: [{ n: 0 }] } as never)
    const res = fakeRes()
    await getHandler('/', 'get')(req({ component: 5 }), res, () => {})
    const [, values] = mockQuery.mock.calls[0]
    expect(values).toEqual([['5']])
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')(req(), res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/documents/bulk', () => {
  it('400s when ids is missing or empty', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: [], action: 'delete' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockConnect).not.toHaveBeenCalled()
  })

  it('400s on an invalid action', async () => {
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'nope' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('rolls back and 400s a tag action with a non-string value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'tag', value: 5 } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('tags the given documents', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'tag', value: 'urgent' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('array_append(tags, $1)'), ['urgent', ['d1']])
    expect(res.json).toHaveBeenCalledWith({ data: { success: true } })
  })

  it('rolls back and 400s a component action with a non-string value', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'component', value: null } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('sets the component for the given documents, trimmed', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'component', value: '  SAP  ' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET component = $1'), ['SAP', ['d1']])
  })

  it('clears the component when value is an empty/blank string', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'component', value: '   ' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET component = $1'), [null, ['d1']])
  })

  it('deletes the given documents', async () => {
    const client = fakeClient()
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'delete' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM documents'), [['d1']])
  })

  it('rolls back, releases the client, and 500s on a transaction failure', async () => {
    const client = fakeClient()
    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('DELETE FROM documents')) throw new Error('fk violation')
      return { rows: [] }
    })
    mockConnect.mockResolvedValueOnce(client as never)
    const res = fakeRes()
    await getHandler('/bulk', 'patch')({ body: { ids: ['d1'], action: 'delete' } }, res, () => {})
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(client.release).toHaveBeenCalled()
  })
})

describe('GET /api/documents/:id', () => {
  it('returns the document when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'd1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'd1' } })
  })

  it('404s when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'd1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/documents (file upload)', () => {
  it('400s when no file is uploaded', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: {}, file: undefined }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockParseFile).not.toHaveBeenCalled()
  })

  it('422s when no text could be extracted', async () => {
    mockParseFile.mockResolvedValueOnce({ text: '', fileType: 'txt', title: 'empty' } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: {}, file: { path: '/tmp/x', originalname: 'empty.txt' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('409s when an identical file was already uploaded', async () => {
    mockParseFile.mockResolvedValueOnce({ text: 'same content', fileType: 'txt', title: 'dup' } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-1', title: 'Original' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: {}, file: { path: '/tmp/x', originalname: 'dup.txt' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Original'), existingId: 'existing-1' })
  })

  it('falls back to an empty tags array when tags is not valid JSON', async () => {
    mockParseFile.mockResolvedValueOnce({ text: 'hello', fileType: 'txt', title: 'notes' } as never)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
    mockEmbed.mockResolvedValueOnce(1)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { tags: 'not-json' }, file: { path: '/tmp/x', originalname: 'notes.txt' } }, res, () => {})
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1]).toEqual([null, 'notes', 'txt', 'hello', [], null, 'notes.txt', expect.any(String), null])
  })

  it('deletes the just-inserted row when a post-insert step throws (parse/insert-class failure)', async () => {
    mockParseFile.mockResolvedValueOnce({ text: 'hello', fileType: 'txt', title: 'notes' } as never)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)                 // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)     // insert
      .mockResolvedValueOnce({ rows: [] } as never)                 // embedding_status = done
      .mockRejectedValueOnce(new Error('final select boom'))        // final SELECT throws -> outer catch
      .mockResolvedValueOnce({ rows: [] } as never)                 // DELETE FROM documents
    mockEmbed.mockResolvedValueOnce(1)
    const res = fakeRes()

    await getHandler('/', 'post')({ body: {}, file: { path: '/tmp/x', originalname: 'notes.txt' } }, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM documents WHERE id = $1', ['d1'])
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('swallows a failure in the cleanup DELETE itself', async () => {
    mockParseFile.mockResolvedValueOnce({ text: 'hello', fileType: 'txt', title: 'notes' } as never)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockRejectedValueOnce(new Error('final select boom'))
      .mockRejectedValueOnce(new Error('cleanup delete also fails'))
    mockEmbed.mockResolvedValueOnce(1)
    const res = fakeRes()

    await getHandler('/', 'post')({ body: {}, file: { path: '/tmp/x', originalname: 'notes.txt' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('does not attempt a cleanup DELETE when parseFile itself throws before docId is ever set', async () => {
    mockParseFile.mockRejectedValueOnce(new Error('unreadable file'))
    const res = fakeRes()

    await getHandler('/', 'post')({ body: {}, file: { path: '/tmp/x', originalname: 'notes.txt' } }, res, () => {})

    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM documents'), expect.anything())
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/documents/url', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/url', 'post')({ body: { url: 'not-a-url' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('422s when the URL resolves to a private address', async () => {
    mockDnsLookup.mockResolvedValueOnce({ address: '127.0.0.1', family: 4 })
    const res = fakeRes()
    await getHandler('/url', 'post')({ body: { url: 'http://internal.local' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockParseUrl).not.toHaveBeenCalled()
  })

  it('422s (treats as unsafe) when the DNS lookup itself fails', async () => {
    mockDnsLookup.mockRejectedValueOnce(new Error('DNS resolution failed'))
    const res = fakeRes()
    await getHandler('/url', 'post')({ body: { url: 'https://nonexistent.invalid' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockParseUrl).not.toHaveBeenCalled()
  })

  it('422s when no text could be extracted', async () => {
    mockParseUrl.mockResolvedValueOnce({ text: '', fileType: 'url', title: 'empty' } as never)
    const res = fakeRes()
    await getHandler('/url', 'post')({ body: { url: 'https://example.com' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('409s when an identical URL was already imported', async () => {
    mockParseUrl.mockResolvedValueOnce({ text: 'same content', fileType: 'url', title: 'dup' } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-1', title: 'Original' }] } as never)
    const res = fakeRes()
    await getHandler('/url', 'post')({ body: { url: 'https://example.com' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('Original'), existingId: 'existing-1' })
  })

  it('deletes the just-inserted row when a post-insert step throws', async () => {
    mockParseUrl.mockResolvedValueOnce({ text: 'content', fileType: 'url', title: 'page' } as never)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockRejectedValueOnce(new Error('final select boom'))
      .mockResolvedValueOnce({ rows: [] } as never)
    mockEmbed.mockResolvedValueOnce(1)
    const res = fakeRes()

    await getHandler('/url', 'post')({ body: { url: 'https://example.com' } }, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM documents WHERE id = $1', ['d1'])
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('swallows a failure in the cleanup DELETE itself', async () => {
    mockParseUrl.mockResolvedValueOnce({ text: 'content', fileType: 'url', title: 'page' } as never)
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never)
      .mockRejectedValueOnce(new Error('final select boom'))
      .mockRejectedValueOnce(new Error('cleanup delete also fails'))
    mockEmbed.mockResolvedValueOnce(1)
    const res = fakeRes()

    await getHandler('/url', 'post')({ body: { url: 'https://example.com' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('does not attempt a cleanup DELETE when parseUrl itself throws before docId is ever set', async () => {
    mockParseUrl.mockRejectedValueOnce(new Error('fetch failed'))
    const res = fakeRes()

    await getHandler('/url', 'post')({ body: { url: 'https://example.com' } }, res, () => {})

    expect(mockQuery).not.toHaveBeenCalledWith(expect.stringContaining('DELETE FROM documents'), expect.anything())
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PATCH /api/documents/:id', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'd1' }, body: { title: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'd1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
  })

  it('maps projectId to project_id and updates title/tags together', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', title: 'New title' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'd1' }, body: { title: 'New title', tags: ['a'], projectId: 'p2' } }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('title = $2, tags = $3, project_id = $4')
    expect(values).toEqual(['d1', 'New title', ['a'], 'p2'])
  })

  it('allows clearing projectId to null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', project_id: null }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'd1' }, body: { projectId: null } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['d1', null])
  })

  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'missing' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'patch')({ params: { id: 'd1' }, body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/documents/:id', () => {
  it('deletes the document and its links', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', title: 'Doc' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'd1' } }, res, () => {})
    expect(mockDeleteLinksFor).toHaveBeenCalledWith('document', 'd1')
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'd1', title: 'Doc' } } })
  })

  it('404s without deleting links when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockDeleteLinksFor).not.toHaveBeenCalled()
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'd1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/documents/:id/reembed', () => {
  it('404s when the document does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/reembed', 'post')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('marks processing, triggers the fire-and-forget re-embed, and marks done on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', content: 'text', title: 'Doc', language: 'python' }] } as never)
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockEmbed.mockResolvedValueOnce(3)
    const res = fakeRes()

    await getHandler('/:id/reembed', 'post')({ params: { id: 'd1' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { id: 'd1', embedding_status: 'processing' } })
    await vi.waitFor(() => expect(mockQuery.mock.calls.some(
      c => String(c[0]).includes(`embedding_status = 'done'`)
    )).toBe(true))
  })

  it('marks failed when the fire-and-forget embed rejects', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1', content: 'text', title: 'Doc', language: null }] } as never)
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockEmbed.mockRejectedValueOnce(new Error('ollama down'))
    const res = fakeRes()

    await getHandler('/:id/reembed', 'post')({ params: { id: 'd1' } }, res, () => {})

    await vi.waitFor(() => expect(mockQuery.mock.calls.some(
      c => String(c[0]).includes(`embedding_status = 'failed'`)
    )).toBe(true))
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/reembed', 'post')({ params: { id: 'd1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })

  it('swallows a failure in the failed-status cleanup update itself', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down')).mockRejectedValueOnce(new Error('cleanup also fails'))
    const res = fakeRes()
    await getHandler('/:id/reembed', 'post')({ params: { id: 'd1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/documents/suggest-tags', () => {
  it('400s when title and hint are both empty', async () => {
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('extracts and caps the suggested tags to 5', async () => {
    mockAiChat.mockResolvedValueOnce('```json\n["a","b","c","d","e","f"]\n```')
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: { title: 'Setup guide', hint: 'docker postgres' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { tags: ['a', 'b', 'c', 'd', 'e'] } })
  })

  it('returns an empty tags array when the AI response has no JSON array', async () => {
    mockAiChat.mockResolvedValueOnce('no array here')
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: { title: 'X' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { tags: [] } })
  })

  it('responds 500 on a failure', async () => {
    mockAiChat.mockRejectedValueOnce(new Error('ollama down'))
    const res = fakeRes()
    await getHandler('/suggest-tags', 'post')({ body: { title: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

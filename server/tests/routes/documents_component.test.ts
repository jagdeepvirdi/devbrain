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

// isPrivateUrl() does a real DNS lookup — stub it to a public address so the
// URL-import test doesn't depend on network access in the test sandbox.
vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
}))

import documentsRouter from '../../routes/documents.js'
import { pool } from '../../db/pool.js'
import { parseFile, parseUrl } from '../../services/parser.js'
import { embedDocument } from '../../services/embedder.js'

const mockQuery     = vi.mocked(pool.query)
const mockParseFile = vi.mocked(parseFile)
const mockParseUrl  = vi.mocked(parseUrl)
const mockEmbed     = vi.mocked(embedDocument)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents — component is stored on upload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the trimmed component through to the INSERT', async () => {
    mockParseFile.mockResolvedValue({ text: 'hello world', fileType: 'txt', title: 'notes' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)                 // dedup check
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1' }] } as any)  // insert
      .mockResolvedValueOnce({ rows: [] } as any)                 // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', component: 'SAP' }] } as any) // final select
    mockEmbed.mockResolvedValue(1)

    const req: any = {
      body: { component: '  SAP  ' },
      file: { path: '/tmp/fake', originalname: 'notes.txt' },
    }
    const res = fakeRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO documents'),
      [null, 'notes', 'txt', 'hello world', [], 'SAP', 'notes.txt', expect.any(String), null]
    )
  })

  it('stores null when no component is given', async () => {
    mockParseFile.mockResolvedValue({ text: 'hello world', fileType: 'txt', title: 'notes' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-2' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-2', component: null }] } as any)
    mockEmbed.mockResolvedValue(1)

    const req: any = { body: {}, file: { path: '/tmp/fake', originalname: 'notes.txt' } }
    const res = fakeRes()

    await getHandler('/', 'post')(req, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO documents'),
      [null, 'notes', 'txt', 'hello world', [], null, 'notes.txt', expect.any(String), null]
    )
  })
})

describe('POST /api/documents/url — component is stored on import', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the component through to the INSERT', async () => {
    mockParseUrl.mockResolvedValue({ text: 'page content', fileType: 'url', title: 'example.com' })
    mockQuery
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-3' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'doc-3', component: 'Payment' }] } as any)
    mockEmbed.mockResolvedValue(1)

    const req: any = { body: { url: 'https://example.com', tags: [], component: 'Payment' } }
    const res = fakeRes()

    await getHandler('/url', 'post')(req, res, () => {})

    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO documents'),
      [null, 'example.com', 'url', 'page content', [], 'Payment', 'https://example.com', expect.any(String)]
    )
  })
})

describe('GET /api/documents/components — distinct values for autocomplete', () => {
  beforeEach(() => vi.clearAllMocks())

  it('scopes to a project when projectId is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ component: 'BPP' }, { component: 'SAP' }] } as any)

    const req: any = { query: { projectId: 'proj-1' } }
    const res = fakeRes()

    await getHandler('/components', 'get')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE component IS NOT NULL AND project_id = $1'),
      ['proj-1']
    )
    expect(res.json).toHaveBeenCalledWith({ data: ['BPP', 'SAP'] })
  })

  it('returns all distinct components when no projectId is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ component: 'SAP' }] } as any)

    const req: any = { query: {} }
    const res = fakeRes()

    await getHandler('/components', 'get')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('WHERE component IS NOT NULL ORDER BY component'),
      []
    )
    expect(res.json).toHaveBeenCalledWith({ data: ['SAP'] })
  })
})

describe('PATCH /api/documents/:id — component is an updatable field', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates the component column', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1', component: 'BPP' }] } as any)

    const req: any = { params: { id: 'doc-1' }, body: { component: 'BPP' } }
    const res = fakeRes()

    await getHandler('/:id', 'patch')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents SET component = $2'),
      ['doc-1', 'BPP']
    )
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'doc-1', component: 'BPP' } })
  })

  it('allows clearing the component with null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'doc-1', component: null }] } as any)

    const req: any = { params: { id: 'doc-1' }, body: { component: null } }
    const res = fakeRes()

    await getHandler('/:id', 'patch')(req, res, () => {})

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE documents SET component = $2'),
      ['doc-1', null]
    )
  })
})

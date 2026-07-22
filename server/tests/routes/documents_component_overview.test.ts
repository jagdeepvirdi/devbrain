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
import { aiChat } from '../../services/ai.js'
import { embedDocument } from '../../services/embedder.js'
import { extractSymbolOutline } from '../../services/codeChunker.js'

const mockQuery   = vi.mocked(pool.query)
const mockAiChat  = vi.mocked(aiChat)
const mockEmbed   = vi.mocked(embedDocument)
const mockOutline = vi.mocked(extractSymbolOutline)

function getHandler(routePath: string, method: 'get' | 'post' | 'patch' | 'delete') {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/component-overview', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s on an empty component name', async () => {
    const req: any = { body: { component: '', projectId: null } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404s when no code files match the component/project scope', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { body: { component: 'SAP', projectId: 'proj-1' } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('scopes the file query to project_id IS NULL when projectId is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)
    const req: any = { body: { component: 'SAP', projectId: null } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})
    const [sql, params] = mockQuery.mock.calls[0]
    expect(sql).toContain('project_id IS NULL')
    expect(params).toEqual(['SAP', 30])
  })

  it('uses symbol outlines (not full content) when available, falls back to a snippet otherwise', async () => {
    mockQuery
      .mockResolvedValueOnce({
        rows: [
          { id: 'doc-1', title: 'a.ts', language: 'typescript', content: 'export function a() { return 1 }' },
          { id: 'doc-2', title: 'b.pl', language: 'perl', content: 'x'.repeat(2000) },
        ],
      } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // existing overview lookup
      .mockResolvedValueOnce({ rows: [{ id: 'overview-doc' }] } as any) // INSERT
      .mockResolvedValueOnce({ rows: [] } as any) // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'overview-doc', title: 'SAP — Component Overview' }] } as any) // final select

    mockOutline.mockImplementation(async (_content, language) =>
      language === 'typescript' ? ['export function a() {'] : null
    )
    mockAiChat.mockResolvedValue('This component handles SAP integration.')
    mockEmbed.mockResolvedValue(3)

    const req: any = { body: { component: 'SAP', projectId: 'proj-1' } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})

    const prompt = mockAiChat.mock.calls[0][0]
    expect(prompt).toContain('export function a() {')       // outline used for the TS file
    expect(prompt).not.toContain('export function a() { return 1 }') // full body NOT dumped
    expect(prompt).toContain('x'.repeat(800))                 // truncated snippet fallback for perl
    expect(prompt).not.toContain('x'.repeat(2000))             // not the full 2000-char content

    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'overview-doc', chunk_count: 3, created: true, fileCount: 2 }),
    })
  })

  it('updates the existing overview doc on a repeat call instead of creating a duplicate', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'a.ts', language: 'typescript', content: 'x' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'existing-overview' }] } as any) // existing overview found
      .mockResolvedValueOnce({ rows: [] } as any) // UPDATE
      .mockResolvedValueOnce({ rows: [] } as any) // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'existing-overview' }] } as any) // final select

    mockOutline.mockResolvedValue(['export function a() {'])
    mockAiChat.mockResolvedValue('Updated overview.')
    mockEmbed.mockResolvedValue(1)

    const req: any = { body: { component: 'SAP', projectId: 'proj-1' } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})

    expect(mockQuery.mock.calls[2][0]).toContain('UPDATE documents')
    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ created: false }) })
  })

  it('creates a new overview with a null projectId and a file with no language', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'doc-1', title: 'a', language: null, content: 'plain text content' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // no existing overview
      .mockResolvedValueOnce({ rows: [{ id: 'overview-doc' }] } as any) // INSERT
      .mockResolvedValueOnce({ rows: [] } as any) // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'overview-doc' }] } as any) // final select

    mockOutline.mockResolvedValue(null)
    mockAiChat.mockResolvedValue('Overview text.')
    mockEmbed.mockResolvedValue(1)

    const req: any = { body: { component: 'Misc', projectId: null } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})

    const prompt = mockAiChat.mock.calls[0][0]
    expect(prompt).toContain('### a\n') // no "(language)" suffix when language is null

    const existingLookupCall = mockQuery.mock.calls[1]
    expect(existingLookupCall[1]).toEqual(['Misc'])

    const insertCall = mockQuery.mock.calls[2]
    expect(insertCall[1]).toEqual([null, 'Misc — Component Overview', 'Overview text.', ['component-overview'], 'Misc', expect.any(String), expect.any(String), 'Misc'])
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const req: any = { body: { component: 'SAP', projectId: null } }
    const res = fakeRes()
    await getHandler('/component-overview', 'post')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

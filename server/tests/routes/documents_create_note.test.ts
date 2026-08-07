import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn().mockResolvedValue({ address: '93.184.216.34' }) },
  lookup:  vi.fn().mockResolvedValue({ address: '93.184.216.34' }),
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

describe('POST /api/documents/note', () => {
  beforeEach(() => vi.clearAllMocks())

  it('400s when title is missing', async () => {
    const req: any = { body: { content: 'some text' } }
    const res = fakeRes()

    await getHandler('/note', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('creates a blank note (content defaults to empty string) with file_type=note and language=markdown', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'note-1' }] } as any)                                   // INSERT
      .mockResolvedValueOnce({ rows: [] } as any)                                                    // embedding_status = done
      .mockResolvedValueOnce({ rows: [{ id: 'note-1', title: 'Scratchpad', file_type: 'note' }] } as any) // final select
    mockEmbed.mockResolvedValue(0)

    const req: any = { body: { title: 'Scratchpad' } }
    const res = fakeRes()

    await getHandler('/note', 'post')(req, res, () => {})

    const insertCall = mockQuery.mock.calls[0]
    expect(insertCall[0]).toContain('INSERT INTO documents')
    expect(insertCall[0]).toContain("'note'")
    expect(insertCall[0]).toContain("'markdown'")
    expect(insertCall[1]).toEqual([null, 'Scratchpad', '', [], null, expect.any(String)])

    expect(mockEmbed).toHaveBeenCalledWith('note-1', '', { title: 'Scratchpad', language: 'markdown' })
    expect(res.status).toHaveBeenCalledWith(201)
    expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'note-1', chunk_count: 0 }) })
  })

  it('creates a note with content, tags, project, and component set', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'note-2' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'note-2', title: 'Meeting notes' }] } as any)
    mockEmbed.mockResolvedValue(1)

    const req: any = {
      body: { title: 'Meeting notes', content: '# Standup\n- did stuff', projectId: 'proj-1', tags: ['standup'], component: 'Team' },
    }
    const res = fakeRes()

    await getHandler('/note', 'post')(req, res, () => {})

    const insertCall = mockQuery.mock.calls[0]
    expect(insertCall[1]).toEqual(['proj-1', 'Meeting notes', '# Standup\n- did stuff', ['standup'], 'Team', expect.any(String)])
    expect(mockEmbed).toHaveBeenCalledWith('note-2', '# Standup\n- did stuff', { title: 'Meeting notes', language: 'markdown' })
  })

  it('does NOT reject duplicate content the way URL import does — two blank notes are both allowed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'note-3' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'note-3' }] } as any)
    mockEmbed.mockResolvedValue(0)

    const req: any = { body: { title: 'Another blank note' } }
    const res = fakeRes()

    await getHandler('/note', 'post')(req, res, () => {})

    expect(res.status).not.toHaveBeenCalledWith(409)
    // Only the INSERT/embed-status/select queries ran — no pre-insert dedup lookup.
    expect(mockQuery).toHaveBeenCalledTimes(3)
  })

  it('deletes the row and marks failure if something throws after insert', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'note-4' }] } as any) // INSERT
      .mockRejectedValueOnce(new Error('embed status update failed'))
      .mockResolvedValueOnce({ rows: [] } as any) // cleanup DELETE
    mockEmbed.mockRejectedValue(new Error('ollama down'))

    const req: any = { body: { title: 'Broken note' } }
    const res = fakeRes()

    await getHandler('/note', 'post')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    const deleteCall = mockQuery.mock.calls.at(-1)
    expect(deleteCall![0]).toContain('DELETE FROM documents')
    expect(deleteCall![1]).toEqual(['note-4'])
  })
})

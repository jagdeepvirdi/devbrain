import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Writable } from 'node:stream'
import type { Archiver } from 'archiver'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const addProjectToArchiveMock = vi.fn(async (archive: Archiver, _project: unknown) => {
  archive.append('mock content', { name: 'test.txt' })
})
const buildZipToStreamMock = vi.fn(async (archive: Archiver, _ids: unknown) => {
  archive.append('mock content', { name: 'test.txt' })
  await archive.finalize()
})
vi.mock('../../services/exporter.js', () => ({
  addProjectToArchive: (archive: Archiver, project: unknown) => addProjectToArchiveMock(archive, project),
  buildZipToStream: (archive: Archiver, ids: unknown) => buildZipToStreamMock(archive, ids),
}))

// eslint-disable-next-line import/first
import exportRouter from '../../routes/export.js'
// eslint-disable-next-line import/first
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'delete' | 'patch') {
  const layer = (exportRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeJsonRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }
}

function fakeStreamRes() {
  const chunks: Buffer[] = []
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb() },
  }) as Writable & { setHeader: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; chunks: Buffer[] }
  res.setHeader = vi.fn()
  res.status    = vi.fn().mockReturnThis()
  res.json      = vi.fn()
  res.chunks    = chunks
  return res
}

describe('GET /api/export/project/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const res = fakeJsonRes()
    await getHandler('/project/:id', 'get')({ params: { id: 'missing' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(res.json).toHaveBeenCalledWith({ error: 'Project not found' })
    expect(addProjectToArchiveMock).not.toHaveBeenCalled()
  })

  it('streams a zip archive for a found project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'PlayCru', short_name: 'playcru' }] } as never)

    const res = fakeStreamRes()
    const finished = new Promise(resolve => res.on('finish', resolve))

    await getHandler('/project/:id', 'get')({ params: { id: 'p1' } }, res, () => {})
    await finished

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('devbrain-playcru-'))
    expect(addProjectToArchiveMock).toHaveBeenCalledTimes(1)
    expect(addProjectToArchiveMock.mock.calls[0][1]).toEqual({ id: 'p1', name: 'PlayCru', short_name: 'playcru' })
    expect(res.chunks.length).toBeGreaterThan(0)
  })

  it('responds with a server error when the query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))

    const res = fakeJsonRes()
    await getHandler('/project/:id', 'get')({ params: { id: 'p1' } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/export/all', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('streams a zip archive for all projects', async () => {
    const res = fakeStreamRes()
    const finished = new Promise(resolve => res.on('finish', resolve))

    await getHandler('/all', 'get')({}, res, () => {})
    await finished

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('devbrain-export-'))
    expect(buildZipToStreamMock).toHaveBeenCalledTimes(1)
    expect(buildZipToStreamMock.mock.calls[0][1]).toBe('all')
    expect(res.chunks.length).toBeGreaterThan(0)
  })

  it('responds with a server error when the archive build fails', async () => {
    // archive.pipe(res) already runs before buildZipToStream is awaited, so
    // res needs to be a real Writable here too — a plain status/json stub
    // would blow up as soon as archiver tries to write to it.
    buildZipToStreamMock.mockRejectedValueOnce(new Error('export exploded'))

    const res = fakeStreamRes()
    await getHandler('/all', 'get')({}, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

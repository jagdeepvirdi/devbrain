import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/codeSync.js', () => ({
  syncProjectDocs: vi.fn(),
}))

import router from '../../routes/sync-docs.js'
import { pool } from '../../db/pool.js'
import { syncProjectDocs } from '../../services/codeSync.js'

const mockQuery = vi.mocked(pool.query)
const mockSync  = vi.mocked(syncProjectDocs)

function getHandler() {
  return router.stack.find(s => s.route?.path === '/' && (s.route as any)?.methods.post)?.route?.stack[0]?.handle
}

describe('POST /api/documents/sync-docs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('400s when neither projectId nor fsPath is provided', async () => {
    const req = { body: {} }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404s when no project matches projectId', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req = { body: { projectId: 'nope' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('422s when the matched project has no fs_path linked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: null }] } as any)

    const req = { body: { fsPath: '/repo' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('runs syncProjectDocs and returns its result on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: '/repo' }] } as any)
    const syncResult = { projectId: 'p1', scanned: 2, created: 2, updated: 0, skipped: 0, failed: 0, errors: [] }
    mockSync.mockResolvedValueOnce(syncResult)

    const req = { body: { projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(mockSync).toHaveBeenCalledWith('p1', '/repo')
    expect(res.json).toHaveBeenCalledWith({ data: syncResult })
  })

  it('500s via serverError when syncProjectDocs throws', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: '/repo' }] } as any)
    mockSync.mockRejectedValueOnce(new Error('walk failed'))

    const req = { body: { projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

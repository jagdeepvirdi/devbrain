import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/codeSync.js', () => ({
  syncProjectCode: vi.fn(),
}))

import router from '../../routes/sync-code.js'
import { pool } from '../../db/pool.js'
import { syncProjectCode } from '../../services/codeSync.js'

const mockQuery = vi.mocked(pool.query)
const mockSync  = vi.mocked(syncProjectCode)

function getHandler() {
  return router.stack.find(s => s.route?.path === '/' && (s.route as any)?.methods.post)?.route?.stack[0]?.handle
}

describe('POST /api/documents/sync-code', () => {
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

  it('404s when no project matches fsPath', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as any)

    const req = { body: { fsPath: '/no/such/path' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('422s when the matched project has no fs_path linked', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: null }] } as any)

    const req = { body: { projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('looks up by fsPath when projectId is absent', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p2', fs_path: '/repo/other' }] } as any)
    mockSync.mockResolvedValueOnce({ projectId: 'p2', scanned: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] })

    const req = { body: { fsPath: '/repo/other' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    const sql = mockQuery.mock.calls[0][0]
    expect(sql).toContain('fs_path = $1')
    expect(mockQuery.mock.calls[0][1]).toEqual(['/repo/other'])
    expect(mockSync).toHaveBeenCalledWith('p2', '/repo/other')
  })

  it('runs syncProjectCode and returns its result on success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: '/repo' }] } as any)
    const syncResult = { projectId: 'p1', scanned: 3, created: 1, updated: 1, skipped: 1, failed: 0, errors: [] }
    mockSync.mockResolvedValueOnce(syncResult)

    const req = { body: { projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(mockSync).toHaveBeenCalledWith('p1', '/repo')
    expect(res.json).toHaveBeenCalledWith({ data: syncResult })
  })

  it('500s via serverError when syncProjectCode throws', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: '/repo' }] } as any)
    mockSync.mockRejectedValueOnce(new Error('walk failed'))

    const req = { body: { projectId: 'p1' } }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    await getHandler()!(req as any, res as any, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
  })
})

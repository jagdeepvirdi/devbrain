import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn() } }))
vi.mock('../../lib/env.js', () => ({ env: { AI_PROVIDER: 'ollama', OLLAMA_CHAT_MODEL: 'mistral' } }))
vi.mock('../../services/gitDigest.js', async () => {
  const actual = await vi.importActual<typeof import('../../services/gitDigest.js')>('../../services/gitDigest.js')
  return { ...actual, buildProjectDigest: vi.fn() }
})

import activityRouter from '../../routes/activity.js'
import { pool } from '../../db/pool.js'
import { buildProjectDigest } from '../../services/gitDigest.js'
import { LocalAIRequiredError } from '../../lib/requireLocalAI.js'

const mockQuery = vi.mocked(pool.query)
const mockBuild = vi.mocked(buildProjectDigest)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post') {
  const layer = (activityRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method],
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

beforeEach(() => { vi.resetAllMocks() })

const DIGEST = {
  week_start: '2026-11-09', week_end: '2026-11-16', commit_count: 2, branches: ['main'],
  stats: { files_changed: 2, insertions: 3, deletions: 0 },
  summary: { highlights: [], features: [], fixes: [], risks: [], summary: 's' },
}

describe('GET /api/activity/digest', () => {
  it('400s on a malformed week', async () => {
    const res = fakeRes()
    await getHandler('/digest', 'get')({ query: { week: 'nope' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('400s on an impossible date', async () => {
    const res = fakeRes()
    await getHandler('/digest', 'get')({ query: { week: '2026-13-45' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('normalizes the week to Monday and returns rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'd1' }] } as never)
    const res = fakeRes()
    await getHandler('/digest', 'get')({ query: { week: '2026-11-13' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-11-09'])
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'd1' }], week_start: '2026-11-09' })
  })

  it('filters by project_id when given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await getHandler('/digest', 'get')({ query: { week: '2026-11-13', project_id: 'p1' } }, fakeRes(), () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['2026-11-09', 'p1'])
  })

  it('500s when the query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest', 'get')({ query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/activity/digest/generate', () => {
  it('400s on a malformed week', async () => {
    const res = fakeRes()
    await getHandler('/digest/generate', 'post')({ body: { week: '11/13' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('upserts a digest for each project that has an fs_path', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'DevBrain', fs_path: 'D:/Project/devbrain' }] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd1', project_id: 'p1' }] } as never)
    mockBuild.mockResolvedValueOnce(DIGEST)

    const res = fakeRes()
    await getHandler('/digest/generate', 'post')({ body: { week: '2026-11-13' } }, res, () => {})

    expect(mockBuild).toHaveBeenCalledWith('D:/Project/devbrain', '2026-11-13')
    expect(String(mockQuery.mock.calls[1][0])).toContain('ON CONFLICT (project_id, week_start) DO UPDATE')
    expect(res.json).toHaveBeenCalledWith({ data: { digests: [{ id: 'd1', project_id: 'p1' }], errors: [] } })
  })

  it('scopes to one project when project_id is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    await getHandler('/digest/generate', 'post')({ body: { project_id: 'p9' } }, fakeRes(), () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['p9'])
  })

  it('reports a per-project failure without aborting the others', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [
        { id: 'p1', name: 'A', fs_path: '/missing' },
        { id: 'p2', name: 'B', fs_path: '/ok' },
      ] } as never)
      .mockResolvedValueOnce({ rows: [{ id: 'd2' }] } as never)
    mockBuild.mockRejectedValueOnce(new Error('ENOENT')).mockResolvedValueOnce(DIGEST)

    const res = fakeRes()
    await getHandler('/digest/generate', 'post')({ body: {} }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: {
        digests: [{ id: 'd2' }],
        errors: [{ project_id: 'p1', project: 'A', error: 'ENOENT' }],
      },
    })
  })

  it('400s (and writes nothing) when a cloud AI provider is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'A', fs_path: '/x' }] } as never)
    mockBuild.mockRejectedValueOnce(new LocalAIRequiredError('claude'))

    const res = fakeRes()
    await getHandler('/digest/generate', 'post')({ body: {} }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).toHaveBeenCalledTimes(1)   // project lookup only — no INSERT
  })

  it('500s when the project lookup fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/digest/generate', 'post')({ body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

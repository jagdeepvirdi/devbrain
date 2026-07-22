import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../db/seed.js', () => ({
  runSeed: vi.fn(),
}))

vi.mock('../../services/tasks-watcher.js', () => ({
  refreshProjectWatch: vi.fn(),
}))

vi.mock('../../lib/env.js', () => ({
  env: { NODE_ENV: 'test' },
}))

vi.mock('node:fs', () => ({
  promises: { stat: vi.fn() },
}))

import projectsRouter from '../../routes/projects.js'
import { pool } from '../../db/pool.js'
import { runSeed } from '../../db/seed.js'
import { refreshProjectWatch } from '../../services/tasks-watcher.js'
import { env } from '../../lib/env.js'
import { promises as fsPromises } from 'node:fs'

const mockQuery = vi.mocked(pool.query)
const mockRunSeed = vi.mocked(runSeed)
const mockRefreshProjectWatch = vi.mocked(refreshProjectWatch)
const mockStat = vi.mocked(fsPromises.stat)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'put' | 'delete') {
  const layer = (projectsRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

const validBody = {
  name: 'PlayCru', short_name: 'playcru', color: '#2ECC71', status: 'active' as const, type: 'mobile' as const,
}

beforeEach(() => {
  vi.resetAllMocks()
  env.NODE_ENV = 'test'
})

describe('GET /api/projects', () => {
  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/', 'get')({ user: { role: 'admin', id: 'a1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/projects/:id', () => {
  it('returns the project for an admin', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'p1' }, user: { role: 'admin', id: 'a1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'p1' } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'get')({ params: { id: 'p1' }, user: { role: 'admin', id: 'a1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/projects', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { name: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('creates a project, defaulting repo_url to null when omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: validBody }, res, () => {})
    const [, params] = mockQuery.mock.calls[0]
    expect(params).toEqual(['PlayCru', 'playcru', '', '#2ECC71', 'active', [], 'mobile', null])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('keeps an explicit empty-string repo_url as-is (not coerced to null)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)
    const res = fakeRes()
    await getHandler('/', 'post')({ body: { ...validBody, repo_url: '' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['PlayCru', 'playcru', '', '#2ECC71', 'active', [], 'mobile', ''])
  })

  it('responds 409 when short_name is already taken', async () => {
    mockQuery.mockRejectedValueOnce(new Error('duplicate key value violates unique constraint "projects_short_name_key"'))
    const res = fakeRes()
    await getHandler('/', 'post')({ body: validBody }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
    expect(res.json).toHaveBeenCalledWith({ error: 'short_name "playcru" is already taken' })
  })

  it('responds 500 on any other failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection reset'))
    const res = fakeRes()
    await getHandler('/', 'post')({ body: validBody }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/projects/:id', () => {
  it('400s on an invalid partial body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: { color: 'not-hex' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "No fields to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'No fields to update' })
  })

  it('coerces an empty-string field value to null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: { repo_url: '' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', null])
  })

  it('updates the given fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'New name' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: { name: 'New name' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'p1', name: 'New name' } })
  })

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'missing' }, body: { name: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 409 when short_name is already taken', async () => {
    mockQuery.mockRejectedValueOnce(new Error('unique violation'))
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: { short_name: 'taken' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(409)
  })

  it('responds 500 on any other failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'put')({ params: { id: 'p1' }, body: { name: 'X' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/projects/:id/link', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: '' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('unlinks without a filesystem check when fs_path is null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: null } }, res, () => {})
    expect(mockStat).not.toHaveBeenCalled()
    expect(mockRefreshProjectWatch).toHaveBeenCalledWith('p1', null)
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'p1', fs_path: null } })
  })

  it('422s when fs_path points to a file, not a directory', async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: () => false } as never)
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: '/some/file.txt' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('422s when fs_path does not exist', async () => {
    mockStat.mockRejectedValueOnce(new Error('ENOENT'))
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: '/nope' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('links a valid directory and refreshes the watcher', async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', fs_path: '/repos/p1' }] } as never)
    const res = fakeRes()

    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: '/repos/p1' } }, res, () => {})

    expect(mockQuery.mock.calls[0][1]).toEqual(['/repos/p1', 'p1'])
    expect(mockRefreshProjectWatch).toHaveBeenCalledWith('p1', '/repos/p1')
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'p1', fs_path: '/repos/p1' } })
  })

  it('404s when the project does not exist', async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'missing' }, body: { fs_path: '/repos/x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
    expect(mockRefreshProjectWatch).not.toHaveBeenCalled()
  })

  it('responds 500 on a query failure', async () => {
    mockStat.mockResolvedValueOnce({ isDirectory: () => true } as never)
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/link', 'put')({ params: { id: 'p1' }, body: { fs_path: '/repos/x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/projects/:id', () => {
  it('deletes the project', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'PlayCru' }] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'p1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { id: 'p1', name: 'PlayCru' } } })
  })

  it('404s when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id', 'delete')({ params: { id: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/projects/seed/reset', () => {
  it('403s in production', async () => {
    env.NODE_ENV = 'production'
    const res = fakeRes()
    await getHandler('/seed/reset', 'post')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(403)
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockRunSeed).not.toHaveBeenCalled()
  })

  it('deletes all projects and reseeds outside of production', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/seed/reset', 'post')({}, res, () => {})
    expect(mockQuery).toHaveBeenCalledWith('DELETE FROM projects')
    expect(mockRunSeed).toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith({ data: { message: 'Seed reset complete' } })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/seed/reset', 'post')({}, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/projects/:id/members', () => {
  it('returns the member list', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'u1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/members', 'get')({ params: { id: 'p1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'u1' }] })
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/members', 'get')({ params: { id: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/projects/:id/members', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:id/members', 'post')({ params: { id: 'p1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('adds (or upgrades) a member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', role: 'admin' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/members', 'post')({ params: { id: 'p1' }, body: { user_id: 'u1', role: 'admin' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['u1', 'p1', 'admin'])
    expect(res.status).toHaveBeenCalledWith(201)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/members', 'post')({ params: { id: 'p1' }, body: { user_id: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('PUT /api/projects/:id/members/:userId', () => {
  it('400s on an invalid role', async () => {
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'put')({ params: { id: 'p1', userId: 'u1' }, body: { role: 'owner' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('updates the member role', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1', role: 'viewer' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'put')({ params: { id: 'p1', userId: 'u1' }, body: { role: 'viewer' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { user_id: 'u1', role: 'viewer' } })
  })

  it('404s when the member does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'put')({ params: { id: 'p1', userId: 'missing' }, body: { role: 'viewer' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'put')({ params: { id: 'p1', userId: 'u1' }, body: { role: 'viewer' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/projects/:id/members/:userId', () => {
  it('removes the member', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'u1' }] } as never)
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'delete')({ params: { id: 'p1', userId: 'u1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { deleted: { user_id: 'u1' } } })
  })

  it('404s when the member does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'delete')({ params: { id: 'p1', userId: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:id/members/:userId', 'delete')({ params: { id: 'p1', userId: 'u1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

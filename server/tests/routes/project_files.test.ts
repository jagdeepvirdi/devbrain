import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs   from 'fs/promises'
import fss  from 'fs'
import os   from 'os'
import path from 'path'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

import projectFilesRouter from '../../routes/project-files.js'
import { pool } from '../../db/pool.js'

const mockQuery = vi.mocked(pool.query)

function getHandler(routePath: string, method: 'get' | 'put') {
  const layer = (projectFilesRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods[method]
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

// Real filesystem, real fs.realpath — this route's whole job is safe path resolution
// against actual OS semantics, so mocking fs would let a broken containment check
// pass trivially. Only the DB lookup (fs_path for a project id) is mocked.

let root: string
let outside: string
let symlinkSupported = false

beforeAll(async () => {
  root    = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-pf-root-'))
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-pf-outside-'))

  await fs.writeFile(path.join(root, 'inside.txt'), 'hello from inside')
  await fs.mkdir(path.join(root, 'subdir'))
  await fs.writeFile(path.join(root, 'subdir', 'nested.txt'), 'nested content')
  await fs.mkdir(path.join(root, '.git'))
  await fs.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/master')
  await fs.writeFile(path.join(root, '.gitignore'), 'ignored.txt\n')
  await fs.writeFile(path.join(root, 'ignored.txt'), 'should not be listed')
  await fs.writeFile(path.join(root, 'binary.bin'), Buffer.from([0x00, 0x01, 0x02, 0xff]))
  await fs.writeFile(path.join(outside, 'secret.txt'), 'should never be reachable')

  try {
    await fs.symlink(outside, path.join(root, 'escape-link'), 'dir')
    symlinkSupported = true
  } catch {
    // Windows without Developer Mode/admin rejects symlink creation — skip those tests.
    symlinkSupported = false
  }
})

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true })
  await fs.rm(outside, { recursive: true, force: true })
})

beforeEach(() => vi.clearAllMocks())

function mockProject(fsPath: string | null | undefined) {
  if (fsPath === undefined) { mockQuery.mockResolvedValueOnce({ rows: [] } as any); return }
  mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: fsPath }] } as any)
}

describe('GET /api/project-files/:projectId (list)', () => {
  it('404s when the project does not exist', async () => {
    mockProject(undefined)
    const req: any = { params: { projectId: 'missing' }, query: {} }
    const res = fakeRes()

    await getHandler('/:projectId', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('400s when the project has no linked local path', async () => {
    mockProject(null)
    const req: any = { params: { projectId: 'p1' }, query: {} }
    const res = fakeRes()

    await getHandler('/:projectId', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('lists the root, excluding .git and .gitignore-matched entries', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: {} }
    const res = fakeRes()

    await getHandler('/:projectId', 'get')(req, res, () => {})

    const names = res.json.mock.calls[0][0].data.items.map((i: any) => i.name)
    expect(names).toContain('inside.txt')
    expect(names).toContain('subdir')
    expect(names).not.toContain('.git')
    expect(names).not.toContain('ignored.txt')
  })

  it('lists a subdirectory via ?path=', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'subdir' } }
    const res = fakeRes()

    await getHandler('/:projectId', 'get')(req, res, () => {})

    const items = res.json.mock.calls[0][0].data.items
    expect(items).toEqual([{ name: 'nested.txt', type: 'file', size: expect.any(Number) }])
  })

  it('rejects a path-traversal attempt instead of listing outside the project root', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: '../../../../../../etc' } }
    const res = fakeRes()

    await getHandler('/:projectId', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('GET /api/project-files/:projectId/content (read)', () => {
  it('400s when path is missing', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: {} }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the file does not exist', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'nope.txt' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('reads an existing file', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'inside.txt' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { path: 'inside.txt', content: 'hello from inside', size: expect.any(Number) } })
  })

  it('422s on a binary file', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'binary.bin' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
  })

  it('rejects a path-traversal attempt reaching a file outside the project root', async () => {
    mockProject(root)
    const relOutside = path.relative(root, path.join(outside, 'secret.txt')).split(path.sep).join('/')
    const req: any = { params: { projectId: 'p1' }, query: { path: relOutside } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })

  it.runIf(symlinkSupported)('rejects reading through a symlink that escapes the project root', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'escape-link/secret.txt' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'get')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })
})

describe('PUT /api/project-files/:projectId/content (write)', () => {
  it('400s on a validation error (content missing)', async () => {
    const req: any = { params: { projectId: 'p1' }, query: { path: 'inside.txt' }, body: {} }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'put')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('404s when the target file does not exist (no create-on-write)', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'brand-new.txt' }, body: { content: 'x' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'put')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    await expect(fs.stat(path.join(root, 'brand-new.txt'))).rejects.toThrow()
  })

  it('overwrites an existing file on disk', async () => {
    const target = path.join(root, 'writable.txt')
    fss.writeFileSync(target, 'original')
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: 'writable.txt' }, body: { content: 'updated content' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'put')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { path: 'writable.txt', size: expect.any(Number) } })
    expect(await fs.readFile(target, 'utf-8')).toBe('updated content')
  })

  it('rejects writing to a path that escapes the project root', async () => {
    mockProject(root)
    const req: any = { params: { projectId: 'p1' }, query: { path: '../outside-escape.txt' }, body: { content: 'pwned' } }
    const res = fakeRes()

    await getHandler('/:projectId/content', 'put')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
  })
})

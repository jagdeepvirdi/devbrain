import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn((s: string) => `enc:${s}`),
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

import gitRouter from '../../routes/git.js'
import { pool } from '../../db/pool.js'
import { exec } from 'node:child_process'
import { encrypt, decrypt } from '../../services/crypto.js'

const mockQuery = vi.mocked(pool.query)
const mockExec  = vi.mocked(exec)
const mockEncrypt = vi.mocked(encrypt)
const mockDecrypt = vi.mocked(decrypt)

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get' | 'post' | 'delete') {
  const layer = (gitRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method]
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

function mockExecOnce(err: Error | null, stdout: string) {
  mockExec.mockImplementationOnce(((_cmd: string, _opts: unknown, cb: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    cb(err, { stdout, stderr: '' })
  }) as never)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

describe('POST /api/git/:projectId/repo', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'p1' }, body: { repo_url: 'not-a-url' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s with "Nothing to update" for an empty body', async () => {
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'p1' }, body: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith({ error: 'Nothing to update' })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('updates only repo_url when github_pat is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', repo_url: 'https://github.com/o/r', has_pat: false }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'p1' }, body: { repo_url: 'https://github.com/o/r' } }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('repo_url = $2')
    expect(String(sql)).not.toContain('github_pat_enc =')
    expect(values).toEqual(['p1', 'https://github.com/o/r'])
    expect(mockEncrypt).not.toHaveBeenCalled()
  })

  it('encrypts and updates only the PAT when repo_url is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', has_pat: true }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'p1' }, body: { github_pat: 'ghp_secret' } }, res, () => {})
    expect(mockEncrypt).toHaveBeenCalledWith('ghp_secret')
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('github_pat_enc = $2')
    expect(values).toEqual(['p1', 'enc:ghp_secret'])
  })

  it('updates both fields with sequential placeholders', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({
      params: { projectId: 'p1' }, body: { repo_url: 'https://github.com/o/r', github_pat: 'ghp_secret' },
    }, res, () => {})
    const [sql, values] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('repo_url = $2, github_pat_enc = $3')
    expect(values).toEqual(['p1', 'https://github.com/o/r', 'enc:ghp_secret'])
  })

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'missing' }, body: { github_pat: 'x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'post')({ params: { projectId: 'p1' }, body: { github_pat: 'x' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/git/:projectId/repo', () => {
  it('returns the repo config', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1', repo_url: 'https://github.com/o/r', has_pat: true }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'get')({ params: { projectId: 'p1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { id: 'p1', repo_url: 'https://github.com/o/r', has_pat: true } })
  })

  it('404s when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'get')({ params: { projectId: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:projectId/repo', 'get')({ params: { projectId: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/git/:projectId/commits', () => {
  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'missing' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns [] when neither fs_path nor repo_url is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: null, github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('400s when repo_url is not a valid GitHub URL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://gitlab.com/o/r', github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s when repo_url is not a well-formed URL at all', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'not a url', github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('400s when the GitHub URL path has no repo segment', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/just-an-owner', github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('omits the commit url when repo_url is not configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: null, github_pat_enc: null, fs_path: '/repo' }] } as never)
    mockExecOnce(null, 'sha1|message1|author1|2026-01-01T00:00:00Z')
    const res = fakeRes()

    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({
      data: [{ sha: 'sha1', full_sha: 'sha1', message: 'message1', author: 'author1', date: '2026-01-01T00:00:00Z', url: null }],
    })
  })

  it('queries GitHub with no Authorization header when there is no stored PAT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/o/r', github_pat_enc: null, fs_path: null }] } as never)
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    vi.stubGlobal('fetch', mockFetch)

    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, fakeRes(), () => {})

    expect(mockDecrypt).not.toHaveBeenCalled()
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('decrypts the stored PAT and passes through a non-ok GitHub response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/o/r', github_pat_enc: 'enc:tok', fs_path: null }] } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: () => Promise.resolve('rate limited') }))
    const res = fakeRes()

    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})

    expect(mockDecrypt).toHaveBeenCalledWith('enc:tok')
    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith({ error: 'GitHub API 403: rate limited' })
  })

  it('clamps limit to 50', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: null, github_pat_enc: null, fs_path: '/repo' }] } as never)
    mockExecOnce(null, '')
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: { limit: '500' } }, res, () => {})
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('-n 50'), expect.anything(), expect.any(Function))
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:projectId/commits', 'get')({ params: { projectId: 'p1' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/git/:projectId/branches', () => {
  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/branches', 'get')({ params: { projectId: 'missing' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns [] when there is no linked fs_path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/branches', 'get')({ params: { projectId: 'p1' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: [] })
  })

  it('lists branches and the current branch', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repo' }] } as never)
    mockExecOnce(null, 'main\nfeature/x\n')
    mockExecOnce(null, 'main\n')
    const res = fakeRes()

    await getHandler('/:projectId/branches', 'get')({ params: { projectId: 'p1' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { branches: ['main', 'feature/x'], current: 'main' } })
  })

  it('responds 500 when the git command fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repo' }] } as never)
    mockExecOnce(new Error('not a git repo'), '')
    const res = fakeRes()
    await getHandler('/:projectId/branches', 'get')({ params: { projectId: 'p1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/git/:projectId/diff/:sha', () => {
  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/diff/:sha', 'get')({ params: { projectId: 'missing', sha: 'abc' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('400s when the project has no linked local path', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/diff/:sha', 'get')({ params: { projectId: 'p1', sha: 'abc' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('returns the diff text', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repo' }] } as never)
    mockExecOnce(null, 'diff --git a/x b/x\n+added line')
    const res = fakeRes()
    await getHandler('/:projectId/diff/:sha', 'get')({ params: { projectId: 'p1', sha: 'abc123' } }, res, () => {})
    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('git show abc123'), expect.anything(), expect.any(Function))
    expect(res.json).toHaveBeenCalledWith({ data: { diff: 'diff --git a/x b/x\n+added line' } })
  })

  it('responds 500 when the git command fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ fs_path: '/repo' }] } as never)
    mockExecOnce(new Error('bad sha'), '')
    const res = fakeRes()
    await getHandler('/:projectId/diff/:sha', 'get')({ params: { projectId: 'p1', sha: 'bad' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('POST /api/git/:projectId/link', () => {
  it('400s on an invalid body', async () => {
    const res = fakeRes()
    await getHandler('/:projectId/link', 'post')({ params: { projectId: 'p1' }, body: { sha: 'ab' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('links the commit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    const issueId = '11111111-1111-1111-1111-111111111111'
    await getHandler('/:projectId/link', 'post')({ params: { projectId: 'p1' }, body: { sha: 'abcdef1', issueId } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual([issueId, 'abcdef1', 'p1'])
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    const issueId = '11111111-1111-1111-1111-111111111111'
    await getHandler('/:projectId/link', 'post')({ params: { projectId: 'p1' }, body: { sha: 'abcdef1', issueId } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('DELETE /api/git/:projectId/link/:sha', () => {
  it('400s when issueId query param is missing', async () => {
    const res = fakeRes()
    await getHandler('/:projectId/link/:sha', 'delete')({ params: { projectId: 'p1', sha: 'abc' }, query: {} }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('unlinks the commit', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/link/:sha', 'delete')({ params: { projectId: 'p1', sha: 'abc' }, query: { issueId: 'i1' } }, res, () => {})
    expect(mockQuery.mock.calls[0][1]).toEqual(['i1', 'abc', 'p1'])
    expect(res.json).toHaveBeenCalledWith({ data: { ok: true } })
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:projectId/link/:sha', 'delete')({ params: { projectId: 'p1', sha: 'abc' }, query: { issueId: 'i1' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

describe('GET /api/git/:projectId/compare', () => {
  it('400s when base or head is missing', async () => {
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'main' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('404s when the project does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'missing' }, query: { base: 'a', head: 'b' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('uses local git when fs_path is set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: null, github_pat_enc: null, fs_path: '/repo' }] } as never)
    mockExecOnce(null, 'abc1234 First commit\ndef5678 Second commit\n')
    const res = fakeRes()

    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'main', head: 'feature' } }, res, () => {})

    expect(mockExec).toHaveBeenCalledWith(expect.stringContaining('git log main..feature'), expect.anything(), expect.any(Function))
    expect(res.json).toHaveBeenCalledWith({ data: { commits: 'abc1234 First commit\ndef5678 Second commit', count: 2 } })
  })

  it('falls back to repo_url when local git compare fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/o/r', github_pat_enc: null, fs_path: '/bad' }] } as never)
    mockExecOnce(new Error('bad refs'), '')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ commits: [{ sha: 'abcdef123', commit: { message: 'Fix bug\n\nDetails' } }] }),
    }))
    const res = fakeRes()

    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'main', head: 'feature' } }, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { commits: 'abcdef1 Fix bug', count: 1 } })
  })

  it('decrypts a stored PAT when falling back to the GitHub compare API', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/o/r', github_pat_enc: 'enc:tok', fs_path: '/bad' }] } as never)
    mockExecOnce(new Error('bad refs'), '')
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ commits: [] }) })
    vi.stubGlobal('fetch', mockFetch)

    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'main', head: 'feature' } }, fakeRes(), () => {})

    expect(mockDecrypt).toHaveBeenCalledWith('enc:tok')
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer tok')
  })

  it('returns an empty result when neither fs_path nor repo_url is configured', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: null, github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'a', head: 'b' } }, res, () => {})
    expect(res.json).toHaveBeenCalledWith({ data: { commits: '', count: 0 } })
  })

  it('400s when repo_url is not a valid GitHub URL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://gitlab.com/o/r', github_pat_enc: null, fs_path: null }] } as never)
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'a', head: 'b' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(400)
  })

  it('passes through a non-ok GitHub response', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ repo_url: 'https://github.com/o/r', github_pat_enc: null, fs_path: null }] } as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => Promise.resolve('not found') }))
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'a', head: 'b' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('responds 500 on a query failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const res = fakeRes()
    await getHandler('/:projectId/compare', 'get')({ params: { projectId: 'p1' }, query: { base: 'a', head: 'b' } }, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

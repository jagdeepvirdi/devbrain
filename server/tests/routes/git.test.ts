import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock pool and exec
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}))

vi.mock('../../services/crypto.js', () => ({
  encrypt: vi.fn(s => `enc:${s}`),
  decrypt: vi.fn(s => s.replace('enc:', '')),
}))

vi.mock('../../middleware/auth.js', () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}))

// Import router (we'll call its handlers directly for unit testing logic)
import router from '../../routes/git.js'
import { pool } from '../../db/pool.js'
import { exec } from 'node:child_process'

const mockQuery = vi.mocked(pool.query)
const mockExec  = vi.mocked(exec)

describe('Git Route Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('GET /commits — uses local git when fs_path is available', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ repo_url: 'https://github.com/org/repo', github_pat_enc: null, fs_path: '/local/path' }],
    } as any)

    mockExec.mockImplementation(((_cmd: string, _opts: any, cb: any) => {
      cb(null, { stdout: 'sha1|message1|author1|2026-01-01T00:00:00Z\nsha2|message2|author2|2026-01-02T00:00:00Z' })
    }) as any)

    const req = { params: { projectId: 'p1' }, query: {} }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    // Find the handler
    const handler = router.stack.find(s => s.route?.path === '/:projectId/commits' && (s.route as any)?.methods.get)?.route?.stack[0]?.handle
    await handler!(req as any, res as any, () => {})

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining('git log'),
      expect.objectContaining({ cwd: '/local/path' }),
      expect.any(Function)
    )
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { sha: 'sha1', full_sha: 'sha1', message: 'message1', author: 'author1', date: '2026-01-01T00:00:00Z', url: 'https://github.com/org/repo/commit/sha1' },
        { sha: 'sha2', full_sha: 'sha2', message: 'message2', author: 'author2', date: '2026-01-02T00:00:00Z', url: 'https://github.com/org/repo/commit/sha2' },
      ]
    })
  })

  it('GET /commits — falls back to GitHub API when local git fails', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ repo_url: 'https://github.com/org/repo', github_pat_enc: 'enc:token', fs_path: '/bad/path' }],
    } as any)

    mockExec.mockImplementation(((_cmd: string, _opts: any, cb: any) => {
      cb(new Error('Git not found'), { stdout: '' })
    }) as any)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { sha: 'sha_gh', commit: { message: 'gh_msg', author: { name: 'gh_auth', date: '2026-01-03Z' } }, html_url: 'url' }
      ])
    }))

    const req = { params: { projectId: 'p1' }, query: {} }
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() }

    const handler = router.stack.find(s => s.route?.path === '/:projectId/commits' && (s.route as any)?.methods.get)?.route?.stack[0]?.handle
    await handler!(req as any, res as any, () => {})

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('api.github.com'), expect.any(Object))
    expect(res.json).toHaveBeenCalledWith({
      data: [
        { sha: 'sha_gh', full_sha: 'sha_gh', message: 'gh_msg', author: 'gh_auth', date: '2026-01-03Z', url: 'url' }
      ]
    })
  })
})

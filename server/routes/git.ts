import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

function parseGitHubRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url)
    if (!u.hostname.includes('github.com')) return null
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/')
    if (parts.length < 2) return null
    return { owner: parts[0], repo: parts[1] }
  } catch { return null }
}

async function fetchGitHub(path: string, pat: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept:       'application/vnd.github.v3+json',
    'User-Agent': 'devbrain/1.0',
  }
  if (pat) headers.Authorization = `Bearer ${pat}`
  return fetch(`https://api.github.com${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  })
}

// ── POST /api/git/:projectId/repo  — save repo URL + optional PAT ──────────

const RepoBody = z.object({
  repo_url:   z.string().url().optional(),
  github_pat: z.string().optional(),  // plaintext — stored encrypted
})

router.post('/:projectId/repo', requireRole('editor'), async (req, res) => {
  const parsed = RepoBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const { repo_url, github_pat } = parsed.data
  const patEnc = github_pat ? encrypt(github_pat) : undefined

  try {
    const setClauses: string[] = []
    const values: unknown[]    = [req.params.projectId]
    let   idx = 2

    if (repo_url  !== undefined) { setClauses.push(`repo_url = $${idx++}`);       values.push(repo_url)   }
    if (patEnc    !== undefined) { setClauses.push(`github_pat_enc = $${idx++}`); values.push(patEnc)     }

    if (!setClauses.length) { res.status(400).json({ error: 'Nothing to update' }); return }

    const { rows } = await pool.query(
      `UPDATE projects SET ${setClauses.join(', ')} WHERE id = $1
       RETURNING id, repo_url, github_pat_enc IS NOT NULL AS has_pat`,
      values,
    )
    if (!rows.length) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/git/:projectId/repo  — get repo config (mask PAT) ─────────────

router.get('/:projectId/repo', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, repo_url, github_pat_enc IS NOT NULL AS has_pat FROM projects WHERE id = $1',
      [req.params.projectId],
    )
    if (!rows.length) { res.status(404).json({ error: 'Project not found' }); return }
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/git/:projectId/commits  — fetch recent commits ────────────────

router.get('/:projectId/commits', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 20), 50)

  try {
    const { rows } = await pool.query(
      'SELECT repo_url, github_pat_enc FROM projects WHERE id = $1',
      [req.params.projectId],
    )
    if (!rows.length) { res.status(404).json({ error: 'Project not found' }); return }

    const { repo_url, github_pat_enc } = rows[0] as { repo_url: string | null; github_pat_enc: string | null }
    if (!repo_url) { res.json({ data: [] }); return }

    const parsed = parseGitHubRepo(repo_url)
    if (!parsed) { res.status(400).json({ error: 'repo_url is not a valid GitHub URL' }); return }

    const pat = github_pat_enc ? decrypt(github_pat_enc) : null
    const ghRes = await fetchGitHub(
      `/repos/${parsed.owner}/${parsed.repo}/commits?per_page=${limit}`,
      pat,
    )
    if (!ghRes.ok) {
      const msg = await ghRes.text()
      res.status(ghRes.status).json({ error: `GitHub API ${ghRes.status}: ${msg.slice(0, 200)}` })
      return
    }

    const commits = await ghRes.json() as Array<{
      sha: string
      commit: { message: string; author: { name: string; date: string } }
      html_url: string
    }>

    res.json({
      data: commits.map(c => ({
        sha:      c.sha.slice(0, 7),
        full_sha: c.sha,
        message:  c.commit.message.split('\n')[0].slice(0, 120),
        author:   c.commit.author.name,
        date:     c.commit.author.date,
        url:      c.html_url,
      })),
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/git/:projectId/compare  — commits between two refs (for releases)

router.get('/:projectId/compare', async (req, res) => {
  const { base, head } = req.query as { base?: string; head?: string }
  if (!base || !head) { res.status(400).json({ error: 'base and head query params required' }); return }

  try {
    const { rows } = await pool.query(
      'SELECT repo_url, github_pat_enc FROM projects WHERE id = $1',
      [req.params.projectId],
    )
    if (!rows.length) { res.status(404).json({ error: 'Project not found' }); return }

    const { repo_url, github_pat_enc } = rows[0] as { repo_url: string | null; github_pat_enc: string | null }
    if (!repo_url) { res.json({ data: { commits: '', count: 0 } }); return }

    const parsed = parseGitHubRepo(repo_url)
    if (!parsed) { res.status(400).json({ error: 'repo_url is not a valid GitHub URL' }); return }

    const pat = github_pat_enc ? decrypt(github_pat_enc) : null
    const ghRes = await fetchGitHub(
      `/repos/${parsed.owner}/${parsed.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
      pat,
    )
    if (!ghRes.ok) {
      const msg = await ghRes.text()
      res.status(ghRes.status).json({ error: `GitHub API ${ghRes.status}: ${msg.slice(0, 200)}` })
      return
    }

    const data = await ghRes.json() as {
      commits: Array<{ sha: string; commit: { message: string } }>
    }
    const commitLog = data.commits
      .map(c => `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]}`)
      .join('\n')

    res.json({ data: { commits: commitLog, count: data.commits.length } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

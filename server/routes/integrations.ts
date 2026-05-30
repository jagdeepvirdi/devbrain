import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { encrypt, decrypt } from '../services/crypto.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// ── GET /api/integrations/config ──────────────────────────────────────────

router.get('/config', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, provider, project_id, external_project_id, token_enc IS NOT NULL AS has_token, last_synced_at, config 
       FROM integrations`,
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/integrations — create or update an integration ──────────────

const IntegrationBody = z.object({
  provider:            z.enum(['github', 'jira', 'linear']),
  project_id:          z.string().uuid(),
  external_project_id: z.string().min(1),
  token:               z.string().optional(),
  config:              z.record(z.unknown()).default({}),
})

router.post('/', requireRole('admin'), async (req, res) => {
  const parsed = IntegrationBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { provider, project_id, external_project_id, token, config } = parsed.data
  const tokenEnc = token ? encrypt(token) : null

  try {
    const { rows } = await pool.query(
      `INSERT INTO integrations (provider, project_id, external_project_id, token_enc, config)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (project_id, provider) DO UPDATE SET
         external_project_id = EXCLUDED.external_project_id,
         token_enc = COALESCE(EXCLUDED.token_enc, integrations.token_enc),
         config = EXCLUDED.config,
         updated_at = now()
       RETURNING id, provider, project_id, external_project_id, last_synced_at, config`,
      [provider, project_id, external_project_id, tokenEnc, config]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/integrations/:id ──────────────────────────────────────────

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM integrations WHERE id = $1', [req.params.id])
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/integrations/:id/sync ───────────────────────────────────────

router.post('/:id/sync', requireRole('editor'), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM integrations WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Integration not found' })

    const integration = rows[0]
    const token = integration.token_enc ? decrypt(integration.token_enc) : null

    let result = { created: 0, skipped: 0, total: 0 }

    if (integration.provider === 'github') {
      result = await syncGitHub(integration, token)
    } else if (integration.provider === 'jira') {
      result = await syncJira(integration, token)
    } else if (integration.provider === 'linear') {
      result = await syncLinear(integration, token)
    }

    await pool.query('UPDATE integrations SET last_synced_at = now() WHERE id = $1', [req.params.id])
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GitHub Sync ───────────────────────────────────────────────────────────

async function syncGitHub(integration: any, token: string | null) {
  const [owner, repo] = integration.external_project_id.split('/')
  const headers: any = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'devbrain' }
  if (token) headers['Authorization'] = `token ${token}`

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`, { headers })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)

  const issues = await res.json() as any[]
  let created = 0, skipped = 0

  for (const gh of issues) {
    if (gh.pull_request) continue // skip PRs

    const r = await pool.query(
      `INSERT INTO issues (project_id, title, description, status, priority, tags, source, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id`,
      [
        integration.project_id,
        gh.title,
        gh.body || '',
        gh.state === 'closed' ? 'resolved' : 'open',
        'medium', // GH issues don't have a direct priority field
        ['github', ...gh.labels.map((l: any) => l.name)],
        'github',
        `github:${gh.id}`
      ]
    )
    if (r.rowCount) created++; else skipped++
  }
  return { created, skipped, total: issues.length }
}

// ── Jira Sync ─────────────────────────────────────────────────────────────

async function syncJira(integration: any, token: string | null) {
  const { baseUrl, email } = integration.config
  const auth = Buffer.from(`${email}:${token}`).toString('base64')
  const jql = encodeURIComponent(`project = "${integration.external_project_id}" ORDER BY created DESC`)
  
  const res = await fetch(`${baseUrl}/rest/api/3/search?jql=${jql}&maxResults=100&fields=summary,description,priority,status`, {
    headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
  })
  if (!res.ok) throw new Error(`Jira API error: ${res.status}`)

  const data = await res.json() as any
  let created = 0, skipped = 0

  for (const ji of data.issues) {
    const r = await pool.query(
      `INSERT INTO issues (project_id, title, description, status, priority, tags, source, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id`,
      [
        integration.project_id,
        ji.fields.summary,
        ji.fields.description?.content?.[0]?.content?.[0]?.text || '', // Simplified v3 parser
        mapJiraStatus(ji.fields.status.name),
        mapJiraPriority(ji.fields.priority?.name),
        ['jira', ji.key],
        'jira',
        `jira:${ji.id}`
      ]
    )
    if (r.rowCount) created++; else skipped++
  }
  return { created, skipped, total: data.issues.length }
}

function mapJiraPriority(p?: string): string {
  const lp = (p ?? '').toLowerCase()
  if (lp.includes('critical') || lp.includes('blocker')) return 'critical'
  if (lp.includes('high') || lp.includes('major')) return 'high'
  if (lp.includes('low') || lp.includes('minor')) return 'low'
  return 'medium'
}

function mapJiraStatus(s: string): string {
  const ls = s.toLowerCase()
  if (ls.includes('done') || ls.includes('closed') || ls.includes('resolved')) return 'resolved'
  if (ls.includes('progress') || ls.includes('review')) return 'investigating'
  return 'open'
}

// ── Linear Sync ───────────────────────────────────────────────────────────

async function syncLinear(integration: any, token: string | null) {
  const teamKey = integration.external_project_id
  const query = `
    query($teamKey: String!, $first: Int!) {
      issues(filter: { team: { key: { eq: $teamKey } } }, first: $first, orderBy: createdAt) {
        nodes { id title description priority state { name } labels { nodes { name } } }
      }
    }`

  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': token! },
    body: JSON.stringify({ query, variables: { teamKey, first: 100 } })
  })
  if (!res.ok) throw new Error(`Linear API error: ${res.status}`)

  const d = await res.json() as any
  if (d.errors?.length) throw new Error(d.errors[0].message)
  
  const issues = d.data.issues.nodes
  let created = 0, skipped = 0

  for (const li of issues) {
    const r = await pool.query(
      `INSERT INTO issues (project_id, title, description, status, priority, tags, source, external_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         title = EXCLUDED.title,
         description = EXCLUDED.description,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING id`,
      [
        integration.project_id,
        li.title,
        li.description || '',
        mapLinearStatus(li.state.name),
        mapLinearPriority(li.priority),
        ['linear', ...li.labels.nodes.map((l: any) => l.name)],
        'linear',
        `linear:${li.id}`
      ]
    )
    if (r.rowCount) created++; else skipped++
  }
  return { created, skipped, total: issues.length }
}

function mapLinearPriority(p: number): string {
  if (p === 1) return 'critical'; if (p === 2) return 'high'; if (p === 4) return 'low'; return 'medium'
}

function mapLinearStatus(s: string): string {
  const ls = s.toLowerCase()
  if (ls.includes('done') || ls.includes('completed')) return 'resolved'
  if (ls.includes('progress') || ls.includes('review')) return 'investigating'
  return 'open'
}

export default router

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
      `SELECT key, value FROM app_settings WHERE key IN ('jira', 'linear')`,
    )
    const config: Record<string, unknown> = { jira: null, linear: null }
    for (const row of rows) {
      const v = row.value as Record<string, unknown>
      if (row.key === 'jira') {
        config.jira = { baseUrl: v.baseUrl, email: v.email, hasToken: !!v.apiTokenEnc }
      } else if (row.key === 'linear') {
        config.linear = { hasKey: !!v.apiKeyEnc }
      }
    }
    res.json({ data: config })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/integrations/config/jira ────────────────────────────────────

const JiraConfigBody = z.object({
  baseUrl:  z.string().url(),
  email:    z.string().email(),
  apiToken: z.string().min(1),
})

router.put('/config/jira', requireRole('admin'), async (req, res) => {
  const parsed = JiraConfigBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const value = {
    baseUrl:     parsed.data.baseUrl,
    email:       parsed.data.email,
    apiTokenEnc: encrypt(parsed.data.apiToken),
  }
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('jira', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(value)],
    )
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/integrations/config/linear ──────────────────────────────────

const LinearConfigBody = z.object({ apiKey: z.string().min(1) })

router.put('/config/linear', requireRole('admin'), async (req, res) => {
  const parsed = LinearConfigBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  const value = { apiKeyEnc: encrypt(parsed.data.apiKey) }
  try {
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('linear', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(value)],
    )
    res.json({ data: { ok: true } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/integrations/jira/preview ──────────────────────────────────

async function getJiraConfig() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'jira'`)
  if (!rows.length) throw new Error('Jira not configured — go to Settings > Integrations')
  const v = rows[0].value as { baseUrl: string; email: string; apiTokenEnc: string }
  return { baseUrl: v.baseUrl, email: v.email, token: decrypt(v.apiTokenEnc) }
}

const JiraImportBody = z.object({
  project_id:  z.string().optional(),
  jql:         z.string().default('order by created DESC'),
  max_results: z.number().int().min(1).max(100).default(50),
})

router.post('/jira/preview', requireRole('editor'), async (req, res) => {
  const parsed = JiraImportBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }
  try {
    const cfg  = await getJiraConfig()
    const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')
    const jiraRes = await fetch(
      `${cfg.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(parsed.data.jql)}&maxResults=${parsed.data.max_results}&fields=summary,priority,status`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!jiraRes.ok) { res.status(jiraRes.status).json({ error: `Jira API: ${jiraRes.status}` }); return }
    const data = await jiraRes.json() as { total: number; issues: Array<{ key: string; fields: { summary: string; priority: { name: string } | null; status: { name: string } } }> }
    res.json({ data: { total: data.total, issues: data.issues.map(i => ({ key: i.key, summary: i.fields.summary, priority: i.fields.priority?.name ?? 'Medium', status: i.fields.status.name })) } })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/jira/import', requireRole('editor'), async (req, res) => {
  const parsed = JiraImportBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }
  try {
    const cfg  = await getJiraConfig()
    const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')
    const jiraRes = await fetch(
      `${cfg.baseUrl}/rest/api/3/search?jql=${encodeURIComponent(parsed.data.jql)}&maxResults=${parsed.data.max_results}&fields=summary,description,priority,status`,
      { headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) },
    )
    if (!jiraRes.ok) { res.status(jiraRes.status).json({ error: `Jira API: ${jiraRes.status}` }); return }

    const data = await jiraRes.json() as { issues: Array<{ key: string; fields: { summary: string; priority: { name: string } | null; status: { name: string } } }> }

    function mapPriority(p?: string): string {
      const lp = (p ?? '').toLowerCase()
      if (lp.includes('critical') || lp.includes('blocker')) return 'critical'
      if (lp.includes('high')     || lp.includes('major'))   return 'high'
      if (lp.includes('low')      || lp.includes('minor') || lp.includes('trivial')) return 'low'
      return 'medium'
    }
    function mapStatus(s: string): string {
      const ls = s.toLowerCase()
      if (ls.includes('done') || ls.includes('closed') || ls.includes('resolved')) return 'resolved'
      if (ls.includes('progress') || ls.includes('review'))                         return 'investigating'
      if (ls.includes("won't") || ls.includes('wont') || ls.includes('duplicate')) return 'wont-fix'
      return 'open'
    }

    let created = 0, skipped = 0
    for (const ji of data.issues) {
      const r = await pool.query(
        `INSERT INTO issues (project_id, title, priority, status, tags)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [parsed.data.project_id ?? null, `[${ji.key}] ${ji.fields.summary}`, mapPriority(ji.fields.priority?.name), mapStatus(ji.fields.status.name), ['jira', ji.key]],
      )
      if ((r.rowCount ?? 0) > 0) created++; else skipped++
    }
    res.json({ data: { created, skipped, total: data.issues.length } })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ── POST /api/integrations/linear/preview + import ───────────────────────

async function getLinearConfig() {
  const { rows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'linear'`)
  if (!rows.length) throw new Error('Linear not configured — go to Settings > Integrations')
  return decrypt((rows[0].value as { apiKeyEnc: string }).apiKeyEnc)
}

const LinearImportBody = z.object({
  project_id:  z.string().optional(),
  team_key:    z.string().min(1),
  max_results: z.number().int().min(1).max(100).default(50),
})

const LINEAR_ISSUES_QUERY = `
  query($teamKey: String!, $first: Int!) {
    issues(filter: { team: { key: { eq: $teamKey } } }, first: $first, orderBy: createdAt) {
      nodes { id title priority state { name } labels { nodes { name } } }
    }
  }`

async function queryLinear(apiKey: string, teamKey: string, maxResults: number) {
  const r = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query: LINEAR_ISSUES_QUERY, variables: { teamKey, first: maxResults } }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!r.ok) throw new Error(`Linear API: ${r.status}`)
  const d = await r.json() as { data?: { issues: { nodes: Array<{ id: string; title: string; priority: number; state: { name: string }; labels: { nodes: { name: string }[] } }> } }; errors?: Array<{ message: string }> }
  if (d.errors?.length) throw new Error(d.errors[0].message)
  return d.data?.issues.nodes ?? []
}

router.post('/linear/preview', requireRole('editor'), async (req, res) => {
  const parsed = LinearImportBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }
  try {
    const apiKey  = await getLinearConfig()
    const issues  = await queryLinear(apiKey, parsed.data.team_key, parsed.data.max_results)
    res.json({ data: { total: issues.length, issues: issues.map(i => ({ id: i.id, title: i.title, state: i.state.name })) } })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

router.post('/linear/import', requireRole('editor'), async (req, res) => {
  const parsed = LinearImportBody.safeParse(req.body)
  if (!parsed.success) { res.status(400).json({ error: 'Validation error', issues: parsed.error.issues }); return }

  function mapPriority(p: number): string {
    if (p === 1) return 'critical'; if (p === 2) return 'high'; if (p === 4) return 'low'; return 'medium'
  }
  function mapStatus(s: string): string {
    const ls = s.toLowerCase()
    if (ls.includes('done') || ls.includes('completed'))          return 'resolved'
    if (ls.includes('progress') || ls.includes('review'))         return 'investigating'
    if (ls.includes('cancel')   || ls.includes('duplicate'))      return 'wont-fix'
    return 'open'
  }

  try {
    const apiKey = await getLinearConfig()
    const issues = await queryLinear(apiKey, parsed.data.team_key, parsed.data.max_results)
    let created = 0, skipped = 0
    for (const li of issues) {
      const tags = ['linear', ...li.labels.nodes.map((l: { name: string }) => l.name)]
      const r = await pool.query(
        `INSERT INTO issues (project_id, title, priority, status, tags)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [parsed.data.project_id ?? null, li.title, mapPriority(li.priority), mapStatus(li.state.name), tags],
      )
      if ((r.rowCount ?? 0) > 0) created++; else skipped++
    }
    res.json({ data: { created, skipped, total: issues.length } })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

export default router

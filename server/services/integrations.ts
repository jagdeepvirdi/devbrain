import { pool } from '../db/pool.js'

export async function syncGitHub(integration: any, token: string | null) {
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
        'medium',
        ['github', ...gh.labels.map((l: any) => l.name)],
        'github',
        `github:${gh.id}`
      ]
    )
    if (r.rowCount) created++; else skipped++
  }
  return { created, skipped, total: issues.length }
}

export async function syncJira(integration: any, token: string | null) {
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
        ji.fields.description?.content?.[0]?.content?.[0]?.text || '',
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

export async function syncLinear(integration: any, token: string | null) {
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

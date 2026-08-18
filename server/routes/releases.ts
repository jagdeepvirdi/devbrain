import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { aiChat } from '../services/ai.js'
import { requireRole } from '../middleware/auth.js'
import { deleteLinksFor } from '../services/links.js'
import { loadXlsx } from '../lib/xlsxCompat.js'

const router = Router()

const ReleaseBody = z.object({
  project_id:       z.string().min(1),
  version:          z.string().min(1).max(50).trim(),
  date:             z.string().min(1),   // YYYY-MM-DD
  type:             z.enum(['major', 'minor', 'patch', 'hotfix']).default('patch'),
  features:         z.array(z.string()).default([]),
  fixes:            z.array(z.string()).default([]),
  breaking_changes: z.array(z.string()).default([]),
  notes:            z.string().max(5000).trim().default(''),
  linked_issues:    z.array(z.string()).default([]),
  component:        z.string().max(200).trim().nullable().optional(),
})

// Fields allowed in PUT (project_id is immutable after creation)
const UPDATABLE = ['version', 'date', 'type', 'features', 'fixes', 'breaking_changes', 'notes', 'linked_issues', 'component']

// ── POST /api/releases/ai-generate ──────────────────────────────────────────
// Must come before /:id routes to avoid param collision on POST.

router.post('/ai-generate', requireRole('member'), async (req, res) => {
  const { commits } = req.body as { commits?: string }
  if (!commits?.trim()) return res.status(400).json({ error: 'commits is required' })

  const prompt = `Parse these git commit messages and categorize them into release notes.

Commit messages:
${commits}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "features": ["user-facing description of new feature"],
  "fixes": ["user-facing description of bug fix"],
  "breaking_changes": ["description of breaking change"],
  "notes": "1-2 sentence summary of this release"
}

Rules:
- features: new functionality, pages, endpoints, integrations
- fixes: bug fixes, error handling, performance improvements
- breaking_changes: API changes, removed features, schema changes
- Keep each item concise and user-facing (not technical git jargon)
- Return empty arrays if no items in that category`

  try {
    const raw = await aiChat(prompt,
      'You are a technical writer converting git commits into release notes. Return only valid JSON.'
    )

    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI returned no JSON object')

    const parsed = JSON.parse(match[0]) as {
      features: string[]
      fixes: string[]
      breaking_changes: string[]
      notes: string
    }
    res.json({ data: parsed })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/releases/compare ───────────────────────────────────────────────

function releaseContext(r: Record<string, unknown>): string {
  const lines: string[] = [`Version ${r.version as string} (${r.type as string}) — ${r.date as string}`]
  if (r.notes) lines.push(`Summary: ${r.notes as string}`)
  const features = r.features as string[]
  const fixes    = r.fixes    as string[]
  const breaking = r.breaking_changes as string[]
  if (features.length) lines.push(`Features:\n${features.map(f => `- ${f}`).join('\n')}`)
  if (fixes.length)    lines.push(`Fixes:\n${fixes.map(f => `- ${f}`).join('\n')}`)
  if (breaking.length) lines.push(`Breaking Changes:\n${breaking.map(b => `- ${b}`).join('\n')}`)
  return lines.join('\n\n')
}

router.post('/compare', requireRole('member'), async (req, res) => {
  const { id1, id2 } = req.body as { id1?: string; id2?: string }
  if (!id1 || !id2) return res.status(400).json({ error: 'id1 and id2 are required' })
  if (id1 === id2)  return res.status(400).json({ error: 'Select two different releases' })

  try {
    const [r1Res, r2Res] = await Promise.all([
      pool.query('SELECT * FROM releases WHERE id = $1', [id1]),
      pool.query('SELECT * FROM releases WHERE id = $1', [id2]),
    ])
    if (!r1Res.rows.length || !r2Res.rows.length)
      return res.status(404).json({ error: 'One or both releases not found' })

    const prompt = `Compare these two releases and summarize what changed between them.

=== Release A ===
${releaseContext(r1Res.rows[0])}

=== Release B ===
${releaseContext(r2Res.rows[0])}

Provide a concise Markdown summary covering: overall changes, new features, fixes, breaking changes, and upgrade notes for developers.`

    const summary = await aiChat(
      prompt,
      'You are a technical writer comparing software releases. Provide a clear, developer-friendly Markdown summary.'
    )
    res.json({ data: { summary } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/releases/:id/qa ─────────────────────────────────────────────────

router.post('/:id/qa', requireRole('member'), async (req, res) => {
  const { question } = req.body as { question?: string }
  if (!question?.trim()) return res.status(400).json({ error: 'question is required' })

  try {
    const { rows } = await pool.query('SELECT * FROM releases WHERE id = $1', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Release not found' })

    const answer = await aiChat(
      `Release notes:\n\n${releaseContext(rows[0])}\n\nQuestion: ${question.trim()}`,
      'You are a helpful assistant answering questions about a software release. Answer only from the provided release notes. Be concise and clear. Format in Markdown.'
    )
    res.json({ data: { answer } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/releases/import-git ────────────────────────────────────────────

const ImportGitBody = z.object({
  commits:    z.string().min(1),
  project_id: z.string().min(1),
  version:    z.string().min(1).max(50).trim(),
  date:       z.string().optional(),
  type:       z.enum(['major', 'minor', 'patch', 'hotfix']).default('patch'),
})

router.post('/import-git', requireRole('member'), async (req, res) => {
  const parsed = ImportGitBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { commits, project_id, version, date, type } = parsed.data
  const releaseDate = date ?? new Date().toISOString().split('T')[0]

  const prompt = `Parse these git commit messages and categorize them into release notes.

Commit messages:
${commits}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "features": ["user-facing description of new feature"],
  "fixes": ["user-facing description of bug fix"],
  "breaking_changes": ["description of breaking change"],
  "notes": "1-2 sentence summary of this release"
}

Rules:
- features: new functionality, pages, endpoints, integrations
- fixes: bug fixes, error handling, performance improvements
- breaking_changes: API changes, removed features, schema changes
- Keep each item concise and user-facing (not technical git jargon)
- Return empty arrays if no items in that category`

  try {
    const raw = await aiChat(prompt, 'You are a technical writer converting git commits into release notes. Return only valid JSON.')

    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI returned no JSON')

    const ai = JSON.parse(match[0]) as {
      features: string[]; fixes: string[]; breaking_changes: string[]; notes: string
    }

    const { rows } = await pool.query(
      `INSERT INTO releases
         (project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [project_id, version, releaseDate, type,
       ai.features ?? [], ai.fixes ?? [], ai.breaking_changes ?? [],
       ai.notes ?? '', []]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    const pgErr = err as { code?: string }
    if (pgErr.code === '23505') return res.status(409).json({ error: `Version ${version} already exists for this project` })
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/releases/draft ──────────────────────────────────────────────────
// Must come before /:id to avoid param collision.

const DraftBody = z.object({
  projectId: z.string().min(1),
  from:      z.string().min(1),
  to:        z.string().min(1),
  issueIds:  z.array(z.string()).optional(),
})

router.post('/draft', requireRole('member'), async (req, res) => {
  const parsed = DraftBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { projectId, from, to, issueIds } = parsed.data

  try {
    let issueRows: Array<{ title: string; resolution: string; tags: string[] }>
    if (issueIds && issueIds.length > 0) {
      const { rows } = await pool.query(
        `SELECT title, resolution, tags FROM issues WHERE id = ANY($1::text[])`,
        [issueIds]
      )
      issueRows = rows
    } else {
      const { rows } = await pool.query(
        `SELECT title, resolution, tags FROM issues
         WHERE project_id = $1 AND status = 'resolved'
           AND resolved_at >= $2 AND resolved_at <= $3`,
        [projectId, from, to]
      )
      issueRows = rows
    }

    if (!issueRows.length) {
      return res.status(422).json({ error: 'No resolved issues found in the given range' })
    }

    const issueList = issueRows
      .map(i => `- ${i.title}${i.resolution ? ` (Resolution: ${i.resolution})` : ''}`)
      .join('\n')

    const prompt = `Draft release notes based on these resolved issues:

${issueList}

Return ONLY a JSON object with this exact structure (no markdown, no explanation):
{
  "features": ["user-facing description of new feature or improvement"],
  "fixes": ["user-facing description of bug fix"],
  "breaking_changes": ["description of any breaking change"],
  "notes": "1-2 sentence overall summary of this release"
}

Rules:
- features: resolved issues that added functionality or improvements
- fixes: resolved issues that fixed bugs, errors, or problems
- breaking_changes: anything that changes existing behavior developers rely on
- Return empty arrays for categories with no items`

    const raw = await aiChat(prompt, 'You are a technical writer drafting release notes from resolved issues. Return only valid JSON.')

    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error('AI returned no JSON object')

    const ai = JSON.parse(match[0]) as {
      features: string[]; fixes: string[]; breaking_changes: string[]; notes: string
    }

    const today = new Date().toISOString().split('T')[0]
    res.json({
      data: {
        project_id:       projectId,
        version:          '',
        date:             today,
        type:             'patch' as const,
        features:         ai.features ?? [],
        fixes:            ai.fixes ?? [],
        breaking_changes: ai.breaking_changes ?? [],
        notes:            ai.notes ?? '',
        linked_issues:    issueIds ?? [],
      }
    })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/releases ────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const { projectId, component } = req.query as { projectId?: string; component?: string }

  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx = 1

  if (projectId) {
    conditions.push(`r.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (component) {
    conditions.push(`r.component = $${idx++}`)
    values.push(component)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS project_name, p.color AS project_color,
              COALESCE(li.issues, '[]'::json) AS linked_issue_details
       FROM releases r
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', i.id, 'title', i.title, 'issue_code', i.issue_code)) AS issues
         FROM issues i
         JOIN unnest(r.linked_issues) AS lid(id) ON i.id = lid.id
       ) li ON true
       ${where}
       ORDER BY r.date DESC, r.created_at DESC`,
      values
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/releases/components  (distinct values for autocomplete/filtering) ──
// Must be registered before GET /:id so "components" isn't swallowed as an id.

router.get('/components', async (req, res) => {
  try {
    const { rows } = await pool.query<{ component: string }>(
      req.query.projectId
        ? 'SELECT DISTINCT component FROM releases WHERE component IS NOT NULL AND project_id = $1 ORDER BY component'
        : 'SELECT DISTINCT component FROM releases WHERE component IS NOT NULL ORDER BY component',
      req.query.projectId ? [req.query.projectId] : []
    )
    res.json({ data: rows.map(r => r.component) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/releases/export  (download the current scope as .xlsx) ──────────
// Must be registered before GET /:id so "export" isn't swallowed as an id.
// Honors the same filters as GET / (projectId, component) so "export what
// I'm looking at" works without a separate selection step.

router.get('/export', async (req, res) => {
  const { projectId, component } = req.query as { projectId?: string; component?: string }

  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx = 1

  if (projectId) {
    conditions.push(`r.project_id = $${idx++}`)
    values.push(projectId)
  }
  if (component) {
    conditions.push(`r.component = $${idx++}`)
    values.push(component)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const { rows } = await pool.query(
      `SELECT r.version, r.date, r.type, r.component, p.name AS project_name,
              r.features, r.fixes, r.breaking_changes, r.notes, r.linked_issues
       FROM releases r
       JOIN projects p ON p.id = r.project_id
       ${where}
       ORDER BY r.date DESC, r.created_at DESC`,
      values
    )

    const XLSX = await loadXlsx()
    const sheetRows = rows.map(r => ({
      Version:            r.version,
      Date:               r.date, // plain YYYY-MM-DD text — see db/pool.ts's DATE type parser
      Type:               r.type,
      Component:          r.component ?? '',
      Project:            r.project_name,
      Features:           (r.features as string[]).join('\n'),
      Fixes:              (r.fixes as string[]).join('\n'),
      'Breaking Changes': (r.breaking_changes as string[]).join('\n'),
      Notes:              r.notes,
      'Linked Issues':    (r.linked_issues as string[]).join(', '),
    }))

    const ws = XLSX.utils.json_to_sheet(sheetRows)
    ws['!cols'] = [
      { wch: 26 }, { wch: 12 }, { wch: 8 }, { wch: 20 }, { wch: 18 },
      { wch: 40 }, { wch: 40 }, { wch: 30 }, { wch: 30 }, { wch: 20 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Releases')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer

    const date = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="devbrain-releases-${date}.xlsx"`)
    res.send(buf)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/releases/:id ────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS project_name, p.color AS project_color,
              COALESCE(li.issues, '[]'::json) AS linked_issue_details
       FROM releases r
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('id', i.id, 'title', i.title, 'issue_code', i.issue_code)) AS issues
         FROM issues i
         JOIN unnest(r.linked_issues) AS lid(id) ON i.id = lid.id
       ) li ON true
       WHERE r.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Release not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/releases ───────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = ReleaseBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues, component } = parsed.data

  try {
    const { rows } = await pool.query(
      `INSERT INTO releases
         (project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues, component)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues, component?.trim() || null]
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    const pgErr = err as { code?: string }
    if (pgErr.code === '23505') {
      return res.status(409).json({ error: `Version ${version} already exists for this project` })
    }
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PUT /api/releases/:id ────────────────────────────────────────────────────

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = ReleaseBody.partial().safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const fields = Object.keys(parsed.data).filter(k => UPDATABLE.includes(k))
  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })

  const setCols = fields.map((k, i) => `${k} = $${i + 2}`).join(', ')
  const values  = fields.map(k => (parsed.data as Record<string, unknown>)[k])

  try {
    const { rows } = await pool.query(
      `UPDATE releases SET ${setCols} WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    )
    if (!rows.length) return res.status(404).json({ error: 'Release not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/releases/:id ─────────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM releases WHERE id = $1 RETURNING id, version',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Release not found' })
    await deleteLinksFor('release', req.params.id as string)
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

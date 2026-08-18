import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { buildSetClause }  from '../lib/db.js'
import { requireRole } from '../middleware/auth.js'
import { deleteLinksFor } from '../services/links.js'
import { ISSUE_COLS, ISSUE_JOINS, embedIssueAsync } from '../services/issuesShared.js'
import issuesNotesRouter from './issues-notes.js'
import issuesAiRouter    from './issues-ai.js'

const router = Router()

// ── Zod schemas ───────────────────────────────────────────────────────────

const StepSchema = z.object({
  id:          z.string(),
  order:       z.number().int(),
  instruction: z.string().min(1),
  done:        z.boolean(),
})

const CreateBody = z.object({
  title:               z.string().min(1).max(300).trim(),
  description:         z.string().max(10000).trim().default(''),
  status:              z.enum(['open', 'investigating', 'resolved', 'wont-fix']).default('open'),
  priority:            z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  project_id:          z.string().nullable().optional(),
  tags:                z.array(z.string()).default([]),
  component:           z.string().max(200).trim().nullable().optional(),
  issue_code:          z.string().max(50).trim().nullable().optional(),
  investigation_steps: z.array(StepSchema).default([]),
})

const UpdateBody = z.object({
  title:               z.string().min(1).max(300).trim().optional(),
  description:         z.string().max(10000).optional(),
  status:              z.enum(['open', 'investigating', 'resolved', 'wont-fix']).optional(),
  priority:            z.enum(['low', 'medium', 'high', 'critical']).optional(),
  project_id:          z.string().nullable().optional(),
  tags:                z.array(z.string()).optional(),
  component:           z.string().max(200).trim().nullable().optional(),
  issue_code:          z.string().max(50).trim().nullable().optional(),
  investigation_steps: z.array(StepSchema).optional(),
  resolution:          z.string().max(5000).optional(),
  pr_url:              z.string().url().max(500).nullable().optional(),
})

// Helper to parse query parameters that can be arrays, single strings, or comma-separated values.
function parseArrayParam(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean)
  if (typeof val === 'string') {
    return val.split(',').map(v => v.trim()).filter(Boolean)
  }
  return [String(val).trim()]
}

const getArrayParam = (query: Record<string, unknown>, key: string): string[] => {
  const val = query[key] !== undefined ? query[key] : query[`${key}[]`]
  return parseArrayParam(val)
};

router.get('/', async (req, res) => {
  const projectIds = getArrayParam(req.query, 'projectIds')
  const projectId  = req.query.projectId as string | undefined
  if (projectId) {
    projectIds.push(projectId)
  }
  const statuses   = getArrayParam(req.query, 'status')
  const priorities = getArrayParam(req.query, 'priority')
  const tags       = getArrayParam(req.query, 'tags')
  const components = getArrayParam(req.query, 'component')
  const dateFrom   = req.query.dateFrom as string | undefined
  const dateTo     = req.query.dateTo as string | undefined
  const q          = ((req.query.q || req.query.search) as string | undefined)?.trim()

  const limit      = Math.min(Number(req.query.limit  ?? 25), 100)
  const offset     = Number(req.query.offset ?? 0)

  const conditions: string[] = []
  const values: unknown[] = []
  let idx = 1

  const finalProjectIds = Array.from(new Set(projectIds)).filter(id => id !== 'global')
  const includeGlobal = projectIds.includes('global')
  if (projectIds.length > 0) {
    if (includeGlobal && finalProjectIds.length > 0) {
      conditions.push(`(i.project_id = ANY($${idx++}) OR i.project_id IS NULL)`)
      values.push(finalProjectIds)
    } else if (includeGlobal) {
      conditions.push('i.project_id IS NULL')
    } else {
      conditions.push(`i.project_id = ANY($${idx++})`)
      values.push(finalProjectIds)
    }
  }

  if (statuses.length > 0) {
    conditions.push(`i.status = ANY($${idx++})`)
    values.push(statuses)
  }

  if (priorities.length > 0) {
    conditions.push(`i.priority = ANY($${idx++})`)
    values.push(priorities)
  }

  if (tags.length > 0) {
    conditions.push(`i.tags && $${idx++}::text[]`)
    values.push(tags)
  }

  if (components.length > 0) {
    conditions.push(`i.component = ANY($${idx++})`)
    values.push(components)
  }

  if (dateFrom) {
    conditions.push(`i.created_at >= $${idx++}::timestamptz`)
    values.push(dateFrom)
  }

  if (dateTo) {
    conditions.push(`i.created_at <= $${idx++}::timestamptz`)
    values.push(dateTo)
  }

  if (q) {
    conditions.push(`(i.tsv @@ plainto_tsquery('english', $${idx}) OR i.title ILIKE $${idx + 1} OR i.description ILIKE $${idx + 1} OR i.issue_code ILIKE $${idx + 1})`)
    values.push(q)
    values.push(`%${q}%`)
    idx += 2
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitIdx = idx
  const offsetIdx = idx + 1

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(DISTINCT i.id)::int AS n FROM issues i LEFT JOIN projects p ON p.id = i.project_id ${where}`, values),
      pool.query(
        `SELECT ${ISSUE_COLS}
         FROM issues i
         ${ISSUE_JOINS}
         ${where}
         GROUP BY i.id, p.name, p.color
         ORDER BY
           CASE i.priority
             WHEN 'critical' THEN 1
             WHEN 'high'     THEN 2
             WHEN 'medium'   THEN 3
             WHEN 'low'      THEN 4
           END,
           i.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...values, limit, offset]
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/related ───────────────────────────────────────────────

router.get('/related', async (req, res) => {
  const q     = ((req.query.q as string) || '').trim()
  const limit = Math.min(Number(req.query.limit ?? 3), 10)

  if (!q || q.length < 3) {
    res.json({ data: [] })
    return
  }

  try {
    const { rows } = await pool.query(
      `SELECT i.id, i.title, i.status, i.priority,
              p.name AS project_name, p.color AS project_color,
              ts_rank(i.tsv, plainto_tsquery('english', $1)) AS rank
       FROM issues i
       LEFT JOIN projects p ON p.id = i.project_id
       WHERE i.tsv @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC
       LIMIT $2`,
      [q, limit]
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/triage ───────────────────────────────────────────────────

router.get('/triage', async (req, res) => {
  const projectId = req.query.projectId as string | undefined

  try {
    const { rows: settingsRows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'notification_rules'`
    )
    const rules = settingsRows[0]?.value ?? {}
    const thresholdDays = Number(rules.stale_threshold_days ?? 14)

    const conditions = ["i.status IN ('open', 'investigating')"]
    const values: Array<string | number> = [thresholdDays]

    if (projectId === 'global') {
      conditions.push('i.project_id IS NULL')
    } else if (projectId) {
      conditions.push('i.project_id = $2')
      values.push(projectId)
    }

    const where = `WHERE ${conditions.join(' AND ')}`

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS},
              (i.updated_at < now() - ($1 || ' day')::interval) AS is_stale
       FROM issues i
       ${ISSUE_JOINS}
       ${where}
       GROUP BY i.id, p.name, p.color
       ORDER BY
         CASE i.priority
           WHEN 'critical' THEN 1
           WHEN 'high'     THEN 2
           WHEN 'medium'   THEN 3
           WHEN 'low'      THEN 4
         END ASC,
         i.updated_at ASC`,
      values
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── PATCH /api/issues/bulk ───────────────────────────────────────────────────

router.patch('/bulk', requireRole('member'), async (req, res) => {
  const { ids, action, value } = req.body
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required and cannot be empty' })
  }
  if (!['tag', 'status', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (action === 'tag') {
      if (!value || typeof value !== 'string') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'value must be a string tag name' })
      }
      await client.query(
        `UPDATE issues SET tags = array_append(tags, $1) WHERE id = ANY($2) AND NOT ($1 = ANY(tags))`,
        [value, ids]
      )
    } else if (action === 'status') {
      if (!value || typeof value !== 'string') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'value must be a string status name' })
      }
      const resolvedClause = value === 'resolved' ? ', resolved_at = now()' : ', resolved_at = NULL'
      await client.query(
        `UPDATE issues SET status = $1 ${resolvedClause} WHERE id = ANY($2)`,
        [value, ids]
      )
    } else if (action === 'delete') {
      await client.query(
        `DELETE FROM issues WHERE id = ANY($1)`,
        [ids]
      )
    }
    await client.query('COMMIT')
    res.json({ data: { success: true } })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── GET /api/issues/components  (distinct values for autocomplete/filtering) ──
// Must be registered before GET /:id so "components" isn't swallowed as an id.

router.get('/components', async (req, res) => {
  try {
    const { rows } = await pool.query<{ component: string }>(
      req.query.projectId
        ? 'SELECT DISTINCT component FROM issues WHERE component IS NOT NULL AND project_id = $1 ORDER BY component'
        : 'SELECT DISTINCT component FROM issues WHERE component IS NOT NULL ORDER BY component',
      req.query.projectId ? [req.query.projectId] : []
    )
    res.json({ data: rows.map(r => r.component) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/:id ───────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS}
       FROM issues i
       ${ISSUE_JOINS}
       WHERE i.id = $1
       GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues ──────────────────────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { title, description, status, priority, project_id, tags, component, issue_code, investigation_steps } = parsed.data

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO issues (project_id, title, description, status, priority, tags, component, issue_code)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [project_id ?? null, title, description, status, priority, tags, component?.trim() || null, issue_code?.trim() || null]
    )
    const issueId = rows[0].id

    for (const step of investigation_steps) {
      await client.query(
        `INSERT INTO issue_steps (id, issue_id, "order", instruction, done) VALUES ($1, $2, $3, $4, $5)`,
        [step.id, issueId, step.order, step.instruction, step.done]
      )
    }

    await client.query('COMMIT')

    // Fetch full issue row with aggregated steps/notes for the response
    const { rows: full } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [issueId]
    )
    res.status(201).json({ data: full[0] })
    embedIssueAsync(issueId, title, description)
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── PUT /api/issues/:id ───────────────────────────────────────────────────

const ISSUE_UPDATABLE_COLS = new Set(['title', 'description', 'status', 'priority', 'project_id', 'tags', 'component', 'issue_code', 'resolution', 'pr_url'])

router.put('/:id', requireRole('member'), async (req, res) => {
  const parsed = UpdateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data as Record<string, unknown>
  const newSteps = updates.investigation_steps as typeof parsed.data.investigation_steps | undefined

  // Scalar fields (exclude investigation_steps — handled separately via issue_steps table)
  const fields = Object.keys(updates).filter(k => ISSUE_UPDATABLE_COLS.has(k))
  if (!fields.length && newSteps === undefined) return res.status(400).json({ error: 'Nothing to update' })

  // Set resolved_at when marking resolved/unresolved
  let resolvedClause = ''
  if (updates.status === 'resolved') resolvedClause = ', resolved_at = now()'
  else if (updates.status)           resolvedClause = ', resolved_at = NULL'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // When only steps are changing, verify the issue exists first
    if (!fields.length && !resolvedClause && newSteps !== undefined) {
      const { rows: exist } = await client.query('SELECT id FROM issues WHERE id = $1', [req.params.id])
      if (!exist.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
    }

    // Update scalar columns when present
    if (fields.length || resolvedClause) {
      if (fields.length) {
        const { setClauses, params } = buildSetClause(fields, fields.map(k => updates[k]))
        const { rows } = await client.query(
          `UPDATE issues SET ${setClauses}${resolvedClause} WHERE id = $1 RETURNING id`,
          [req.params.id, ...params]
        )
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
      } else if (resolvedClause) {
        const { rows } = await client.query(
          `UPDATE issues SET updated_at = now()${resolvedClause} WHERE id = $1 RETURNING id`,
          [req.params.id]
        )
        if (!rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Issue not found' }) }
      }
    }

    // Replace steps atomically when provided
    if (newSteps !== undefined) {
      await client.query('DELETE FROM issue_steps WHERE issue_id = $1', [req.params.id])
      for (const step of newSteps) {
        await client.query(
          `INSERT INTO issue_steps (id, issue_id, "order", instruction, done) VALUES ($1, $2, $3, $4, $5)`,
          [step.id, req.params.id, step.order, step.instruction, step.done]
        )
      }
    }

    await client.query('COMMIT')

    const { rows: full } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!full.length) return res.status(404).json({ error: 'Issue not found' })
    res.json({ data: full[0] })
    if (updates.title || updates.description) {
      embedIssueAsync(full[0].id, full[0].title, full[0].description)
    }
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── DELETE /api/issues/:id ────────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM issues WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })
    await deleteLinksFor('issue', req.params.id as string)
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// Notes/commits sub-resources and AI/embedding endpoints — see routes/issues-notes.ts and
// routes/issues-ai.ts. Mounted after the routes above; safe regardless of order since every
// route in both sub-routers is either 2+ path segments or a POST-only bare route (see the
// comment on /suggest-tags in issues-ai.ts).
router.use(issuesNotesRouter)
router.use(issuesAiRouter)

export default router

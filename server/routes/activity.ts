import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import { weekBounds } from '../services/gitDigest.js'
import { generateDigests } from '../services/activityDigest.js'
import { LocalAIRequiredError } from '../lib/requireLocalAI.js'

const router = Router()

const Week = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'week must be YYYY-MM-DD')

const today = () => new Date().toISOString().slice(0, 10)

// ── GET /api/activity/digest?week=YYYY-MM-DD[&project_id=] ───────────────────
// Any date inside the week works; it is normalized to that week's Monday.

router.get('/digest', async (req, res) => {
  const q = z.object({ week: Week.optional(), project_id: z.string().min(1).optional() }).safeParse(req.query)
  if (!q.success) return res.status(400).json({ error: 'Validation error', issues: q.error.issues })

  let start: string
  try { start = weekBounds(q.data.week ?? today()).start }
  catch (err) { return res.status(400).json({ error: (err as Error).message }) }

  try {
    const params: unknown[] = [start]
    let where = 'd.week_start = $1'
    if (q.data.project_id) { params.push(q.data.project_id); where += ' AND d.project_id = $2' }
    const { rows } = await pool.query(
      `SELECT d.*, p.name AS project_name, p.short_name, p.color
         FROM activity_digests d JOIN projects p ON p.id = d.project_id
        WHERE ${where} ORDER BY p.name`,
      params,
    )
    res.json({ data: rows, week_start: start })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/activity/digest/generate ───────────────────────────────────────
// Generates (or regenerates — upsert) digests for every project with a linked
// fs_path, or just one when project_id is given. Per-project failures are
// reported in `errors` and do not abort the rest.

const GenerateBody = z.object({
  week:       Week.optional(),
  project_id: z.string().min(1).optional(),
})

router.post('/digest/generate', requireRole('member'), async (req, res) => {
  const parsed = GenerateBody.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  try {
    const result = await generateDigests(parsed.data.week ?? today(), { projectId: parsed.data.project_id })
    res.json({ data: { digests: result.digests, errors: result.errors } })
  } catch (err) {
    if (err instanceof LocalAIRequiredError) return res.status(400).json({ error: err.message })
    const msg = (err as Error).message
    res.status(msg.startsWith('week must') ? 400 : 500).json({ error: msg })
  }
})

export default router

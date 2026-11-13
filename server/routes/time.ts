import { Router } from 'express'
import { z }      from 'zod'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import {
  getTimeReport, importActivityWatch, importSessions, estimateGitHours, todayLocal,
  type ProjectResult,
} from '../services/timeTracking.js'
import { localDay } from '../lib/timeMath.js'

const router = Router()

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'must be a valid date')

const MAX_RANGE_DAYS = 366
const rangeDays = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000

const daysAgo = (n: number) => localDay(Date.now() - n * 86_400_000)

// ── GET /api/time?from&to&project_id&group ───────────────────────────────────

const ReportQuery = z.object({
  from:       Day.optional(),
  to:         Day.optional(),
  project_id: z.string().min(1).optional(),
  group:      z.enum(['day', 'week', 'month']).default('day'),
})

router.get('/', async (req, res) => {
  const q = ReportQuery.safeParse(req.query)
  if (!q.success) return res.status(400).json({ error: 'Validation error', issues: q.error.issues })

  const to   = q.data.to   ?? todayLocal()
  const from = q.data.from ?? daysAgo(29)
  if (from > to) return res.status(400).json({ error: 'from must be on or before to' })
  if (rangeDays(from, to) > MAX_RANGE_DAYS) return res.status(400).json({ error: `Range too large (max ${MAX_RANGE_DAYS} days)` })

  try {
    const report = await getTimeReport({ from, to, projectId: q.data.project_id, group: q.data.group })
    res.json({ data: { from, to, group: q.data.group, ...report } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/time/import ────────────────────────────────────────────────────
// ActivityWatch's URL is server-side config only (ACTIVITYWATCH_URL) — not accepted here.

const ImportBody = z.object({
  sources:       z.array(z.enum(['activitywatch', 'claude-session', 'git-estimate'])).min(1).default(['activitywatch', 'claude-session', 'git-estimate']),
  from:          Day.optional(),
  to:            Day.optional(),
  gap_hours:     z.number().min(0.1).max(24).optional(),
  credit_minutes: z.number().min(0).max(240).optional(),
})

router.post('/import', requireRole('member'), async (req, res) => {
  const b = ImportBody.safeParse(req.body ?? {})
  if (!b.success) return res.status(400).json({ error: 'Validation error', issues: b.error.issues })

  const to   = b.data.to   ?? todayLocal()
  const from = b.data.from ?? daysAgo(6)
  if (from > to) return res.status(400).json({ error: 'from must be on or before to' })
  if (rangeDays(from, to) > MAX_RANGE_DAYS) return res.status(400).json({ error: `Range too large (max ${MAX_RANGE_DAYS} days)` })

  const result: {
    activitywatch?: { days: number; entries: number } | { error: string }
    'claude-session'?: ProjectResult[]
    'git-estimate'?: ProjectResult[]
  } = {}

  try {
    const wanted = new Set(b.data.sources)
    // ActivityWatch first: git-estimate skips every day AW has data for.
    if (wanted.has('activitywatch')) {
      try { result.activitywatch = await importActivityWatch(from, to) }
      catch (err) { result.activitywatch = { error: (err as Error).message } }
    }
    if (wanted.has('claude-session')) result['claude-session'] = await importSessions()
    if (wanted.has('git-estimate')) {
      result['git-estimate'] = await estimateGitHours({
        gapMs:    b.data.gap_hours      !== undefined ? b.data.gap_hours * 3_600_000 : undefined,
        creditMs: b.data.credit_minutes !== undefined ? b.data.credit_minutes * 60_000 : undefined,
      })
    }
    res.json({ data: result })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── Mapping rules ────────────────────────────────────────────────────────────

const RuleBody = z.object({
  project_id: z.string().min(1),
  kind:       z.enum(['path', 'title', 'app', 'editor_project']),
  pattern:    z.string().trim().min(1).max(500),
  priority:   z.number().int().min(-1000).max(1000).default(0),
})

router.get('/rules', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, p.name AS project_name FROM time_mapping_rules r JOIN projects p ON p.id = r.project_id
        ORDER BY r.priority DESC, r.created_at`,
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.post('/rules', requireRole('member'), async (req, res) => {
  const b = RuleBody.safeParse(req.body)
  if (!b.success) return res.status(400).json({ error: 'Validation error', issues: b.error.issues })
  try {
    const { rows } = await pool.query(
      `INSERT INTO time_mapping_rules (project_id, kind, pattern, priority) VALUES ($1,$2,$3,$4) RETURNING *`,
      [b.data.project_id, b.data.kind, b.data.pattern, b.data.priority],
    )
    res.status(201).json({ data: rows[0] })
  } catch (err) {
    if ((err as { code?: string }).code === '23503') return res.status(404).json({ error: 'Project not found' })
    res.status(500).json({ error: (err as Error).message })
  }
})

router.delete('/rules/:id', requireRole('member'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(`DELETE FROM time_mapping_rules WHERE id = $1`, [req.params.id])
    if (!rowCount) return res.status(404).json({ error: 'Rule not found' })
    res.json({ data: { id: req.params.id } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

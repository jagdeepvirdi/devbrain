import { Router } from 'express'
import { pool } from '../db/pool.js'

const router = Router()

router.get('/', async (req, res) => {
  const pid = (req.query.projectId as string) || null

  // Build project filter fragment for each table
  const pf = (col = 'project_id') => pid ? `AND ${col} = $1` : ''
  const params = pid ? [pid] : []

  try {
    const [statsRes, openIssuesRes, favCmdsRes, releasesRes, projectsRes, activityRes] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*) FROM documents ${pid ? 'WHERE project_id = $1' : ''})::int        AS docs,
           (SELECT COUNT(*) FROM issues    WHERE status IN ('open','investigating') ${pf()})::int AS open_issues,
           (SELECT COUNT(*) FROM issues    ${pid ? 'WHERE project_id = $1' : ''})::int        AS total_issues,
           (SELECT COUNT(*) FROM commands  ${pid ? 'WHERE project_id = $1' : ''})::int        AS commands,
           (SELECT COUNT(*) FROM releases  ${pid ? 'WHERE project_id = $1' : ''})::int        AS releases,
           (SELECT COUNT(*) FROM runbooks  ${pid ? 'WHERE project_id = $1' : ''})::int        AS runbooks`,
        params
      ),
      pool.query(
        `SELECT i.id, i.title, i.status, i.priority, i.created_at,
                COALESCE(jsonb_array_length(i.investigation_steps), 0) AS step_count,
                p.name AS project_name, p.color AS project_color
         FROM issues i LEFT JOIN projects p ON p.id = i.project_id
         WHERE i.status IN ('open','investigating') ${pf('i.project_id')}
         ORDER BY
           CASE i.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
           i.created_at DESC
         LIMIT 5`,
        params
      ),
      pool.query(
        `SELECT c.id, c.title, c.command, c.language,
                p.name AS project_name, p.color AS project_color
         FROM commands c LEFT JOIN projects p ON p.id = c.project_id
         WHERE c.is_favorite = true ${pf('c.project_id')}
         ORDER BY c.last_used DESC NULLS LAST, c.created_at DESC LIMIT 6`,
        params
      ),
      pool.query(
        `SELECT r.id, r.version, r.date, r.type,
                COALESCE(array_length(r.features, 1), 0)  AS feature_count,
                COALESCE(array_length(r.fixes, 1), 0)     AS fix_count,
                p.id AS project_id, p.name AS project_name, p.color AS project_color
         FROM releases r LEFT JOIN projects p ON p.id = r.project_id
         ${pid ? 'WHERE r.project_id = $1' : ''}
         ORDER BY r.date DESC LIMIT 5`,
        params
      ),
      pid
        ? Promise.resolve({ rows: [] })
        : pool.query(
            `SELECT p.id, p.name, p.color, p.status, p.type, p.description,
                    (SELECT COUNT(*) FROM documents d WHERE d.project_id = p.id)::int                AS doc_count,
                    (SELECT COUNT(*) FROM issues   i WHERE i.project_id = p.id
                                                      AND i.status IN ('open','investigating'))::int AS open_issue_count,
                    (SELECT COUNT(*) FROM commands c WHERE c.project_id = p.id)::int                AS command_count,
                    (SELECT COUNT(*) FROM releases r WHERE r.project_id = p.id)::int                AS release_count
             FROM projects p ORDER BY p.name`
          ),
      pool.query(
        `SELECT type, id, label, project_name, project_color, created_at FROM (
           SELECT 'doc'     AS type, d.id, d.title  AS label, p.name AS project_name, p.color AS project_color, d.created_at
           FROM documents d LEFT JOIN projects p ON p.id = d.project_id
           WHERE ($1::text IS NULL OR d.project_id = $1)
           UNION ALL
           SELECT 'issue'   AS type, i.id, i.title,  p.name, p.color, i.created_at
           FROM issues i LEFT JOIN projects p ON p.id = i.project_id
           WHERE ($1::text IS NULL OR i.project_id = $1)
           UNION ALL
           SELECT 'command' AS type, c.id, c.title,  p.name, p.color, c.created_at
           FROM commands c LEFT JOIN projects p ON p.id = c.project_id
           WHERE ($1::text IS NULL OR c.project_id = $1)
           UNION ALL
           SELECT 'release' AS type, r.id, r.version, p.name, p.color, r.created_at
           FROM releases r LEFT JOIN projects p ON p.id = r.project_id
           WHERE ($1::text IS NULL OR r.project_id = $1)
           UNION ALL
           SELECT 'runbook' AS type, rb.id, rb.title, p.name, p.color, rb.created_at
           FROM runbooks rb LEFT JOIN projects p ON p.id = rb.project_id
           WHERE ($1::text IS NULL OR rb.project_id = $1)
         ) x ORDER BY created_at DESC LIMIT 15`,
        [pid ?? null]
      ),
    ])

    const s = statsRes.rows[0]
    res.json({
      data: {
        stats: {
          docs:        s.docs,
          openIssues:  s.open_issues,
          totalIssues: s.total_issues,
          commands:    s.commands,
          releases:    s.releases,
          runbooks:    s.runbooks,
        },
        openIssues:       openIssuesRes.rows,
        favoriteCommands: favCmdsRes.rows,
        recentReleases:   releasesRes.rows,
        projects:         projectsRes.rows,
        activity:         activityRes.rows,
      }
    })
  } catch (err) {
    console.error('dashboard error:', err)
    res.status(500).json({ error: 'Dashboard failed' })
  }
})

// ── Phase 22: Analytics endpoints ────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const pid = (req.query.projectId as string) || null
  const params = pid ? [pid] : []
  const pf = pid ? 'AND project_id = $1' : ''
  const pfI = pid ? 'AND i.project_id = $1' : ''

  try {
    const [openByProject, avgResolution, embeddingHealth, commandsThisWeek, staleIssues] = await Promise.all([
      pool.query(
        `SELECT p.id, p.name, p.color, COUNT(i.id)::int AS open_count
         FROM projects p
         LEFT JOIN issues i ON i.project_id = p.id AND i.status IN ('open', 'investigating')
         ${pid ? 'WHERE p.id = $1' : ''}
         GROUP BY p.id, p.name, p.color
         ORDER BY open_count DESC, p.name`,
        params
      ),
      pool.query(
        `SELECT p.id, p.name, p.color,
                ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 86400))::int AS avg_days
         FROM issues i JOIN projects p ON p.id = i.project_id
         WHERE i.status = 'resolved'
           AND i.resolved_at IS NOT NULL
           AND i.resolved_at > now() - interval '30 days'
           ${pfI}
         GROUP BY p.id, p.name, p.color
         ORDER BY avg_days DESC`,
        params
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE embedding_status = 'done')::int    AS done,
           COUNT(*) FILTER (WHERE embedding_status = 'pending')::int AS pending,
           COUNT(*) FILTER (WHERE embedding_status = 'failed')::int  AS failed,
           COALESCE(ARRAY_AGG(id) FILTER (WHERE embedding_status = 'failed'), '{}') AS failed_ids
         FROM documents
         ${pid ? 'WHERE project_id = $1' : ''}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS count FROM commands
         WHERE created_at > now() - interval '7 days'
         ${pf}`,
        params
      ),
      pool.query(
        `SELECT i.id, i.title, i.priority, i.created_at,
                p.name AS project_name, p.color AS project_color
         FROM issues i LEFT JOIN projects p ON p.id = i.project_id
         WHERE i.status IN ('open', 'investigating')
           AND i.created_at < now() - interval '14 days'
           AND NOT EXISTS (
             SELECT 1 FROM issue_notes n
             WHERE n.issue_id = i.id
               AND n.created_at > now() - interval '14 days'
           )
           ${pfI}
         ORDER BY i.created_at ASC
         LIMIT 10`,
        params
      ),
    ])

    const emb = embeddingHealth.rows[0] ?? { done: 0, pending: 0, failed: 0, failed_ids: [] }
    res.json({
      data: {
        openByProject:    openByProject.rows,
        avgResolution:    avgResolution.rows,
        embeddingHealth:  { done: emb.done, pending: emb.pending, failed: emb.failed, failedIds: emb.failed_ids as string[] },
        commandsThisWeek: commandsThisWeek.rows[0]?.count ?? 0,
        staleIssues:      staleIssues.rows,
      }
    })
  } catch (err) {
    console.error('dashboard/stats error:', err)
    res.status(500).json({ error: 'Dashboard stats failed' })
  }
})

router.get('/activity', async (req, res) => {
  const pid = (req.query.projectId as string) || null
  const params = pid ? [pid] : []
  const pf = pid ? 'AND project_id = $1' : ''

  try {
    const result = await pool.query(
      `WITH days AS (
         SELECT generate_series(
           date_trunc('day', now()) - interval '34 days',
           date_trunc('day', now()),
           interval '1 day'
         )::date AS day
       ),
       opened AS (
         SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS cnt
         FROM issues WHERE created_at >= now() - interval '35 days' ${pf}
         GROUP BY 1
       ),
       resolved AS (
         SELECT date_trunc('day', resolved_at)::date AS day, COUNT(*)::int AS cnt
         FROM issues
         WHERE resolved_at IS NOT NULL AND resolved_at >= now() - interval '35 days'
           AND status = 'resolved' ${pf}
         GROUP BY 1
       ),
       docs_added AS (
         SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS cnt
         FROM documents WHERE created_at >= now() - interval '35 days' ${pf}
         GROUP BY 1
       ),
       cmds_added AS (
         SELECT date_trunc('day', created_at)::date AS day, COUNT(*)::int AS cnt
         FROM commands WHERE created_at >= now() - interval '35 days' ${pf}
         GROUP BY 1
       )
       SELECT
         to_char(d.day, 'YYYY-MM-DD')                                            AS date,
         COALESCE(o.cnt, 0)                                                       AS issues_opened,
         COALESCE(r.cnt, 0)                                                       AS issues_resolved,
         COALESCE(da.cnt, 0)                                                      AS docs_added,
         COALESCE(ca.cnt, 0)                                                      AS commands_added,
         COALESCE(o.cnt, 0) + COALESCE(r.cnt, 0) + COALESCE(da.cnt, 0) + COALESCE(ca.cnt, 0) AS total
       FROM days d
       LEFT JOIN opened   o  ON o.day  = d.day
       LEFT JOIN resolved r  ON r.day  = d.day
       LEFT JOIN docs_added da ON da.day = d.day
       LEFT JOIN cmds_added ca ON ca.day = d.day
       ORDER BY d.day`,
      params
    )
    res.json({ data: result.rows })
  } catch (err) {
    console.error('dashboard/activity error:', err)
    res.status(500).json({ error: 'Dashboard activity failed' })
  }
})

// ── Issue throughput (opened/resolved per week, 12-week window) ──────────

router.get('/issue-throughput', async (req, res) => {
  const pid = (req.query.projectId as string) || null
  const params = pid ? [pid] : []
  const pf = pid ? 'AND project_id = $1' : ''

  try {
    const result = await pool.query(
      `WITH weeks AS (
         SELECT generate_series(
           date_trunc('week', now()) - interval '11 weeks',
           date_trunc('week', now()),
           interval '1 week'
         )::date AS week_start
       ),
       opened AS (
         SELECT date_trunc('week', created_at)::date AS week_start, COUNT(*)::int AS cnt
         FROM issues WHERE created_at >= now() - interval '12 weeks' ${pf}
         GROUP BY 1
       ),
       resolved AS (
         SELECT date_trunc('week', resolved_at)::date AS week_start, COUNT(*)::int AS cnt
         FROM issues
         WHERE resolved_at IS NOT NULL AND resolved_at >= now() - interval '12 weeks'
           AND status = 'resolved' ${pf}
         GROUP BY 1
       )
       SELECT
         to_char(w.week_start, 'YYYY-MM-DD') AS week,
         COALESCE(o.cnt, 0)                  AS opened,
         COALESCE(r.cnt, 0)                  AS resolved
       FROM weeks w
       LEFT JOIN opened   o ON o.week_start = w.week_start
       LEFT JOIN resolved r ON r.week_start = w.week_start
       ORDER BY w.week_start`,
      params
    )
    res.json({ data: result.rows })
  } catch (err) {
    console.error('dashboard/issue-throughput error:', err)
    res.status(500).json({ error: 'Issue throughput failed' })
  }
})

// ── Embedding health trend (global, last 30 days of hourly snapshots) ────

router.get('/embedding-health-trend', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT captured_at, pending, processing, done, failed
       FROM embedding_health_snapshots
       WHERE captured_at >= now() - interval '30 days'
       ORDER BY captured_at ASC`
    )
    res.json({ data: result.rows })
  } catch (err) {
    console.error('dashboard/embedding-health-trend error:', err)
    res.status(500).json({ error: 'Embedding health trend failed' })
  }
})

export default router

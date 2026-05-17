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

export default router

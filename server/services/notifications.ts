import { spawn } from 'child_process'
import { pool } from '../db/pool.js'


export async function createNotification(userId: string, params: {
  type: string
  title: string
  body: string
  entityType?: string
  entityId?: string
  channel?: string
  deliveryStatus?: string
}) {
  const { type, title, body, entityType, entityId, channel = 'in_app', deliveryStatus = 'delivered' } = params
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, channel, delivery_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, type, title, body, entityType ?? null, entityId ?? null, channel, deliveryStatus]
  )
  return rows[0]
}

export async function getUsersToNotify(projectId: string | null): Promise<string[]> {
  // Always notify active admins
  const { rows: admins } = await pool.query("SELECT id FROM users WHERE role = 'admin' AND is_active = true")
  const userIds = new Set(admins.map(u => u.id))

  if (projectId) {
    // Notify active members of the project
    const { rows: members } = await pool.query(`
      SELECT pm.user_id 
      FROM project_members pm
      JOIN users u ON u.id = pm.user_id
      WHERE pm.project_id = $1 AND u.is_active = true
    `, [projectId])
    for (const m of members) {
      userIds.add(m.user_id)
    }
  } else {
    // Global project, notify all active users
    const { rows: allUsers } = await pool.query("SELECT id FROM users WHERE is_active = true")
    for (const u of allUsers) {
      userIds.add(u.id)
    }
  }

  return Array.from(userIds)
}

export async function scanStaleIssues() {
  try {
    // Get notification rules from settings
    const { rows: settingsRows } = await pool.query(
      `SELECT value FROM app_settings WHERE key = 'notification_rules'`
    )
    const rules = settingsRows[0]?.value ?? {}
    const thresholdDays = Number(rules.stale_threshold_days ?? 14)
    
    if (rules.stale_issues_enabled === false) {
      return
    }

    const intervalStr = `${thresholdDays} days`

    // Find stale issues
    const { rows: staleIssues } = await pool.query(
      `SELECT i.id, i.title, i.project_id
       FROM issues i
       WHERE i.status IN ('open', 'investigating')
         AND i.created_at < now() - $1::interval
         AND NOT EXISTS (
           SELECT 1 FROM issue_notes n
           WHERE n.issue_id = i.id
             AND n.created_at > now() - $1::interval
         )`,
      [intervalStr]
    )

    for (const issue of staleIssues) {
      const userIds = await getUsersToNotify(issue.project_id)
      for (const userId of userIds) {
        // Check if user was already notified about this stale issue in the last 24 hours
        const { rows: existing } = await pool.query(
          `SELECT 1 FROM notifications
           WHERE user_id = $1
             AND type = 'stale_issue'
             AND entity_id = $2
             AND created_at > now() - interval '24 hours'`,
          [userId, issue.id]
        )

        if (existing.length === 0) {
          await createNotification(userId, {
            type: 'stale_issue',
            title: `Stale Issue: ${issue.title}`,
            body: `This issue has been open for more than ${thresholdDays} days with no updates.`,
            entityType: 'issue',
            entityId: issue.id
          })
        }
      }
    }
  } catch (err) {
    console.error('[Notification Scheduler] Error scanning stale issues:', err)
  }
}

export function startNotificationScheduler() {
  // Run once after 15s delay, then every hour
  setTimeout(() => {
    scanStaleIssues().catch(err => console.error('Error running scanStaleIssues:', err))
    setInterval(() => {
      scanStaleIssues().catch(err => console.error('Error running scanStaleIssues:', err))
    }, 60 * 60 * 1000)
  }, 15_000)
}

export function startDigestScheduler() {
  console.log('  digest-scheduler: starting Python background process...')
  const child = spawn('python', ['server/scripts/digest_scheduler.py'], {
    stdio: 'inherit',
    env: process.env
  })

  child.on('error', (err) => {
    console.error('[Digest Scheduler Process] Error:', err.message)
  })

  child.on('close', (code) => {
    console.log(`[Digest Scheduler Process] Exited with code ${code}`)
  })
}


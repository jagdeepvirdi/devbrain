import { spawn } from 'child_process'
import { pool } from '../db/pool.js'
import { decrypt } from './crypto.js'

export async function sendAppriseNotification(params: {
  userId: string
  title: string
  body: string
  level?: string // info, success, warning, error
  projectId?: string | null
}) {
  const { userId, title, body, level = 'info', projectId = null } = params

  // 1. Fetch enabled channels for this user
  const { rows: channels } = await pool.query(
    `SELECT * FROM notification_channels WHERE user_id = $1 AND enabled = true`,
    [userId]
  )

  const appriseUrls: string[] = []
  const channelNames: string[] = []

  if (channels.length > 0) {
    for (const chan of channels) {
      let allowed = true
      if (projectId) {
        const { rows: prefs } = await pool.query(
          `SELECT enabled FROM project_notification_prefs WHERE project_id = $1 AND channel_id = $2`,
          [projectId, chan.id]
        )
        if (prefs.length > 0) {
          allowed = prefs[0].enabled
        }
      }
      if (allowed) {
        try {
          appriseUrls.push(decrypt(chan.apprise_url))
          channelNames.push(chan.name)
        } catch (err) {
          console.error(`Failed to decrypt URL for channel ${chan.name}:`, err)
        }
      }
    }
  }

  if (appriseUrls.length === 0) {
    return []
  }

  // Deliver via Python script
  const results = await new Promise<{ sent: boolean; error?: string }>((resolve) => {
    const child = spawn('python', ['server/scripts/apprise_client.py'])
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data) => { stdout += data.toString() })
    child.stderr.on('data', (data) => { stderr += data.toString() })

    child.on('close', (code) => {
      if (code !== 0) {
        resolve({ sent: false, error: stderr.trim() || `Python exited with code ${code}` })
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim())
        resolve(parsed)
      } catch (err) {
        console.error('Failed to parse apprise_client.py output:', err)
        resolve({ sent: false, error: `Invalid JSON output: ${stdout.trim()}` })
      }
    })

    // Write input payload as JSON to stdin
    const payload = { title, body, level, apprise_urls: appriseUrls }
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })

  // Write results to database
  const status = results.sent ? 'sent' : 'failed'
  const errorMsg = results.error ? ` - Error: ${results.error}` : ''
  const finalBody = results.sent ? body : `${body}${errorMsg}`

  const insertedRows = []
  for (const name of channelNames) {
    const { rows } = await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, entity_type, entity_id, channel, delivery_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        userId,
        `external_${level}`,
        title,
        finalBody,
        projectId ? 'project' : null,
        projectId,
        name.toLowerCase(),
        status
      ]
    )
    insertedRows.push(rows[0])
  }

  return insertedRows
}

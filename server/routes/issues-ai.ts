import { Router } from 'express'
import { pool }   from '../db/pool.js'
import { aiChat, aiEmbed } from '../services/ai.js'
import { requireRole } from '../middleware/auth.js'
import { ISSUE_COLS, ISSUE_JOINS, embedIssueAsync } from '../services/issuesShared.js'

// AI- and embedding-touching endpoints for issues — split out of routes/issues.ts
// (TASKS.md Phase 39 Tier 2 god-file split). Mounted at the same /api/issues base as the
// main issues router. All routes here are either 2+ path segments (/:id/...) or POST-only
// bare routes (/suggest-tags) with no GET/PUT/DELETE /:id-shaped collision — see the
// registration-order note on /suggest-tags below, carried over from the original file.

const router = Router()

// ── GET /api/issues/:id/related-commands ─────────────────────────────────

router.get('/:id/related-commands', async (req, res) => {
  try {
    const { rows: issueRows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!issueRows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = issueRows[0]
    const queryText = [title, description].filter(Boolean).join('. ')
    const embedding = await aiEmbed(queryText)
    const vec = `[${embedding.join(',')}]`

    const { rows } = await pool.query(
      `SELECT c.id, c.title, c.command, c.language, c.description,
              p.name  AS project_name,
              p.color AS project_color,
              1 - (c.embedding <=> $1::vector) AS score
       FROM   commands c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE  c.embedding IS NOT NULL
       ORDER BY c.embedding <=> $1::vector
       LIMIT 5`,
      [vec]
    )
    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/suggest-steps ───────────────────────────────────

router.post('/:id/suggest-steps', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = rows[0]

    const prompt = `Issue title: ${title}
${description ? `Description: ${description}\n` : ''}
List 5 to 7 specific, actionable investigation steps a developer should follow to diagnose this issue.
Use backticks for code, commands, file paths, and identifiers.
Output only the numbered list, nothing else.`

    const raw = await aiChat(
      prompt,
      'You are a senior software engineer. Generate concise, actionable debugging steps. Respond with a numbered list only.'
    )

    const steps = raw
      .split('\n')
      .map(l => l.replace(/^\d+[\.\)]\s*/, '').trim())
      .filter(l => l.length > 4)

    res.json({ data: { steps } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── GET /api/issues/:id/related-docs ──────────────────────────────────────

router.get('/:id/related-docs', async (req, res) => {
  try {
    const { rows: issueRows } = await pool.query(
      'SELECT title, description FROM issues WHERE id = $1',
      [req.params.id]
    )
    if (!issueRows.length) return res.status(404).json({ error: 'Issue not found' })

    const { title, description } = issueRows[0]
    const queryText = [title, description].filter(Boolean).join('. ')

    const embedding = await aiEmbed(queryText)
    const vec = `[${embedding.join(',')}]`

    const { rows } = await pool.query(
      `SELECT doc_id, doc_title, file_type, project_name, project_color, excerpt, score
       FROM (
         SELECT DISTINCT ON (d.id)
           d.id                       AS doc_id,
           d.title                    AS doc_title,
           d.file_type,
           p.name                     AS project_name,
           p.color                    AS project_color,
           left(dc.content, 220)      AS excerpt,
           1 - (dc.embedding <=> $1::vector) AS score
         FROM document_chunks dc
         JOIN documents d  ON d.id = dc.document_id
         LEFT JOIN projects p ON p.id = d.project_id
         ORDER BY d.id, dc.embedding <=> $1::vector ASC
       ) best
       ORDER BY score DESC
       LIMIT 5`,
      [vec]
    )

    res.json({ data: rows })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/summarize ────────────────────────────────────────

router.post('/:id/summarize', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    const issue = rows[0]
    const steps  = (issue.investigation_steps as Array<{ instruction: string; done: boolean }>)
    const notes  = (issue.notes as Array<{ content: string; created_at: string }>)

    const prompt = `Issue: ${issue.title}

Description: ${issue.description || '(none)'}

Priority: ${issue.priority} | Status: ${issue.status}

Investigation steps (${steps.filter(s => s.done).length}/${steps.length} done):
${steps.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.instruction}`).join('\n') || '(none)'}

Notes (${notes.length}):
${notes.map(n => `- ${n.content}`).join('\n') || '(none)'}

Resolution: ${issue.resolution || '(none)'}

Please provide a concise summary of:
1. What the issue is about
2. Investigation progress
3. Current status and next steps (if unresolved) or what fixed it (if resolved)`

    const summary = await aiChat(prompt, 'You are a technical assistant helping summarize development issues. Be concise and clear. Format in Markdown.')

    await pool.query('UPDATE issues SET summary = $2 WHERE id = $1', [req.params.id, summary])
    res.json({ data: { summary } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/reembed ──────────────────────────────────────────

router.post('/:id/reembed', requireRole('member'), async (req, res) => {
  const id = req.params.id as string
  try {
    const { rows } = await pool.query(
      'SELECT id, title, description FROM issues WHERE id = $1', [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Issue not found' })

    embedIssueAsync(id, rows[0].title, rows[0].description)

    res.json({ data: { id, embedding_status: 'processing' } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/suggest-tags ────────────────────────────────────────────
// Suggests up to 5 tags from issue title + description using AI.
// Bare route, but POST-only — the main router has no POST /:id-shaped route, so this
// never collides regardless of mount order relative to it (see routes/issues.ts).

router.post('/suggest-tags', requireRole('member'), async (req, res) => {
  const { title, description } = req.body as { title?: string; description?: string }
  const text = [title, description].filter(Boolean).join(' ').trim()
  if (!text) return res.status(400).json({ error: 'title or description is required' })

  try {
    const raw = await aiChat(
      `Suggest up to 5 short, lowercase tags for a bug/issue with this title and description:\n"${text.slice(0, 500)}"\n\nReturn ONLY a JSON array of strings, e.g. ["auth","crash","ios"]. No explanation.`,
      'You are a tagging assistant. Return only a valid JSON array of short lowercase tags.'
    )
    const match = raw.match(/\[[\s\S]*\]/)
    const tags: string[] = match ? (JSON.parse(match[0]) as string[]).slice(0, 5) : []
    res.json({ data: { tags } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

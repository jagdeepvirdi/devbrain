import { Router } from 'express'
import { z }      from 'zod'
import crypto     from 'crypto'
import { pool }   from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import { ISSUE_COLS, ISSUE_JOINS } from '../services/issuesShared.js'

// Notes and commit-linking sub-resources of an issue — split out of routes/issues.ts
// (TASKS.md Phase 39 Tier 2 god-file split). Mounted at the same /api/issues base as the
// main issues router; every route here is 2+ path segments (/:id/notes, /:id/commits, ...)
// so there's no ordering conflict with the main router's bare /:id, /related, /triage routes
// regardless of mount order.

const router = Router()

const NoteBody = z.object({
  content: z.string().min(1).max(5000).trim(),
})

// ── POST /api/issues/:id/notes ────────────────────────────────────────────

router.post('/:id/notes', requireRole('member'), async (req, res) => {
  const parsed = NoteBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  try {
    // Verify issue exists first
    const { rows: check } = await pool.query('SELECT id FROM issues WHERE id = $1', [req.params.id])
    if (!check.length) return res.status(404).json({ error: 'Issue not found' })

    await pool.query(
      `INSERT INTO issue_notes (id, issue_id, content) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), req.params.id, parsed.data.content]
    )

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── DELETE /api/issues/:id/notes/:noteId ─────────────────────────────────

router.delete('/:id/notes/:noteId', requireRole('member'), async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM issue_notes WHERE id = $1 AND issue_id = $2',
      [req.params.noteId, req.params.id]
    )
    if (!rowCount) return res.status(404).json({ error: 'Note not found' })

    const { rows } = await pool.query(
      `SELECT ${ISSUE_COLS} FROM issues i ${ISSUE_JOINS} WHERE i.id = $1 GROUP BY i.id, p.name, p.color`,
      [req.params.id]
    )
    res.json({ data: rows[0] })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ── POST /api/issues/:id/commits — link a commit SHA ─────────────────────

router.post('/:id/commits', requireRole('member'), async (req, res) => {
  const { sha } = req.body as { sha?: string }
  if (!sha || !/^[0-9a-f]{4,40}$/i.test(sha)) {
    res.status(400).json({ error: 'sha must be a valid git SHA' }); return
  }
  try {
    // Get project_id for the issue
    const { rows: issue } = await pool.query('SELECT project_id FROM issues WHERE id = $1', [req.params.id])
    if (!issue.length) { res.status(404).json({ error: 'Issue not found' }); return }

    await pool.query(
      `INSERT INTO issue_commits (issue_id, sha, project_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (issue_id, sha) DO NOTHING`,
      [req.params.id, sha, issue[0].project_id]
    )

    const { rows } = await pool.query('SELECT sha FROM issue_commits WHERE issue_id = $1', [req.params.id])
    res.json({ data: rows.map(r => r.sha) })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

// ── DELETE /api/issues/:id/commits/:sha — unlink a commit ────────────────

router.delete('/:id/commits/:sha', requireRole('member'), async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM issue_commits WHERE issue_id = $1 AND sha = $2',
      [req.params.id, req.params.sha]
    )
    const { rows } = await pool.query('SELECT sha FROM issue_commits WHERE issue_id = $1', [req.params.id])
    res.json({ data: rows.map(r => r.sha) })
  } catch (err) { res.status(500).json({ error: (err as Error).message }) }
})

export default router

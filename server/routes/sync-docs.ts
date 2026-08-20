import { Router } from 'express'
import { z }      from 'zod'
import { pool }          from '../db/pool.js'
import { serverError }   from '../lib/errors.js'
import { syncProjectDocs } from '../services/codeSync.js'

const router = Router()

// ── POST /api/documents/sync-docs ─────────────────────────────────────────
// Docs counterpart to /api/documents/sync-code (see that route and
// services/codeSync.ts for the shared walk/dedup/batch-embed logic and the
// reasoning behind skipSummary). Bulk-imports/refreshes a linked project's
// markdown files into Documents (file_type='md') — everything except
// TASKS.md and sessions/*, which already have their own live-off-disk tabs
// (Tasks/Sessions) and would just go stale as a duplicate here.
//
// Same unauthenticated-by-construction reasoning as sync-code: no arbitrary
// filesystem access, only a project already linked in the DB. Mounted ahead
// of the global requireAuth middleware in index.ts with its own rate
// limiter. Called by the Claude Code SessionEnd hook alongside sync-code.

const SyncDocsBody = z.object({
  projectId: z.string().optional(),
  fsPath:    z.string().optional(),
}).refine(b => b.projectId || b.fsPath, { message: 'projectId or fsPath is required' })

router.post('/', async (req, res) => {
  const parsed = SyncDocsBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  const { projectId, fsPath } = parsed.data

  try {
    const { rows } = projectId
      ? await pool.query<{ id: string; fs_path: string | null }>('SELECT id, fs_path FROM projects WHERE id = $1', [projectId])
      : await pool.query<{ id: string; fs_path: string | null }>('SELECT id, fs_path FROM projects WHERE fs_path = $1', [fsPath])

    if (!rows.length) return res.status(404).json({ error: 'No linked project found' })
    if (!rows[0].fs_path) return res.status(422).json({ error: 'Project is not linked to a filesystem path' })

    const result = await syncProjectDocs(rows[0].id, rows[0].fs_path)
    res.json({ data: result })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

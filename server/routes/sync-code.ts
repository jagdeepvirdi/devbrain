import { Router } from 'express'
import { z }      from 'zod'
import { pool }          from '../db/pool.js'
import { serverError }   from '../lib/errors.js'
import { syncProjectCode } from '../services/codeSync.js'

const router = Router()

// ── POST /api/documents/sync-code ─────────────────────────────────────────
// Bulk-imports/refreshes a linked project's source files into Codes (see
// services/codeSync.ts for the walk/dedup/batch-embed logic). Called by the
// Claude Code SessionEnd hook (integrations/claude-code/src/hooks/
// session-end.ps1 / .sh) with the session's cwd — resolved to a project via
// fs_path, since the hook only ever knows the filesystem path, never
// DevBrain's internal project id. Also accepts projectId directly for a
// future manual "Import from linked folder" trigger from the Codes UI.
//
// Unauthenticated on purpose — same reasoning as /api/notify (see index.ts):
// local tooling/hooks have no browser session to carry a JWT, and this
// server may run with AUTH_PASSWORD set. Kept safe by construction rather
// than by a token: the caller can only trigger a sync for a project already
// linked in the DB (fs_path/projectId must match an existing row) — there's
// no way to point it at an arbitrary filesystem path. Mounted ahead of the
// global requireAuth middleware in index.ts, with its own rate limiter
// there (much lower than notify's — each call can trigger real embedding
// work across many files, not just a logged ping).
//
// Synchronous by design: the hook already calls this from a detached
// background job, so there's nothing here that needs to return before
// embedding finishes.

const SyncCodeBody = z.object({
  projectId: z.string().optional(),
  fsPath:    z.string().optional(),
}).refine(b => b.projectId || b.fsPath, { message: 'projectId or fsPath is required' })

router.post('/', async (req, res) => {
  const parsed = SyncCodeBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  const { projectId, fsPath } = parsed.data

  try {
    const { rows } = projectId
      ? await pool.query<{ id: string; fs_path: string | null }>('SELECT id, fs_path FROM projects WHERE id = $1', [projectId])
      : await pool.query<{ id: string; fs_path: string | null }>('SELECT id, fs_path FROM projects WHERE fs_path = $1', [fsPath])

    if (!rows.length) return res.status(404).json({ error: 'No linked project found' })
    if (!rows[0].fs_path) return res.status(422).json({ error: 'Project is not linked to a filesystem path' })

    const result = await syncProjectCode(rows[0].id, rows[0].fs_path)
    res.json({ data: result })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

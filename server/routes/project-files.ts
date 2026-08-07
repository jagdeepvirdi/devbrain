import { Router } from 'express'
import fs         from 'fs/promises'
import path       from 'path'
import { z }      from 'zod'
import ignore     from 'ignore'
import { pool }        from '../db/pool.js'
import { serverError } from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

// Generous for source files, well below the 50MB document-upload cap elsewhere — this is
// a live in-browser editor buffer (CodeMirror), not a bulk ingestion pipeline.
const MAX_FILE_BYTES = 2 * 1024 * 1024

// ── Path containment ────────────────────────────────────────────────────
// No existing precedent for this in the codebase (git.ts only ever passes fs_path
// itself as a whole-repo cwd, never combined with a user-supplied sub-path — see
// TASKS.md Phase 37). Two layers, both required:
//  1. Resolve the candidate against the project root and verify the result is still
//     inside it via path.relative — catches '..'-segment escapes.
//  2. Resolve *real* paths (following symlinks) for both root and candidate and
//     re-verify containment — catches a symlink planted inside the tree that points
//     outside it, which (1) alone would not catch. Walks up to the nearest existing
//     ancestor first since a fresh write target may not exist yet.

function isContained(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

async function realpathOrNearestAncestor(target: string): Promise<string> {
  try {
    return await fs.realpath(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    const parent = path.dirname(target)
    if (parent === target) throw err // hit filesystem root without finding anything real
    const realParent = await realpathOrNearestAncestor(parent)
    return path.join(realParent, path.relative(parent, target))
  }
}

async function resolveSafePath(fsRoot: string, relPath: string): Promise<string> {
  const root      = path.resolve(fsRoot)
  const candidate = path.resolve(root, relPath || '.')
  if (candidate !== root && !isContained(root, candidate)) throw new Error('Path escapes project root')

  const realRoot      = await fs.realpath(root)
  const realCandidate = await realpathOrNearestAncestor(candidate)
  if (realCandidate !== realRoot && !isContained(realRoot, realCandidate)) throw new Error('Path escapes project root (symlink)')

  return candidate
}

function looksBinary(buf: Buffer): boolean {
  // Same null-byte heuristic git itself uses to decide whether a file is text —
  // no binary/mime-sniffing library exists in this codebase yet (parser.ts dispatches
  // by extension only), so this is deliberately simple rather than pulling one in.
  return buf.subarray(0, Math.min(buf.length, 8000)).includes(0)
}

// undefined = project doesn't exist; null = project exists but has no linked path —
// callers need to tell these apart to return 404 vs. 400.
async function getFsRoot(projectId: string): Promise<string | null | undefined> {
  const { rows } = await pool.query('SELECT fs_path FROM projects WHERE id = $1', [projectId])
  if (!rows.length) return undefined
  return rows[0].fs_path ?? null
}

function queryPath(req: { query: Record<string, unknown> }): string {
  const raw = req.query.path
  return typeof raw === 'string' ? raw : ''
}

// ── GET /api/project-files/:projectId — list a directory ───────────────────
// ?path= is relative to the project's fs_path root; empty/omitted = root itself.
// .gitignore (root-level only — no cascading per-subdirectory resolution, a
// deliberate v1 simplification) plus .git itself are always excluded.

router.get('/:projectId', async (req, res) => {
  try {
    const fsRoot = await getFsRoot(req.params.projectId as string)
    if (fsRoot === undefined) return res.status(404).json({ error: 'Project not found' })
    if (fsRoot === null) return res.status(400).json({ error: 'Project has no linked local path' })

    let dirPath: string
    try {
      dirPath = await resolveSafePath(fsRoot, queryPath(req))
    } catch {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const stat = await fs.stat(dirPath).catch(() => null)
    if (!stat || !stat.isDirectory()) return res.status(404).json({ error: 'Directory not found' })

    const ig = ignore()
    try {
      ig.add(await fs.readFile(path.join(fsRoot, '.gitignore'), 'utf-8'))
    } catch { /* no root .gitignore — fine, list everything except .git */ }
    ig.add('.git')

    const relDir  = path.relative(fsRoot, dirPath)
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const items: { name: string; type: 'file' | 'dir'; size?: number }[] = []
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue // skip symlinks/sockets/etc.
      const entryRel = path.join(relDir, entry.name).split(path.sep).join('/')
      if (ig.ignores(entryRel)) continue
      if (entry.isDirectory()) {
        items.push({ name: entry.name, type: 'dir' })
      } else {
        const entryStat = await fs.stat(path.join(dirPath, entry.name)).catch(() => null)
        items.push({ name: entry.name, type: 'file', size: entryStat?.size })
      }
    }
    items.sort((a, b) => (a.type !== b.type ? (a.type === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)))

    res.json({ data: { path: relDir.split(path.sep).join('/'), items } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/project-files/:projectId/content — read a file ────────────────

router.get('/:projectId/content', async (req, res) => {
  try {
    const fsRoot = await getFsRoot(req.params.projectId as string)
    if (fsRoot === undefined) return res.status(404).json({ error: 'Project not found' })
    if (fsRoot === null) return res.status(400).json({ error: 'Project has no linked local path' })

    const relPath = queryPath(req)
    if (!relPath) return res.status(400).json({ error: 'path is required' })

    let filePath: string
    try {
      filePath = await resolveSafePath(fsRoot, relPath)
    } catch {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || !stat.isFile()) return res.status(404).json({ error: 'File not found' })
    if (stat.size > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `File too large to open (${(stat.size / 1024 / 1024).toFixed(1)}MB, limit ${MAX_FILE_BYTES / 1024 / 1024}MB)` })
    }

    const buf = await fs.readFile(filePath)
    if (looksBinary(buf)) return res.status(422).json({ error: 'This looks like a binary file — cannot open as text' })

    res.json({ data: { path: relPath, content: buf.toString('utf-8'), size: stat.size } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PUT /api/project-files/:projectId/content — write a file ───────────────
// Only overwrites a file that already exists — creating brand-new files/directories
// from the browser is out of scope for v1 (keeps the risk surface to "edit what's
// already there", not "silently add new tracked-or-not files a `git status` wouldn't
// expect").

const WriteBody = z.object({ content: z.string() })

router.put('/:projectId/content', requireRole('member'), async (req, res) => {
  const parsed = WriteBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  try {
    const fsRoot = await getFsRoot(req.params.projectId as string)
    if (fsRoot === undefined) return res.status(404).json({ error: 'Project not found' })
    if (fsRoot === null) return res.status(400).json({ error: 'Project has no linked local path' })

    const relPath = queryPath(req)
    if (!relPath) return res.status(400).json({ error: 'path is required' })

    let filePath: string
    try {
      filePath = await resolveSafePath(fsRoot, relPath)
    } catch {
      return res.status(400).json({ error: 'Invalid path' })
    }

    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat || !stat.isFile()) {
      return res.status(404).json({ error: 'File not found — this editor can only update existing files, not create new ones' })
    }

    const { content } = parsed.data
    const bytes = Buffer.byteLength(content, 'utf-8')
    if (bytes > MAX_FILE_BYTES) {
      return res.status(413).json({ error: `Content too large to save (${(bytes / 1024 / 1024).toFixed(1)}MB, limit ${MAX_FILE_BYTES / 1024 / 1024}MB)` })
    }

    await fs.writeFile(filePath, content, 'utf-8')
    res.json({ data: { path: relPath, size: bytes } })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

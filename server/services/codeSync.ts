import fs      from 'fs/promises'
import path    from 'path'
import crypto  from 'crypto'
import ignore  from 'ignore'
import { pool } from '../db/pool.js'
import { parseFile, CODE_EXT_LANGUAGE } from './parser.js'
import { embedDocumentsBatch } from './embedder.js'

// ── Sync a project's linked git folder into tracked Codes/Documents rows ───
//
// Two entry points share the same walk/dedup/batch-embed core:
//   syncProjectCode() — source files -> Codes (file_type='code')
//   syncProjectDocs() — markdown files -> Documents (file_type='md'), except
//                       TASKS.md and anything under sessions/, which already
//                       have their own live-off-disk tabs (Tasks/Sessions) —
//                       tracking them here too would just be a stale duplicate
//                       of something already fresher elsewhere.
// Both never delete: a file removed from the repo just stops being touched by
// future syncs, its tracked doc (and any explanation/diagram/tags a user
// added) is left alone rather than silently disappearing from a background
// job. Both run after every Claude Code session ends (see
// integrations/claude-code/src/hooks/session-end.ps1) via
// POST /api/documents/sync-code and POST /api/documents/sync-docs.
//
// GPU safety: batches every new/changed file through embedDocumentsBatch with
// skipSummary — same phase-separated approach used by bulk re-embed, minus
// the mistral summarization step. Necessary, not just an optimization: 18
// short files with summaries on took 30+ minutes (see embedDocumentsBatch's
// skipSummary doc comment), and a real project's docs alone (e.g. devbrain's
// own repo) can be 60+ markdown files once test-report/log noise is
// excluded — unaffordable per-session background cost with mistral in the
// loop. The tradeoff: no document-level AI summary chunk for these (still
// fully chunked/embedded/searchable, just without that one extra abstract-
// style chunk), and — unlike Codes — Documents has no manual "Explain with
// AI" to backfill it later (documents-ai.ts's explain/diagram routes are
// gated to file_type='code' only).

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

// Noise directories skipped unconditionally, on top of whatever the repo's
// own root .gitignore already excludes — generated/vendored/cache dirs that
// either aren't gitignored in every repo (e.g. a committed vendor/ folder) or
// would just be slow and pointless to walk into (.git itself). playwright-
// report/test-results matter specifically for the docs sync: Playwright
// writes dozens of throwaway error-context.md snapshot files per run — real
// noise, not documentation (found scanning devbrain's own repo: 68 apparent
// "*.md" files, ~50 of which were exactly this).
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor',
  '__pycache__', 'venv', '.venv', 'target', 'bin', 'obj',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.turbo', '.cache',
  'sessions', // DevBrain's own session logs — live in the Sessions tab already
  'playwright-report', 'test-results',
])

// Anything else starting with '.' (.git, .astro, .next, .idea, .vscode,
// .code-review-graph, .github, ...) is noise for this kind of sync too.
function isSkippedDir(name: string): boolean {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

const MAX_FILE_BYTES = 1 * 1024 * 1024 // generous for source/docs, excludes stray bundled/minified files

type WalkFile = { absPath: string; relPath: string }

// `isEligible` decides which files to collect — checked against the file's
// extension and basename, not the whole path, so callers don't need to
// reimplement directory-noise filtering.
async function walkRepoFiles(
  root: string,
  isEligible: (ext: string, basename: string) => boolean
): Promise<WalkFile[]> {
  const ig = ignore()
  try {
    ig.add(await fs.readFile(path.join(root, '.gitignore'), 'utf-8'))
  } catch { /* no root .gitignore — fine, walk everything except SKIP_DIRS */ }

  const out: WalkFile[] = []

  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isFile()) continue // symlinks etc.

      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (ig.ignores(rel)) continue

      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) continue
        await walk(abs)
        continue
      }

      const ext = path.extname(entry.name).toLowerCase().slice(1)
      if (!isEligible(ext, entry.name)) continue

      out.push({ absPath: abs, relPath: rel })
    }
  }

  await walk(root)
  return out
}

export type SyncResult = {
  projectId: string
  scanned:   number
  created:   number
  updated:   number
  skipped:   number
  failed:    number
  errors:    { path: string; message: string }[]
}

async function syncProjectFiles(
  projectId: string,
  fsRoot: string,
  opts: {
    fileType:    'code' | 'md'
    isEligible:  (ext: string, basename: string) => boolean
    extraTags:   string[]
  }
): Promise<SyncResult> {
  const result: SyncResult = { projectId, scanned: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] }

  const files = await walkRepoFiles(fsRoot, opts.isEligible)
  result.scanned = files.length

  // Existing tracked docs of this file_type for this project, keyed by their
  // stored relative path (`source`) — lets us tell "new file" from "changed
  // file" from "unchanged, skip" without re-reading content for files we
  // already have. embedding_status matters too, not just content_hash: a doc
  // whose embedding never finished (server restart, killed request, wedged
  // DB connection, etc. mid-sync) can have a correct content_hash and even
  // some real chunks already written — embedDocumentsBatch's Phase 3 inserts
  // progressively, one document at a time — but never got flipped to 'done',
  // since that only happens after the whole batch completes. Matching on
  // hash alone would skip such a document forever with a silently
  // incomplete/stale chunk set; only 'done' means the embedding actually
  // finished.
  const { rows: existing } = await pool.query<{ id: string; source: string; content_hash: string | null; embedding_status: string }>(
    `SELECT id, source, content_hash, embedding_status FROM documents WHERE project_id = $1 AND file_type = $2`,
    [projectId, opts.fileType]
  )
  const bySource = new Map(existing.map(d => [d.source, d]))

  type PendingDoc = { id: string; content: string; title: string; language: string | null; isNew: boolean }
  const pending: PendingDoc[] = []

  for (const file of files) {
    try {
      const stat = await fs.stat(file.absPath)
      if (stat.size > MAX_FILE_BYTES) { result.skipped++; continue }

      const { text, language } = await parseFile(file.absPath, file.relPath)
      if (!text) { result.skipped++; continue }

      const hash = sha256(text)
      const match = bySource.get(file.relPath)

      if (match) {
        if (match.content_hash === hash && match.embedding_status === 'done') { result.skipped++; continue }
        await pool.query(
          `UPDATE documents SET content = $2, content_hash = $3, language = $4, embedding_status = 'processing' WHERE id = $1`,
          [match.id, text, hash, language ?? null]
        )
        pending.push({ id: match.id, content: text, title: file.relPath, language: language ?? null, isNew: false })
      } else {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO documents (project_id, title, file_type, content, tags, source, content_hash, language, embedding_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'processing') RETURNING id`,
          [projectId, file.relPath, opts.fileType, text, opts.extraTags, file.relPath, hash, language ?? null]
        )
        pending.push({ id: rows[0].id, content: text, title: file.relPath, language: language ?? null, isNew: true })
      }
    } catch (err) {
      result.failed++
      result.errors.push({ path: file.relPath, message: (err as Error).message })
    }
  }

  if (pending.length > 0) {
    // skipSummary: true — see the module doc comment above for why this
    // isn't optional here.
    const batchResults = await embedDocumentsBatch(
      pending.map(p => ({ id: p.id, content: p.content, title: p.title, language: p.language })),
      undefined,
      { skipSummary: true }
    )
    const failedIds = new Set<string>()
    for (const r of batchResults) {
      if (r.error) {
        failedIds.add(r.id)
        const p = pending.find(x => x.id === r.id)
        result.failed++
        result.errors.push({ path: p?.title ?? r.id, message: r.error })
      }
    }
    await pool.query(
      `UPDATE documents SET embedding_status = 'done' WHERE id = ANY($1)`,
      [pending.filter(p => !failedIds.has(p.id)).map(p => p.id)]
    )
    await pool.query(
      `UPDATE documents SET embedding_status = 'failed' WHERE id = ANY($1)`,
      [[...failedIds]]
    )
    for (const p of pending) {
      if (failedIds.has(p.id)) continue
      if (p.isNew) result.created++
      else result.updated++
    }
  }

  return result
}

export async function syncProjectCode(projectId: string, fsRoot: string): Promise<SyncResult> {
  return syncProjectFiles(projectId, fsRoot, {
    fileType:   'code',
    isEligible: ext => ext in CODE_EXT_LANGUAGE,
    extraTags:  ['code', 'git-sync'],
  })
}

export async function syncProjectDocs(projectId: string, fsRoot: string): Promise<SyncResult> {
  return syncProjectFiles(projectId, fsRoot, {
    fileType:   'md',
    isEligible: (ext, basename) => ext === 'md' && basename !== 'TASKS.md',
    extraTags:  ['git-sync'],
  })
}

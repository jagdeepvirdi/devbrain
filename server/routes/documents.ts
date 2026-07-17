import { Router }   from 'express'
import multer        from 'multer'
import fs            from 'fs/promises'
import os            from 'os'
import path          from 'path'
import crypto        from 'crypto'
import dns           from 'node:dns/promises'
import { z }         from 'zod'
import * as ipaddr   from 'ipaddr.js'
import { pool }          from '../db/pool.js'
import { parseFile, parseUrl } from '../services/parser.js'
import { aiChat }    from '../services/ai.js'
import { buildSetClause }   from '../lib/db.js'
import { serverError }        from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'
import { embedDocument } from '../services/embedder.js'
import { deleteLinksFor } from '../services/links.js'
import { extractSymbolOutline } from '../services/codeChunker.js'

const router = Router()

// ── Multer: temp disk storage ─────────────────────────────────────────────

const upload = multer({
  dest:   path.join(os.tmpdir(), 'devbrain-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
})

// ── Helpers ───────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

// Returns true if the URL resolves to a private/loopback address (SSRF guard)
async function isPrivateUrl(urlStr: string): Promise<boolean> {
  let hostname: string
  try { hostname = new URL(urlStr).hostname } catch { return true }
  try {
    const { address } = await dns.lookup(hostname)
    const addr = ipaddr.parse(address)
    return addr.range() !== 'unicast'
  } catch {
    return true  // treat DNS failures as unsafe
  }
}

// Helper to parse query parameters that can be arrays, single strings, or comma-separated values.
function parseArrayParam(val: unknown): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean)
  if (typeof val === 'string') {
    return val.split(',').map(v => v.trim()).filter(Boolean)
  }
  return [String(val).trim()]
}

const getArrayParam = (query: any, key: string): string[] => {
  const val = query[key] !== undefined ? query[key] : query[`${key}[]`]
  return parseArrayParam(val)
};

router.get('/', async (req, res) => {
  const projectIds = getArrayParam(req.query, 'projectIds')
  const projectId  = req.query.projectId as string | undefined
  if (projectId) {
    projectIds.push(projectId)
  }
  const fileTypes  = getArrayParam(req.query, 'fileType')
  const tags       = getArrayParam(req.query, 'tags')
  const components = getArrayParam(req.query, 'component')
  const dateFrom   = req.query.dateFrom as string | undefined
  const dateTo     = req.query.dateTo as string | undefined
  const q          = ((req.query.q || req.query.search) as string | undefined)?.trim()

  const limit      = Math.min(Number(req.query.limit  ?? 25), 100)
  const offset     = Number(req.query.offset ?? 0)

  const conditions: string[] = []
  const values:     unknown[] = []
  let   idx = 1

  const finalProjectIds = Array.from(new Set(projectIds)).filter(id => id !== 'global')
  const includeGlobal = projectIds.includes('global')
  if (projectIds.length > 0) {
    if (includeGlobal && finalProjectIds.length > 0) {
      conditions.push(`(d.project_id = ANY($${idx++}) OR d.project_id IS NULL)`)
      values.push(finalProjectIds)
    } else if (includeGlobal) {
      conditions.push('d.project_id IS NULL')
    } else {
      conditions.push(`d.project_id = ANY($${idx++})`)
      values.push(finalProjectIds)
    }
  }

  if (fileTypes.length > 0) {
    conditions.push(`d.file_type = ANY($${idx++})`)
    values.push(fileTypes)
  }

  if (tags.length > 0) {
    conditions.push(`d.tags && $${idx++}::text[]`)
    values.push(tags)
  }

  if (components.length > 0) {
    conditions.push(`d.component = ANY($${idx++})`)
    values.push(components)
  }

  if (dateFrom) {
    conditions.push(`d.created_at >= $${idx++}::timestamptz`)
    values.push(dateFrom)
  }

  if (dateTo) {
    conditions.push(`d.created_at <= $${idx++}::timestamptz`)
    values.push(dateTo)
  }

  if (q) {
    conditions.push(`(d.tsv @@ plainto_tsquery('english', $${idx}) OR d.title ILIKE $${idx + 1} OR d.content ILIKE $${idx + 1})`)
    values.push(q)
    values.push(`%${q}%`)
    idx += 2
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const limitIdx = idx
  const offsetIdx = idx + 1

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM documents d LEFT JOIN projects p ON p.id = d.project_id ${where}`, values),
      pool.query(
        `SELECT
           d.id, d.project_id, d.title, d.file_type, d.tags, d.component, d.language,
           d.source, d.content_hash, d.created_at, d.embedding_status,
           length(d.content) AS content_length,
           (SELECT COUNT(*)::int FROM document_chunks dc WHERE dc.document_id = d.id AND dc.chunk_index >= 0) AS chunk_count,
           (d.explanation IS NOT NULL AND d.explanation_hash IS NOT NULL AND d.explanation_hash <> d.content_hash) AS explanation_stale,
           (d.diagram IS NOT NULL AND d.diagram_hash IS NOT NULL AND d.diagram_hash <> d.content_hash) AS diagram_stale,
           p.name  AS project_name,
           p.color AS project_color
         FROM documents d
         LEFT JOIN projects p ON p.id = d.project_id
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...values, limit, offset]
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── PATCH /api/documents/bulk ────────────────────────────────────────────────

router.patch('/bulk', requireRole('member'), async (req, res) => {
  const { ids, action, value } = req.body
  if (!Array.isArray(ids) || !ids.length) {
    return res.status(400).json({ error: 'ids array is required and cannot be empty' })
  }
  if (!['re-embed', 'tag', 'component', 'delete'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' })
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (action === 're-embed') {
      const { rows } = await client.query('SELECT id, content, title, language FROM documents WHERE id = ANY($1)', [ids])
      await client.query(`UPDATE documents SET embedding_status = 'processing' WHERE id = ANY($1)`, [ids])
      // Trigger embeddings asynchronously
      for (const row of rows) {
        embedDocument(row.id, row.content, { title: row.title, language: row.language })
          .then(() => pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [row.id]))
          .catch(() => pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [row.id]))
      }
    } else if (action === 'tag') {
      if (!value || typeof value !== 'string') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'value must be a string tag name' })
      }
      await client.query(
        `UPDATE documents SET tags = array_append(tags, $1) WHERE id = ANY($2) AND NOT ($1 = ANY(tags))`,
        [value, ids]
      )
    } else if (action === 'component') {
      if (typeof value !== 'string') {
        await client.query('ROLLBACK')
        return res.status(400).json({ error: 'value must be a string (empty string clears the component)' })
      }
      // Overwrite, not append — a document belongs to exactly one component.
      await client.query(
        `UPDATE documents SET component = $1 WHERE id = ANY($2)`,
        [value.trim() || null, ids]
      )
    } else if (action === 'delete') {
      await client.query(
        `DELETE FROM documents WHERE id = ANY($1)`,
        [ids]
      )
    }
    await client.query('COMMIT')
    res.json({ data: { success: true } })
  } catch (err) {
    await client.query('ROLLBACK')
    res.status(500).json({ error: (err as Error).message })
  } finally {
    client.release()
  }
})

// ── GET /api/documents/components  (distinct values for autocomplete) ─────
// Must be registered before GET /:id so "components" isn't swallowed as an id.

router.get('/components', async (req, res) => {
  const projectId = req.query.projectId as string | undefined
  try {
    const { rows } = await pool.query<{ component: string }>(
      projectId
        ? 'SELECT DISTINCT component FROM documents WHERE component IS NOT NULL AND project_id = $1 ORDER BY component'
        : 'SELECT DISTINCT component FROM documents WHERE component IS NOT NULL ORDER BY component',
      projectId ? [projectId] : []
    )
    res.json({ data: rows.map(r => r.component) })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/documents/:id ────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, p.name AS project_name, p.color AS project_color,
         length(d.content) AS content_length,
         (SELECT COUNT(*)::int FROM document_chunks dc WHERE dc.document_id = d.id AND dc.chunk_index >= 0) AS chunk_count,
         (SELECT id    FROM documents WHERE source_document_id = d.id ORDER BY created_at DESC LIMIT 1) AS linked_explanation_id,
         (SELECT title FROM documents WHERE source_document_id = d.id ORDER BY created_at DESC LIMIT 1) AS linked_explanation_title,
         (d.explanation IS NOT NULL AND d.explanation_hash IS NOT NULL AND d.explanation_hash <> d.content_hash) AS explanation_stale,
         (d.diagram IS NOT NULL AND d.diagram_hash IS NOT NULL AND d.diagram_hash <> d.content_hash) AS diagram_stale
       FROM documents d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.id = $1`,
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/documents/:id/chunks/:chunkIndex  (citation click-through) ───
// Returns the cited chunk plus its immediate neighbors, for showing a
// citation "in context" instead of just a flat excerpt.

router.get('/:id/chunks/:chunkIndex', async (req, res) => {
  const chunkIndex = Number(req.params.chunkIndex)
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0) {
    return res.status(400).json({ error: 'chunkIndex must be a non-negative integer' })
  }

  try {
    const { rows } = await pool.query(
      `SELECT chunk_index AS "chunkIndex", content
         FROM document_chunks
        WHERE document_id = $1 AND chunk_index BETWEEN $2 AND $3
        ORDER BY chunk_index`,
      [req.params.id, Math.max(chunkIndex - 1, 0), chunkIndex + 1]
    )
    if (!rows.some(r => r.chunkIndex === chunkIndex)) {
      return res.status(404).json({ error: 'Chunk not found' })
    }
    res.json({ data: { chunkIndex, chunks: rows } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents  (file upload) ────────────────────────────────────

router.post('/', requireRole('member'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const projectId = req.body.projectId || null
  const tagsRaw   = req.body.tags      || '[]'
  const component = (req.body.component as string | undefined)?.trim() || null
  let   tags: string[] = []

  try { tags = JSON.parse(tagsRaw) } catch { tags = [] }

  let tempPath = req.file.path
  let docId: string | null = null

  try {
    // Parse
    const { text, fileType, title, language } = await parseFile(tempPath, req.file.originalname)
    if (!text) return res.status(422).json({ error: 'Could not extract text from this file' })

    const hash = sha256(text)

    // Dedup check
    const existing = await pool.query(
      'SELECT id, title FROM documents WHERE content_hash = $1',
      [hash]
    )
    if (existing.rows.length) {
      return res.status(409).json({
        error: `This file was already uploaded as "${existing.rows[0].title}"`,
        existingId: existing.rows[0].id,
      })
    }

    // Insert document
    const { rows } = await pool.query(
      `INSERT INTO documents (project_id, title, file_type, content, tags, component, source, content_hash, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [projectId ?? null, title, fileType, text, tags, component, req.file.originalname, hash, language ?? null]
    )
    docId = rows[0].id

    // Embed — chunks stored progressively
    const chunkCount = await embedDocument(docId!, text, { title, language })
    await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [docId])

    const { rows: doc } = await pool.query('SELECT * FROM documents WHERE id = $1', [docId])

    res.status(201).json({ data: { ...doc[0], chunk_count: chunkCount } })
  } catch (err) {
    // Roll back document row if embedding failed mid-way
    if (docId) await pool.query('DELETE FROM documents WHERE id = $1', [docId]).catch(() => {})
    serverError(res, err)
  } finally {
    await fs.unlink(tempPath).catch(() => {})
  }
})

// ── POST /api/documents/:id/update-content ────────────────────────────────
// Replaces an existing document's content in place (e.g. re-syncing a code
// file that changed elsewhere), instead of the upload route's create-new
// behavior. Title/tags/component/project are left untouched — only content,
// file_type, language and content_hash move. Deliberately does NOT touch
// explanation/explanation_hash, so a stale explanation stays visible
// (flagged via explanation_stale, see GET /:id and GET /) until the user
// explicitly regenerates it — this route is the only way an existing
// document's content_hash can actually change today, which is what makes
// that staleness flag meaningful.

router.post('/:id/update-content', requireRole('member'), upload.single('file'), async (req, res) => {
  const id = req.params.id as string
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const tempPath = req.file.path

  try {
    const { rows: existingRows } = await pool.query('SELECT id FROM documents WHERE id = $1', [id])
    if (!existingRows.length) return res.status(404).json({ error: 'Document not found' })

    const { text, fileType, language } = await parseFile(tempPath, req.file.originalname)
    if (!text) return res.status(422).json({ error: 'Could not extract text from this file' })

    const hash = sha256(text)

    await pool.query(
      `UPDATE documents
       SET content = $2, content_hash = $3, file_type = $4, language = $5, source = $6, embedding_status = 'processing'
       WHERE id = $1`,
      [id, text, hash, fileType, language ?? null, req.file.originalname]
    )

    const { rows: doc } = await pool.query('SELECT title FROM documents WHERE id = $1', [id])
    const chunkCount = await embedDocument(id, text, { title: doc[0].title, language })
    await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [id])

    const { rows: final } = await pool.query(
      `SELECT *,
         (explanation IS NOT NULL AND explanation_hash IS NOT NULL AND explanation_hash <> content_hash) AS explanation_stale,
         (diagram IS NOT NULL AND diagram_hash IS NOT NULL AND diagram_hash <> content_hash) AS diagram_stale
       FROM documents WHERE id = $1`,
      [id]
    )
    res.json({ data: { ...final[0], chunk_count: chunkCount } })
  } catch (err) {
    await pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [id]).catch(() => {})
    serverError(res, err)
  } finally {
    await fs.unlink(tempPath).catch(() => {})
  }
})

// ── POST /api/documents/url ───────────────────────────────────────────────

const UrlBody = z.object({
  url:       z.string().url(),
  projectId: z.string().optional(),
  tags:      z.array(z.string()).default([]),
  component: z.string().optional(),
})

router.post('/url', requireRole('member'), async (req, res) => {
  const parsed = UrlBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { url, projectId = null, tags, component } = parsed.data

  if (await isPrivateUrl(url)) {
    return res.status(422).json({ error: 'URL resolves to a private or restricted address' })
  }

  let docId: string | null = null

  try {
    const { text, fileType, title } = await parseUrl(url)
    if (!text) return res.status(422).json({ error: 'Could not extract content from this URL' })

    const hash = sha256(text)

    const existing = await pool.query('SELECT id, title FROM documents WHERE content_hash = $1', [hash])
    if (existing.rows.length) {
      return res.status(409).json({
        error: `This URL was already imported as "${existing.rows[0].title}"`,
        existingId: existing.rows[0].id,
      })
    }

    const { rows } = await pool.query(
      `INSERT INTO documents (project_id, title, file_type, content, tags, component, source, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [projectId ?? null, title, fileType, text, tags, component?.trim() || null, url, hash]
    )
    docId = rows[0].id

    const chunkCount = await embedDocument(docId!, text, { title })
    await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [docId])

    const { rows: doc } = await pool.query('SELECT * FROM documents WHERE id = $1', [docId])

    res.status(201).json({ data: { ...doc[0], chunk_count: chunkCount } })
  } catch (err) {
    if (docId) await pool.query('DELETE FROM documents WHERE id = $1', [docId]).catch(() => {})
    serverError(res, err)
  }
})

// ── PATCH /api/documents/:id  (update tags / title / project) ─────────────

const PatchBody = z.object({
  title:     z.string().min(1).max(200).optional(),
  tags:      z.array(z.string()).optional(),
  component: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
})

const DOC_COL_MAP: Record<string, string> = { projectId: 'project_id' }
const DOC_UPDATABLE_COLS = new Set(['title', 'tags', 'component', 'project_id'])

router.patch('/:id', async (req, res) => {
  const parsed = PatchBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const updates = parsed.data as Record<string, unknown>
  // Map camelCase → snake_case then filter to allowlist
  const fields = Object.keys(updates)
    .map(k => DOC_COL_MAP[k] ?? k)
    .filter(k => DOC_UPDATABLE_COLS.has(k))
  const vals = Object.keys(updates).map(k => updates[k])

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' })

  const { setClauses, params } = buildSetClause(fields, vals)

  try {
    const { rows } = await pool.query(
      `UPDATE documents SET ${setClauses} WHERE id = $1 RETURNING *`,
      [req.params.id, ...params]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })
    res.json({ data: rows[0] })
  } catch (err) {
    serverError(res, err)
  }
})

// ── DELETE /api/documents/:id ─────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    // Chunks deleted via ON DELETE CASCADE
    const { rows } = await pool.query(
      'DELETE FROM documents WHERE id = $1 RETURNING id, title',
      [req.params.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })
    await deleteLinksFor('document', req.params.id as string)
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/:id/reembed ──────────────────────────────────────

router.post('/:id/reembed', requireRole('member'), async (req, res) => {
  const id = req.params.id as string
  try {
    const { rows } = await pool.query('SELECT id, content, title, language FROM documents WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    await pool.query(`UPDATE documents SET embedding_status = 'processing' WHERE id = $1`, [id])

    embedDocument(id, rows[0].content, { title: rows[0].title, language: rows[0].language })
      .then(() => pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [id]))
      .catch(() => pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [id]))

    res.json({ data: { id, embedding_status: 'processing' } })
  } catch (err) {
    await pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [id]).catch(() => {})
    serverError(res, err)
  }
})

// ── POST /api/documents/:id/explain ──────────────────────────────────────
// AI explanation for a tracked code file — same pattern as commands.explain.

const EXPLAIN_SOURCE_CHARS = 12000  // enough for most single files without an oversized prompt

router.post('/:id/explain', requireRole('member'), async (req, res) => {
  const id = req.params.id as string
  try {
    const { rows } = await pool.query(
      'SELECT title, content, file_type, language, content_hash FROM documents WHERE id = $1',
      [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    const doc = rows[0] as { title: string; content: string; file_type: string; language: string | null; content_hash: string | null }
    if (doc.file_type !== 'code') {
      return res.status(400).json({ error: 'Explain is only available for tracked code files' })
    }

    const lang = doc.language ?? 'code'
    const truncated = doc.content.length > EXPLAIN_SOURCE_CHARS
    const source = doc.content.slice(0, EXPLAIN_SOURCE_CHARS)

    const explanation = await aiChat(
      `Explain what this ${lang} file ("${doc.title}") does:\n\n\`\`\`${lang}\n${source}\n\`\`\`${truncated ? '\n\n(File was truncated for length — explain based on what is shown.)' : ''}`,
      'You are a technical assistant that explains source code clearly and concisely for a developer knowledge base. Use Markdown for formatting. Cover: what the file is responsible for, its main functions/entry points, and any notable dependencies or side effects (I/O, network, database). Keep it under 300 words.'
    )
    // Stamp the content_hash this explanation was generated against, so a
    // later content change (see update-content route) can be detected as
    // explanation_stale without a separate "last explained at" timestamp.
    await pool.query('UPDATE documents SET explanation = $2, explanation_hash = $3 WHERE id = $1', [id, explanation, doc.content_hash])
    res.json({ data: { explanation } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/:id/diagram ───────────────────────────────────────
// AI-generated Mermaid diagram of a tracked code file's structure — same
// shape as /explain (code-only, content_hash-stamped for staleness), but
// asks for a Mermaid definition instead of prose, rendered client-side.

const DIAGRAM_SOURCE_CHARS = 12000

// Models routinely wrap the diagram in a ```mermaid fence despite being told
// not to — strip it defensively rather than fail the render on that alone.
function stripMermaidFence(raw: string): string {
  const fenced = raw.trim().match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : raw).trim()
}

router.post('/:id/diagram', requireRole('member'), async (req, res) => {
  const id = req.params.id as string
  try {
    const { rows } = await pool.query(
      'SELECT title, content, file_type, language, content_hash FROM documents WHERE id = $1',
      [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    const doc = rows[0] as { title: string; content: string; file_type: string; language: string | null; content_hash: string | null }
    if (doc.file_type !== 'code') {
      return res.status(400).json({ error: 'Diagram is only available for tracked code files' })
    }

    const lang = doc.language ?? 'code'
    const truncated = doc.content.length > DIAGRAM_SOURCE_CHARS
    const source = doc.content.slice(0, DIAGRAM_SOURCE_CHARS)

    const raw = await aiChat(
      `Generate a Mermaid diagram of this ${lang} file ("${doc.title}")'s structure — its main functions/classes/methods and how they call or depend on each other:\n\n\`\`\`${lang}\n${source}\n\`\`\`${truncated ? '\n\n(File was truncated for length — diagram based on what is shown.)' : ''}`,
      'You are a technical assistant that generates Mermaid diagrams for a developer knowledge base. Respond with ONLY a valid Mermaid diagram definition — start directly with `flowchart TD` (or `classDiagram`/`sequenceDiagram` if clearly a better fit for this file). No prose, no markdown code fences, no explanation before or after. Keep node labels short. If the file has no meaningful internal structure to diagram (e.g. pure config/data), respond with exactly: flowchart TD\\n  A["No meaningful structure to diagram"]'
    )
    const diagram = stripMermaidFence(raw)

    await pool.query('UPDATE documents SET diagram = $2, diagram_hash = $3 WHERE id = $1', [id, diagram, doc.content_hash])
    res.json({ data: { diagram } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/:id/save-explanation ─────────────────────────────
// Turns a code file's AI explanation into its own searchable document,
// linked back via source_document_id. Idempotent — re-running it after a
// re-explain updates the same linked doc instead of piling up duplicates.

router.post('/:id/save-explanation', requireRole('member'), async (req, res) => {
  const id = req.params.id as string
  try {
    const { rows } = await pool.query(
      'SELECT title, explanation, project_id, component, tags, file_type FROM documents WHERE id = $1',
      [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    const src = rows[0] as { title: string; explanation: string | null; project_id: string | null; component: string | null; tags: string[]; file_type: string }
    if (src.file_type !== 'code') {
      return res.status(400).json({ error: 'Only available for tracked code files' })
    }
    if (!src.explanation) {
      return res.status(400).json({ error: 'No explanation yet — generate one first' })
    }

    const title   = `${src.title} — Explained`
    const content = src.explanation
    const hash    = sha256(content)
    const tags    = Array.from(new Set([...(src.tags ?? []), 'code-explanation']))

    const { rows: existing } = await pool.query(
      'SELECT id FROM documents WHERE source_document_id = $1',
      [id]
    )

    let docId: string
    let created: boolean

    if (existing.length) {
      docId   = existing[0].id
      created = false
      await pool.query(
        'UPDATE documents SET title = $2, content = $3, content_hash = $4 WHERE id = $1',
        [docId, title, content, hash]
      )
    } else {
      created = true
      const { rows: inserted } = await pool.query(
        `INSERT INTO documents (project_id, title, file_type, content, tags, component, source, content_hash, source_document_id)
         VALUES ($1, $2, 'md', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [src.project_id, title, content, tags, src.component, `Generated from "${src.title}"`, hash, id]
      )
      docId = inserted[0].id
    }

    const chunkCount = await embedDocument(docId, content, { title })
    await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [docId])

    const { rows: doc } = await pool.query('SELECT * FROM documents WHERE id = $1', [docId])
    res.status(created ? 201 : 200).json({ data: { ...doc[0], chunk_count: chunkCount, created } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/component-overview ────────────────────────────────
// Generates one combined architecture overview from every code file tagged
// with a given `component`, instead of one file at a time. Uses a compact
// per-file signature outline (via tree-sitter's extractSymbolOutline) rather
// than dumping full file text into the prompt — "rank symbols, don't dump
// everything", the idea behind Aider's repo map — falling back to a short
// truncated excerpt for files whose language has no grammar available.
// Idempotent per (project_id, component): regenerating updates the same
// overview doc (source_component) instead of creating a duplicate.

const OVERVIEW_SNIPPET_CHARS = 800  // fallback per-file excerpt when no AST outline is available
const OVERVIEW_MAX_FILES     = 30   // sane cap so a huge component doesn't blow the prompt

const ComponentOverviewBody = z.object({
  component: z.string().min(1).max(120),
  projectId: z.string().nullable(),
})

router.post('/component-overview', requireRole('member'), async (req, res) => {
  const parsed = ComponentOverviewBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  const { component, projectId } = parsed.data
  const projectCond = projectId ? 'project_id = $2' : 'project_id IS NULL'

  try {
    const { rows: files } = await pool.query(
      `SELECT id, title, language, content FROM documents
       WHERE file_type = 'code' AND component = $1 AND ${projectCond}
       ORDER BY title
       LIMIT $${projectId ? 3 : 2}`,
      projectId ? [component, projectId, OVERVIEW_MAX_FILES] : [component, OVERVIEW_MAX_FILES]
    )
    if (!files.length) {
      return res.status(404).json({ error: `No code files found for component "${component}"` })
    }

    const fileBlocks = await Promise.all(files.map(async (f: { title: string; language: string | null; content: string }) => {
      const outline = await extractSymbolOutline(f.content, f.language)
      const body = outline
        ? outline.map(line => `  ${line}`).join('\n')
        : f.content.slice(0, OVERVIEW_SNIPPET_CHARS)
      return `### ${f.title}${f.language ? ` (${f.language})` : ''}\n${body}`
    }))

    const overview = await aiChat(
      `Generate an architecture overview for the "${component}" component, based on the signature outlines of its ${files.length} file(s):\n\n${fileBlocks.join('\n\n')}`,
      'You are a technical assistant that writes component/module-level architecture overviews for a developer knowledge base, given per-file signature outlines (not full source). Use Markdown. Cover: what this component is responsible for as a whole, how its files relate to or depend on each other, the main entry points, and any notable patterns. Do not invent details not implied by the outlines. Keep it under 400 words.'
    )

    const title = `${component} — Component Overview`
    const hash  = sha256(overview)

    const { rows: existing } = await pool.query(
      `SELECT id FROM documents WHERE source_component = $1 AND ${projectCond}`,
      projectId ? [component, projectId] : [component]
    )

    let docId: string
    let created: boolean

    if (existing.length) {
      docId   = existing[0].id
      created = false
      await pool.query(
        'UPDATE documents SET title = $2, content = $3, content_hash = $4 WHERE id = $1',
        [docId, title, overview, hash]
      )
    } else {
      created = true
      const { rows: inserted } = await pool.query(
        `INSERT INTO documents (project_id, title, file_type, content, tags, component, source, content_hash, source_component)
         VALUES ($1, $2, 'md', $3, $4, $5, $6, $7, $8) RETURNING id`,
        [projectId ?? null, title, overview, ['component-overview'], component, `Generated from ${files.length} file(s) in "${component}"`, hash, component]
      )
      docId = inserted[0].id
    }

    const chunkCount = await embedDocument(docId, overview, { title })
    await pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [docId])

    const { rows: doc } = await pool.query('SELECT * FROM documents WHERE id = $1', [docId])
    res.status(created ? 201 : 200).json({ data: { ...doc[0], chunk_count: chunkCount, created, fileCount: files.length } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/suggest-tags ─────────────────────────────────────────
// Suggests up to 5 tags from title + optional hint text using AI.

router.post('/suggest-tags', requireRole('member'), async (req, res) => {
  const { title, hint } = req.body as { title?: string; hint?: string }
  const text = [title, hint].filter(Boolean).join(' ').trim()
  if (!text) return res.status(400).json({ error: 'title or hint is required' })

  try {
    const raw = await aiChat(
      `Suggest up to 5 short, lowercase tags for a document with this title/description:\n"${text.slice(0, 500)}"\n\nReturn ONLY a JSON array of strings, e.g. ["docker","postgres","setup"]. No explanation.`,
      'You are a tagging assistant. Return only a valid JSON array of short lowercase tags.'
    )
    const match = raw.match(/\[[\s\S]*\]/)
    const tags: string[] = match ? (JSON.parse(match[0]) as string[]).slice(0, 5) : []
    res.json({ data: { tags } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/suggest-tags-from-file ────────────────────────────
// Parses the uploaded file for real content and suggests tags from it —
// a dry run that never creates a document row (no dedup check, no embed).

router.post('/suggest-tags-from-file', requireRole('member'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  const tempPath = req.file.path

  try {
    const { text, title } = await parseFile(tempPath, req.file.originalname)
    if (!text) return res.status(422).json({ error: 'Could not extract text from this file' })

    const raw = await aiChat(
      `Suggest up to 5 short, lowercase tags for this document based on its actual content.
Title: "${title}"
Content excerpt:
"""${text.slice(0, 2000)}"""

Return ONLY a JSON array of strings, e.g. ["docker","postgres","setup"]. No explanation.`,
      'You are a tagging assistant. Return only a valid JSON array of short lowercase tags.'
    )
    const match = raw.match(/\[[\s\S]*\]/)
    const tags: string[] = match ? (JSON.parse(match[0]) as string[]).slice(0, 5) : []
    res.json({ data: { tags } })
  } catch (err) {
    serverError(res, err)
  } finally {
    await fs.unlink(tempPath).catch(() => {})
  }
})

export default router

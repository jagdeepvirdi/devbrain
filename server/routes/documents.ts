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
import { aiEmbed, aiChat }    from '../services/ai.js'
import { buildWhereClause }   from '../lib/db.js'
import { serverError }        from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'

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

// ── GET /api/documents ────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const projectId = req.query.projectId as string | undefined
  const search    = req.query.search    as string | undefined
  const limit     = Math.min(Number(req.query.limit  ?? 25), 100)
  const offset    = Number(req.query.offset ?? 0)

  const conditions: string[] = []
  const values:     unknown[] = []
  let   idx = 1

  if (projectId === 'global') {
    conditions.push('d.project_id IS NULL')
  } else if (projectId) {
    conditions.push(`d.project_id = $${idx++}`)
    values.push(projectId)
  }

  if (search) {
    conditions.push(`d.tsv @@ plainto_tsquery('english', $${idx++})`)
    values.push(search)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const [countRes, dataRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS n FROM documents d ${where}`, values),
      pool.query(
        `SELECT
           d.id, d.project_id, d.title, d.file_type, d.tags,
           d.source, d.content_hash, d.created_at,
           length(d.content) AS content_length,
           (SELECT COUNT(*)::int FROM document_chunks dc WHERE dc.document_id = d.id) AS chunk_count,
           p.name  AS project_name,
           p.color AS project_color
         FROM documents d
         LEFT JOIN projects p ON p.id = d.project_id
         ${where}
         ORDER BY d.created_at DESC
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit, offset]
      ),
    ])
    res.json({ data: { items: dataRes.rows, total: countRes.rows[0].n } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/documents/:id ────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, p.name AS project_name, p.color AS project_color
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

// ── POST /api/documents  (file upload) ────────────────────────────────────

router.post('/', requireRole('member'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const projectId = req.body.projectId || null
  const tagsRaw   = req.body.tags      || '[]'
  let   tags: string[] = []

  try { tags = JSON.parse(tagsRaw) } catch { tags = [] }

  let tempPath = req.file.path
  let docId: string | null = null

  try {
    // Parse
    const { text, fileType, title } = await parseFile(tempPath, req.file.originalname)
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
      `INSERT INTO documents (project_id, title, file_type, content, tags, source, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [projectId ?? null, title, fileType, text, tags, req.file.originalname, hash]
    )
    docId = rows[0].id

    // Embed — chunks stored progressively
    const chunkCount = await embedDocument(docId!, text)

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

// ── POST /api/documents/url ───────────────────────────────────────────────

const UrlBody = z.object({
  url:       z.string().url(),
  projectId: z.string().optional(),
  tags:      z.array(z.string()).default([]),
})

router.post('/url', requireRole('member'), async (req, res) => {
  const parsed = UrlBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })

  const { url, projectId = null, tags } = parsed.data

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
      `INSERT INTO documents (project_id, title, file_type, content, tags, source, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [projectId ?? null, title, fileType, text, tags, url, hash]
    )
    docId = rows[0].id

    const chunkCount = await embedDocument(docId!, text)
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
  projectId: z.string().nullable().optional(),
})

const DOC_COL_MAP: Record<string, string> = { projectId: 'project_id' }
const DOC_UPDATABLE_COLS = new Set(['title', 'tags', 'project_id'])

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
    res.json({ data: { deleted: rows[0] } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/documents/:id/reembed ──────────────────────────────────────

router.post('/:id/reembed', requireRole('member'), async (req, res) => {
  const { id } = req.params
  try {
    const { rows } = await pool.query('SELECT id, content FROM documents WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    await pool.query(`UPDATE documents SET embedding_status = 'processing' WHERE id = $1`, [id])

    embedDocument(id, rows[0].content)
      .then(() => pool.query(`UPDATE documents SET embedding_status = 'done' WHERE id = $1`, [id]))
      .catch(() => pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [id]))

    res.json({ data: { id, embedding_status: 'processing' } })
  } catch (err) {
    await pool.query(`UPDATE documents SET embedding_status = 'failed' WHERE id = $1`, [id]).catch(() => {})
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

export default router

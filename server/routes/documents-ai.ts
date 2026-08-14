import { Router } from 'express'
import multer  from 'multer'
import fs      from 'fs/promises'
import os      from 'os'
import path    from 'path'
import crypto  from 'crypto'
import { z }   from 'zod'
import { pool } from '../db/pool.js'
import { parseFile } from '../services/parser.js'
import { aiChat, aiChatStream } from '../services/ai.js'
import { serverError } from '../lib/errors.js'
import { requireRole } from '../middleware/auth.js'
import { embedDocument } from '../services/embedder.js'
import { extractSymbolOutline } from '../services/codeChunker.js'
import { extractSqlOutline } from '../services/codeIntel/parsers/pythonBridgeParser.js'
import { lineSimilarity } from '../services/duplicateDetector.js'

// AI-generation and analysis endpoints for documents — split out of routes/documents.ts
// (TASKS.md Phase 39 Tier 2 god-file split): explain/diagram/save-explanation/
// component-overview (all aiChat-driven enrichment), find-duplicates (embedding +
// line-similarity analysis), and the two suggest-tags variants. Mounted at the same
// /api/documents base. Every route here is either 2+ path segments (/:id/explain, ...) or
// a POST-only bare route (/component-overview, /find-duplicates, /suggest-tags,
// /suggest-tags-from-file) — the main router has no bare POST /:id-shaped route for any of
// those exact strings to collide with, so mount order relative to it doesn't matter (same
// reasoning as issues-ai.ts and settings-backup.ts).

const upload = multer({
  dest:   path.join(os.tmpdir(), 'devbrain-uploads'),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
})

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

const router = Router()

// ── POST /api/documents/:id/explain ──────────────────────────────────────
// AI explanation for a tracked code file — same pattern as commands.explain.

const EXPLAIN_SOURCE_CHARS = 12000  // enough for most single files without an oversized prompt

// Packages/files whose outline lists more than this many procedures/functions
// switch to EXPLAIN_SYSTEM_PROMPT_COMPACT instead of the full one below — a
// one-line-per-item list stays scannable at this size, where the full
// prompt's prose-heavy sections (Parameters & Inputs, Output, Dependencies)
// don't really fit "a package of 20+ stored procedures" anyway. This is a
// formatting choice, not a completeness one — both prompts are told to
// cover every item in the outline, full stop.
const LARGE_OUTLINE_THRESHOLD = 15

// Ceiling on Ollama's num_predict (see aiChatStream's opts.maxTokens) — a
// safety net against a genuinely runaway/looping generation, not a target
// length. There is no time-based reason to cap this low: generation runs
// entirely on local hardware at no per-token cost, and aiChatStream's own
// stall detector (not a flat deadline) already tolerates however long a
// still-actively-producing response takes. The real ceiling here is
// mistral:7b's loaded context window on this GPU (4096 tokens, prompt +
// response combined — confirmed via `ollama ps`; raising it would grow the
// KV cache well past this card's ~1GB of free VRAM once model weights are
// loaded, risking the GPU-thrashing failure mode `services/ai.ts`'s request
// queue exists to avoid). This cap sits comfortably under that combined
// with a typical outline-only prompt's size, not below it — a 37-procedure
// package's ~1800-token outline prompt leaves ~2300 tokens of real headroom,
// which is what let a full run actually finish covering the whole file
// (measured; previously this was capped at 650 and cut off after ~10 items).
const EXPLAIN_MAX_TOKENS = 3000

const EXPLAIN_SYSTEM_PROMPT = `You are a technical assistant that explains source code clearly and in detail for a developer knowledge base. Use Markdown with these headings, omitting any that don't apply to this file:

## Overview
What this file is responsible for, in 2-3 sentences.

## Parameters & Inputs
If this is a script, CLI tool, or entry point: what arguments, flags, environment variables, or config it expects to run. Either way, state what data it reads or extracts, and where from — a file path, a database table/query, an API endpoint, stdin, or another module.

## Output
What it produces, in what format, and where it goes — stdout, a file it writes, a database write, an API response, or a return value.

## Key Functions & Classes
One line each: purpose, parameters, return value.

## Dependencies & Side Effects
Notable external dependencies, I/O, network calls, database access.

## Notable Patterns / Gotchas
Anything a future reader would want to know that isn't obvious from the code alone.

Be specific rather than generic — name the actual parameters, files, tables, and formats involved. Aim for 400-600 words, but if the file has a lot of ground to cover, prioritize covering all of it completely over hitting that word count — do not shorten or drop items to stay under it.`

const EXPLAIN_SYSTEM_PROMPT_COMPACT = `You are a technical assistant that explains source code for a developer knowledge base. This file has a large number of procedures/functions, so use a compact one-line-per-item list instead of prose paragraphs — that's a formatting choice for scannability, not a request to leave anything out. Use Markdown with these headings, omitting any that don't apply:

## Overview
What this file is responsible for, in 2-3 sentences.

## Key Functions & Classes
ONE line per procedure/function: name — what it does, tables it touches. Keep each line short, but list every single item from the outline — do not stop partway, summarize a subset, or say "and others"/"among others". If the outline has 37 items, this section has 37 lines.

## Notable Patterns / Gotchas
At most 2-3 bullet points, only if something is genuinely non-obvious. Omit this heading entirely if nothing stands out.

Be specific — name the actual tables/procedures involved. Length should scale with however many items the outline has — a longer outline is expected to produce a longer list, not a truncated one.`

router.post('/:id/explain', requireRole('member'), async (req, res) => {
  const id = req.params.id as string

  let doc: { title: string; content: string; file_type: string; language: string | null; content_hash: string | null }
  let systemPrompt: string
  let userPrompt: string
  try {
    const { rows } = await pool.query(
      'SELECT title, content, file_type, language, content_hash FROM documents WHERE id = $1',
      [id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Document not found' })

    doc = rows[0] as { title: string; content: string; file_type: string; language: string | null; content_hash: string | null }
    if (doc.file_type !== 'code') {
      return res.status(400).json({ error: 'Explain is only available for tracked code files' })
    }

    const lang = doc.language ?? 'code'
    const truncated = doc.content.length > EXPLAIN_SOURCE_CHARS
    const source = doc.content.slice(0, EXPLAIN_SOURCE_CHARS)

    // Static-analysis signature outline (same tree-sitter pass component-overview uses) —
    // gives the model an accurate map of every function/class even when the raw source
    // above is truncated, so longer files don't lose coverage of what's past the cutoff.
    // Tree-sitter has no grammar for sql/plsql and always returns null for them — fall
    // back to sql_bridge.py (extractSqlOutline) for exactly those two languages, so large
    // PL/SQL packages (the common case for oversized files in this app) aren't left with
    // zero outline coverage past EXPLAIN_SOURCE_CHARS.
    const isSql = doc.language === 'sql' || doc.language === 'plsql'
    let outline = await extractSymbolOutline(doc.content, doc.language)
    if (!outline && isSql) {
      outline = await extractSqlOutline(doc.content, doc.language as 'sql' | 'plsql')
    }

    // Real-file testing (TASKS.md) found that on a large truncated file, giving
    // the model BOTH the truncated raw source AND the full-file outline together
    // backfires — both mistral and llama3.2 fixated on the truncated excerpt and
    // ignored the outline, describing only the handful of functions that happened
    // to fit before the cutoff. Dropping the raw source whenever there's a
    // successful outline for the whole file — regardless of language, not just
    // SQL/PLSQL — and asking the model to work from the outline alone (the same
    // "rank symbols, don't dump everything" approach /component-overview already
    // uses) gets a response that actually covers the whole file. This is NOT
    // chunking the file and stitching summaries back together — the outline
    // comes from ONE static-analysis pass over the complete, untruncated source
    // (tree-sitter or sql_bridge.py), so there's no cross-chunk context to lose;
    // it's a structural map of the whole file, not a slice of it. Files with no
    // outline available (language without a parser, or a parser that found
    // nothing) keep the original raw-source prompt — outline-only would leave
    // the model with nothing to work from otherwise.
    const useOutlineOnly = truncated && outline !== null
    const isLargeOutline = useOutlineOnly && outline!.length > LARGE_OUTLINE_THRESHOLD

    const outlineBlock = outline
      ? `Symbol outline (functions/classes found via static analysis, covers the whole file even if the source below is truncated):\n${outline.map(l => `  ${l}`).join('\n')}\n\n`
      : ''

    userPrompt = useOutlineOnly
      ? `Explain what this ${lang} file ("${doc.title}") does, based on its full symbol outline (every function/class in the file, with the tables each one reads/writes, if applicable):\n\n${outline!.map(l => `  ${l}`).join('\n')}\n\nCover ALL of the items listed above, not just the first few — the outline is complete for the whole file.`
      : `Explain what this ${lang} file ("${doc.title}") does:\n\n${outlineBlock}Source:\n\`\`\`${lang}\n${source}\n\`\`\`${truncated ? '\n\n(Source was truncated for length — use the symbol outline above, if present, to cover parts past the cutoff.)' : ''}`

    systemPrompt = isLargeOutline ? EXPLAIN_SYSTEM_PROMPT_COMPACT : EXPLAIN_SYSTEM_PROMPT
  } catch (err) {
    return serverError(res, err)
  }

  // Streamed as SSE (same shape as /api/chat) rather than one blocking JSON
  // response — a 400-600-word explanation from mistral:7b on this app's
  // target hardware can take well over a minute, and streaming both avoids a
  // single hard request timeout ending generation early and lets the UI show
  // progress instead of a blank spinner for that whole time.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const IDLE_MS = 5 * 60 * 1000
  let idleTimer = setTimeout(onIdle, IDLE_MS)
  function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(onIdle, IDLE_MS) }
  function onIdle() { res.write('data: {"type":"timeout"}\n\n'); res.end() }
  req.on('close', () => clearTimeout(idleTimer))

  function send(obj: unknown) {
    resetIdle()
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }
  function done() {
    clearTimeout(idleTimer)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  try {
    let explanation = ''
    await aiChatStream(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      (chunk) => { explanation += chunk; send({ type: 'chunk', text: chunk }) },
      { maxTokens: EXPLAIN_MAX_TOKENS }
    )
    // Stamp the content_hash this explanation was generated against, so a
    // later content change (see update-content route) can be detected as
    // explanation_stale without a separate "last explained at" timestamp.
    await pool.query('UPDATE documents SET explanation = $2, explanation_hash = $3 WHERE id = $1', [id, explanation, doc.content_hash])
    done()
  } catch (err) {
    send({ type: 'error', message: (err as Error).message ?? 'Unknown error' })
    done()
  }
})

// ── POST /api/documents/:id/diagram ───────────────────────────────────────
// AI-generated Mermaid diagram of a tracked code file's structure — same
// shape as /explain (code-only, content_hash-stamped for staleness), but
// asks for a Mermaid definition instead of prose, rendered client-side.

const DIAGRAM_SOURCE_CHARS = 12000

// A larger/code-specialized model (qwen2.5-coder:14b) was tried here as a fix
// for the failure mode described below and rejected after testing directly
// against this project's own real large SQL files: at 8.37GB it doesn't fit
// this app's target 6GB-VRAM hardware (near-guaranteed timeout, worse than
// the problem it was meant to fix) — and gemma3:4b, small enough to fit,
// still timed out past 120s on the same prompt even fully warm in VRAM, so
// it's genuinely too slow on this content, not just a swap-time cost. The
// default CHAT_MODEL (mistral) remains the fastest option in practice (~12s
// on this same file) despite the unreliable-format problem the validation/
// retry below exists to catch — see TASKS.md for the full investigation.
//
// Models routinely wrap the diagram in a ```mermaid fence despite being told
// not to — strip it defensively rather than fail the render on that alone.
function stripMermaidFence(raw: string): string {
  const fenced = raw.trim().match(/^```(?:mermaid)?\s*\n([\s\S]*?)\n?```$/)
  return (fenced ? fenced[1] : raw).trim()
}

// Matches exactly the three diagram types the system prompt below permits.
// A response that fails this (prose, an explanation, anything not starting
// with one of these) is not silently stored as a "diagram" — MermaidDiagram.tsx
// would fail to render it client-side anyway, just confusingly (a red error
// box in place of a diagram, easy to miss/misread as "nothing happened").
const MERMAID_DIAGRAM_TYPE_RE = /^(flowchart|classDiagram|sequenceDiagram)\b/

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
    const userPrompt =
      `Generate a Mermaid diagram of this ${lang} file ("${doc.title}")'s structure — its main functions/classes/methods and how they call or depend on each other:\n\n\`\`\`${lang}\n${source}\n\`\`\`${truncated ? '\n\n(File was truncated for length — diagram based on what is shown.)' : ''}`
    const systemPrompt =
      'You are a technical assistant that generates Mermaid diagrams for a developer knowledge base. Respond with ONLY a valid Mermaid diagram definition — start directly with `flowchart TD` (or `classDiagram`/`sequenceDiagram` if clearly a better fit for this file). No prose, no markdown code fences, no explanation before or after. Keep node labels short. If the file has no meaningful internal structure to diagram (e.g. pure config/data), respond with exactly: flowchart TD\\n  A["No meaningful structure to diagram"]'

    // Retrying gives the model a second, independent roll at complying with
    // the format instruction — verified this does NOT reliably rescue large/
    // dense files (both attempts returned prose, consistently, against a
    // real 200KB+ SQL package in testing), but it's a free, harmless
    // improvement for the more common case (most files aren't that large)
    // and costs nothing when the first attempt already succeeds. Either way,
    // two consecutive misses gives up cleanly (502, no DB write) rather than
    // storing unrenderable text as if it were a valid diagram and silently
    // clobbering a previously-good one.
    let diagram: string | null = null
    for (let attempt = 0; attempt < 2 && !diagram; attempt++) {
      const raw = await aiChat(userPrompt, systemPrompt)
      const stripped = stripMermaidFence(raw)
      if (MERMAID_DIAGRAM_TYPE_RE.test(stripped)) diagram = stripped
    }

    if (!diagram) {
      return res.status(502).json({ error: 'The AI did not return a valid diagram after 2 attempts — try again.' })
    }

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

// ── POST /api/documents/find-duplicates ───────────────────────────────────
// Two-phase duplicate detection across code files (see services/duplicateDetector.ts
// for the precise-scoring half): phase 1 shortlists candidate pairs cheaply using the
// per-document summary embeddings every code file already gets on embed — a pgvector
// cosine self-join, no extra AI calls — then phase 2 scores each shortlisted pair with
// a deterministic line-similarity ratio and keeps the ones above CONFIRM_MIN_SCORE.
// Files that failed summarization (no summary embedding — see embedder.ts, non-fatal)
// skip phase 1 entirely and are compared directly against every other file in scope,
// so a missing embedding can never silently hide a duplicate.

const DUPLICATE_SHORTLIST_COSINE = 0.7  // phase 1: loose, recall-oriented — phase 2 does the real filtering
const DUPLICATE_CONFIRM_MIN_SCORE = 0.5 // phase 2: floor for even showing a pair to the user
const DUPLICATE_MAX_RESULTS = 50
// Caps how much of each file's content phase 2 actually diffs — bounds the cost of any single
// pair regardless of how large the tracked file is (e.g. an accidentally-tracked minified
// bundle). Generous for real source files; a few hundred KB is already thousands of lines.
const DUPLICATE_COMPARE_CHARS = 300_000
// lineSimilarity() runs synchronously on the main thread — with many candidate pairs in one
// request, back-to-back comparisons without a break add up to one long unbroken block of the
// event loop (see TASKS.md Phase 39/Phase 34: this was flagging every other in-flight request,
// not just this one). Yielding back to the event loop periodically lets other requests
// interleave instead of queuing behind the whole scan.
const DUPLICATE_YIELD_EVERY_N_PAIRS = 25
const yieldToEventLoop = () => new Promise(resolve => setImmediate(resolve))

const FindDuplicatesBody = z.object({
  projectId: z.string().nullable(),
})

router.post('/find-duplicates', requireRole('member'), async (req, res) => {
  const parsed = FindDuplicatesBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  const { projectId } = parsed.data

  try {
    const { rows: docs } = await pool.query<{ id: string; title: string; content: string }>(
      `SELECT id, title, content FROM documents WHERE file_type = 'code' ${projectId ? 'AND project_id = $1' : ''}`,
      projectId ? [projectId] : []
    )
    if (docs.length < 2) return res.json({ data: [] })

    const ids = docs.map(d => d.id)
    const contentById = new Map(docs.map(d => [d.id, { title: d.title, content: d.content }]))

    const { rows: embeddedRows } = await pool.query<{ document_id: string }>(
      `SELECT document_id FROM document_chunks WHERE chunk_index = -1 AND document_id = ANY($1)`,
      [ids]
    )
    const embeddedIds = embeddedRows.map(r => r.document_id)
    const embeddedSet = new Set(embeddedIds)
    const noEmbeddingIds = ids.filter(id => !embeddedSet.has(id))

    const candidatePairs = new Map<string, [string, string]>()
    const addPair = (a: string, b: string) => {
      if (a === b) return
      const [x, y] = a < b ? [a, b] : [b, a]
      candidatePairs.set(`${x}|${y}`, [x, y])
    }

    if (embeddedIds.length >= 2) {
      const { rows: shortlist } = await pool.query<{ doc_a: string; doc_b: string }>(
        `SELECT a.document_id AS doc_a, b.document_id AS doc_b
         FROM document_chunks a
         JOIN document_chunks b ON a.document_id < b.document_id AND b.chunk_index = -1
         WHERE a.chunk_index = -1
           AND a.document_id = ANY($1) AND b.document_id = ANY($1)
           AND (1 - (a.embedding <=> b.embedding)) >= $2`,
        [embeddedIds, DUPLICATE_SHORTLIST_COSINE]
      )
      for (const p of shortlist) addPair(p.doc_a, p.doc_b)
    }
    for (const noEmbId of noEmbeddingIds) {
      for (const otherId of ids) addPair(noEmbId, otherId)
    }

    const results: { docA: { id: string; title: string }; docB: { id: string; title: string }; score: number }[] = []
    let pairsProcessed = 0
    for (const [idA, idB] of candidatePairs.values()) {
      const a = contentById.get(idA)
      const b = contentById.get(idB)
      if (a && b) {
        const score = lineSimilarity(
          a.content.slice(0, DUPLICATE_COMPARE_CHARS),
          b.content.slice(0, DUPLICATE_COMPARE_CHARS)
        )
        if (score >= DUPLICATE_CONFIRM_MIN_SCORE) {
          results.push({ docA: { id: idA, title: a.title }, docB: { id: idB, title: b.title }, score })
        }
      }
      if (++pairsProcessed % DUPLICATE_YIELD_EVERY_N_PAIRS === 0) await yieldToEventLoop()
    }
    results.sort((x, y) => y.score - x.score)

    res.json({ data: results.slice(0, DUPLICATE_MAX_RESULTS) })
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

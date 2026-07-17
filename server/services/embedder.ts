import { pool } from '../db/pool.js'
import { aiEmbed, aiChat } from './ai.js'
import { rerank } from './reranker.js'
import { chunkCodeByAst } from './codeChunker.js'
import { countTokens, splitByTokenWindow, TARGET_CHUNK_TOKENS, MIN_CHUNK_TOKENS } from './tokenChunker.js'

export { countTokens }

// Retry wrapper for transient Ollama failures during bulk embed operations.
// Waits 500ms × attempt before each retry (500ms, 1000ms, 1500ms).
async function embedWithRetry(text: string, maxAttempts = 3): Promise<number[]> {
  let lastErr: Error = new Error('embed failed')
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await aiEmbed(text)
    } catch (err) {
      lastErr = err as Error
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 500 * attempt))
      }
    }
  }
  throw lastErr
}

// ── Chunking ─────────────────────────────────────────────────────────────
// Token-counted (not char-counted) so chunk size actually tracks what the
// embedding model sees, with a Markdown-header-aware pre-split so a section
// that already fits in one chunk doesn't get arbitrarily cut mid-thought.
// (Tokenizer + generic window-splitter live in tokenChunker.ts, shared with
// codeChunker.ts — see the import above.)

const MD_HEADER_LINE_RE = /^#{1,3}\s+.+$/
const HAS_MD_HEADERS_RE = /^#{1,3}\s+.+$/m

// Splits on Markdown header lines (#, ##, ###), keeping each header attached
// to the section that follows it.
function splitByMarkdownHeaders(text: string): string[] {
  const lines    = text.split('\n')
  const sections: string[] = []
  let   current: string[]  = []

  for (const line of lines) {
    if (MD_HEADER_LINE_RE.test(line) && current.length > 0) {
      sections.push(current.join('\n'))
      current = [line]
    } else {
      current.push(line)
    }
  }
  if (current.length) sections.push(current.join('\n'))

  return sections.filter(s => s.trim().length > 0)
}

function chunkText(text: string): string[] {
  const sections = HAS_MD_HEADERS_RE.test(text) ? splitByMarkdownHeaders(text) : [text]

  const chunks: string[] = []
  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    if (countTokens(trimmed) <= TARGET_CHUNK_TOKENS) {
      chunks.push(trimmed)
    } else {
      chunks.push(...splitByTokenWindow(trimmed))
    }
  }

  // Drop degenerate fragments (a stray header with no body before the next
  // one, etc.) — but never let filtering empty out a short-but-real document
  // down to zero chunks, or it becomes unsearchable in RAG entirely.
  const substantial = chunks.filter(c => countTokens(c) >= MIN_CHUNK_TOKENS)
  return substantial.length > 0 ? substantial : chunks
}

// ── Summary-first hierarchical retrieval ────────────────────────────────
// A short document-level summary, embedded as its own row so it can surface
// in hybrid search alongside regular content chunks — useful when a query is
// answered better by "what is this document about" than by any single chunk.
// Stored in document_chunks with chunk_index = -1 (sentinel: not real
// content) so it rides the existing hybrid-search/rerank pipeline for free.

const SUMMARY_SOURCE_CHARS = 6000  // enough for a representative summary without an oversized prompt
const SUMMARY_CHUNK_INDEX  = -1

async function summarizeDocument(text: string): Promise<string | null> {
  try {
    const summary = await aiChat(
      `Summarize the following document in one concise paragraph (3-5 sentences), capturing its main topic and key points. Return ONLY the summary paragraph, no preamble or heading.\n\nDocument:\n${text.slice(0, SUMMARY_SOURCE_CHARS)}`,
      'You are a technical summarizer for a developer knowledge base.'
    )
    const trimmed = summary.trim()
    return trimmed || null
  } catch {
    return null // non-fatal — a failed summary shouldn't block embedding the real chunks
  }
}

export type EmbedProgress = (done: number, total: number) => void

/**
 * Chunk `text`, embed each chunk via Ollama, and store in `document_chunks`
 * (plus a document-level summary row, see above). Deletes any existing
 * chunks first so this function is idempotent on update.
 * @param documentId - id of the parent document row
 * @param text       - Full extracted plain-text content
 * @param opts.title       - Document title, prepended as a small metadata header to
 *                           each chunk before embedding/storage — improves citation
 *                           accuracy and lets full-text search match on title terms too.
 * @param opts.language    - Source language for code documents (e.g. 'typescript',
 *                           'python') — when set and supported, chunks split at
 *                           function/class boundaries via tree-sitter instead of blind
 *                           token windows. Falls back to the generic chunker for
 *                           unsupported languages or on any parse error.
 * @param opts.onProgress  - Optional callback fired after each real content chunk is stored
 * @returns Number of real content chunks written (excludes the summary row)
 */
export async function embedDocument(
  documentId: string,
  text:       string,
  opts: { title?: string; language?: string | null; onProgress?: EmbedProgress } = {}
): Promise<number> {
  const { title, language, onProgress } = opts

  // Clear any existing chunks for this doc (re-embed on update) — includes
  // the summary row from a previous embed, if any.
  await pool.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId])

  const summary = await summarizeDocument(text)
  if (summary) {
    const summaryChunk = title ? `[${title}]\n\n${summary}` : summary
    const embedding = await embedWithRetry(summaryChunk)
    await pool.query(
      `INSERT INTO document_chunks (document_id, content, chunk_index, embedding)
       VALUES ($1, $2, $3, $4)`,
      [documentId, summaryChunk, SUMMARY_CHUNK_INDEX, JSON.stringify(embedding)]
    )
  }

  const astChunks = await chunkCodeByAst(text, language)
  const rawChunks = astChunks ?? chunkText(text)
  const chunks    = title ? rawChunks.map(c => `[${title}]\n\n${c}`) : rawChunks

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await embedWithRetry(chunks[i])

    await pool.query(
      `INSERT INTO document_chunks (document_id, content, chunk_index, embedding)
       VALUES ($1, $2, $3, $4)`,
      [documentId, chunks[i], i, JSON.stringify(embedding)]
    )

    onProgress?.(i + 1, chunks.length)
  }

  return chunks.length
}

export type BatchDoc    = { id: string; content: string; title?: string; language?: string | null }
export type BatchResult = { id: string; chunkCount: number; error?: string }

/**
 * Same per-document work as embedDocument(), but phase-separated across the
 * whole batch: every document's summary (aiChat → mistral) is generated
 * before any document's chunks are embedded (aiEmbed → nomic-embed-text),
 * instead of alternating chat → embed → chat → embed once per document.
 *
 * Why: the 2026-07-15 incident (see TASKS.md Known Issues) showed that even
 * a purely *sequential* one-doc-at-a-time loop calling embedDocument()
 * repeatedly degraded Ollama into a hung/thrashing state on the 6GB laptop
 * GPU — because each call swaps mistral in for the summary, then nomic-embed-
 * text back in for the chunks, so N documents means ~2N swaps in quick
 * succession. Grouping all-chat-then-all-embed cuts that to 2 swaps total
 * regardless of batch size. Used by bulk re-embed paths (PATCH /documents/bulk,
 * rechunk_all_documents.ts); single-document call sites keep using
 * embedDocument() since one document is only 2 swaps either way.
 *
 * One document's failure is captured in its BatchResult, not thrown — it
 * never aborts the rest of the batch.
 */
export async function embedDocumentsBatch(
  docs: BatchDoc[],
  onProgress?: (docId: string, done: number, total: number) => void
): Promise<BatchResult[]> {
  if (docs.length === 0) return []

  await pool.query('DELETE FROM document_chunks WHERE document_id = ANY($1)', [docs.map(d => d.id)])

  // Phase 1 — all summaries (mistral loaded once for the whole batch)
  const summaries = new Map<string, string | null>()
  for (const doc of docs) {
    summaries.set(doc.id, await summarizeDocument(doc.content))
  }

  // Phase 2 — chunking is CPU-only (tree-sitter / token-window), no model calls
  const chunkSets = new Map<string, string[]>()
  for (const doc of docs) {
    const astChunks = await chunkCodeByAst(doc.content, doc.language)
    const rawChunks = astChunks ?? chunkText(doc.content)
    chunkSets.set(doc.id, doc.title ? rawChunks.map(c => `[${doc.title}]\n\n${c}`) : rawChunks)
  }

  // Phase 3 — all embeddings (nomic-embed-text loaded once for the whole batch)
  const results: BatchResult[] = []
  for (const doc of docs) {
    try {
      const summary = summaries.get(doc.id)
      if (summary) {
        const summaryChunk = doc.title ? `[${doc.title}]\n\n${summary}` : summary
        const embedding = await embedWithRetry(summaryChunk)
        await pool.query(
          `INSERT INTO document_chunks (document_id, content, chunk_index, embedding)
           VALUES ($1, $2, $3, $4)`,
          [doc.id, summaryChunk, SUMMARY_CHUNK_INDEX, JSON.stringify(embedding)]
        )
      }

      const chunks = chunkSets.get(doc.id) ?? []
      for (let i = 0; i < chunks.length; i++) {
        const embedding = await embedWithRetry(chunks[i])
        await pool.query(
          `INSERT INTO document_chunks (document_id, content, chunk_index, embedding)
           VALUES ($1, $2, $3, $4)`,
          [doc.id, chunks[i], i, JSON.stringify(embedding)]
        )
        onProgress?.(doc.id, i + 1, chunks.length)
      }

      results.push({ id: doc.id, chunkCount: chunks.length })
    } catch (err) {
      results.push({ id: doc.id, chunkCount: 0, error: (err as Error).message })
    }
  }

  return results
}

// Reciprocal Rank Fusion constant — standard default from the IR literature,
// also what SurfSense/most hybrid-search implementations use.
const RRF_K = 60
// How many candidates each of the vector/full-text searches contributes
// before fusion — wider than the final result so fusion has something to work with.
const CANDIDATE_POOL_SIZE = 20
// Cosine-similarity floor below which a chunk is considered noise, not context.
const MIN_RELEVANCE_SCORE = 0.3
// Post-fusion pool handed to the cross-encoder reranker before cutting down
// to the caller's requested `limit`.
const RERANK_POOL_SIZE = 20
// Below this many fused candidates, pull in recently-cited chunks from
// conversation history as extra candidates (see `backfillChunkIds`).
const BACKFILL_THRESHOLD = 3

type ScopeOpts = { projectId?: string | null; documentId?: string | null; component?: string | null }
type ChunkRow  = { id: string; chunk: string; documentId: string; documentTitle: string; chunkIndex: number; score: number }

// Shared by both the main hybrid query and the backfill lookup so document/
// project/component scoping stays identical between them. documentId takes
// precedence (single-doc precision beats group scoping); projectId and
// component compose with AND when both are given.
function buildScopeCondition(opts: ScopeOpts, startIdx: number): { sql: string; values: unknown[] } {
  const conditions: string[] = []
  const values: unknown[]    = []
  let   idx                  = startIdx

  if (opts.documentId) {
    conditions.push(`dc.document_id = $${idx++}`)
    values.push(opts.documentId)
  } else {
    if (opts.projectId) {
      conditions.push(`d.project_id = $${idx++}`)
      values.push(opts.projectId)
    }
    if (opts.component) {
      conditions.push(`d.component = $${idx++}`)
      values.push(opts.component)
    }
  }

  return { sql: conditions.length ? `AND ${conditions.join(' AND ')}` : '', values }
}

// Fetches specific chunks by id (e.g. ones cited earlier in the conversation),
// scoped the same way the main search was, with a real cosine-similarity score
// against the current query rather than a stale/made-up one.
async function getChunksByIds(ids: string[], queryEmbedding: number[], scope: ScopeOpts): Promise<ChunkRow[]> {
  if (ids.length === 0) return []

  const { sql: where, values: scopeValues } = buildScopeCondition(scope, 3)
  const values = [ids, JSON.stringify(queryEmbedding), ...scopeValues]

  const { rows } = await pool.query(
    `SELECT
       dc.id, dc.content AS chunk, dc.document_id AS "documentId",
       d.title AS "documentTitle", dc.chunk_index AS "chunkIndex",
       1 - (dc.embedding <=> $2::vector) AS score
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE dc.id = ANY($1)
     ${where}`,
    values
  )

  return rows
}

/**
 * Hybrid search over `document_chunks`: pgvector cosine similarity fused with
 * Postgres full-text ranking via Reciprocal Rank Fusion (RRF), then reranked
 * by a CPU cross-encoder before returning the final top-N. Optionally scoped
 * to a single document, or combined project + component.
 *
 * When the fused result is thin (e.g. a follow-up question like "what about
 * the second one?" carries no retrievable meaning on its own), pass
 * `backfillChunkIds` — chunk ids cited in recent conversation turns — to pull
 * them in as extra candidates before reranking.
 * @returns Rows sorted by descending relevance, capped at `opts.limit` (default 5),
 *   with chunks below `MIN_RELEVANCE_SCORE` dropped before reranking.
 */
export async function searchChunks(
  queryEmbedding: number[],
  queryText: string,
  opts: ScopeOpts & {
    limit?:            number
    backfillChunkIds?: string[]
  } = {}
): Promise<ChunkRow[]> {
  const { projectId, documentId, component, limit = 5, backfillChunkIds = [] } = opts

  const { sql: where, values: scopeValues } = buildScopeCondition({ projectId, documentId, component }, 4)
  const values: unknown[] = [JSON.stringify(queryEmbedding), queryText, CANDIDATE_POOL_SIZE, ...scopeValues]
  const limitIdx           = 4 + scopeValues.length
  values.push(RERANK_POOL_SIZE)

  const { rows } = await pool.query(
    `WITH vector_hits AS (
       SELECT
         dc.id, dc.content, dc.document_id, dc.chunk_index, d.title,
         1 - (dc.embedding <=> $1::vector) AS score,
         ROW_NUMBER() OVER (ORDER BY dc.embedding <=> $1::vector) AS rank
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       WHERE dc.embedding IS NOT NULL
       ${where}
       ORDER BY dc.embedding <=> $1::vector
       LIMIT $3
     ),
     text_hits AS (
       SELECT
         dc.id, dc.content, dc.document_id, dc.chunk_index, d.title,
         1 - (dc.embedding <=> $1::vector) AS score,
         ROW_NUMBER() OVER (ORDER BY ts_rank_cd(dc.tsv, plainto_tsquery('english', $2)) DESC) AS rank
       FROM document_chunks dc
       JOIN documents d ON d.id = dc.document_id
       WHERE dc.embedding IS NOT NULL
         AND dc.tsv @@ plainto_tsquery('english', $2)
       ${where}
       ORDER BY ts_rank_cd(dc.tsv, plainto_tsquery('english', $2)) DESC
       LIMIT $3
     ),
     fused AS (
       SELECT id, content, document_id, chunk_index, title, score, rank FROM vector_hits
       UNION ALL
       SELECT id, content, document_id, chunk_index, title, score, rank FROM text_hits
     )
     SELECT
       id,
       MAX(content)     AS chunk,
       MAX(document_id) AS "documentId",
       MAX(title)       AS "documentTitle",
       MAX(chunk_index) AS "chunkIndex",
       MAX(score)       AS score,
       SUM(1.0 / (${RRF_K} + rank)) AS "rrfScore"
     FROM fused
     GROUP BY id
     ORDER BY "rrfScore" DESC
     LIMIT $${limitIdx}`,
    values
  )

  let candidates: ChunkRow[] = rows.filter((r: ChunkRow) => r.score >= MIN_RELEVANCE_SCORE)

  if (candidates.length < BACKFILL_THRESHOLD && backfillChunkIds.length > 0) {
    const haveIds = new Set(candidates.map(c => c.id))
    const toFetch = backfillChunkIds.filter(id => !haveIds.has(id))
    if (toFetch.length > 0) {
      const backfilled = await getChunksByIds(toFetch, queryEmbedding, { projectId, documentId, component })
      candidates = [...candidates, ...backfilled.filter(c => c.score >= MIN_RELEVANCE_SCORE)]
    }
  }

  return rerank(queryText, candidates, r => r.chunk, limit)
}

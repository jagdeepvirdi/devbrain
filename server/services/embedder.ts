import { pool } from '../db/pool.js'
import { aiEmbed } from './ai.js'

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

// Chunk settings matching CLAUDE.md spec.
// ~512 tokens ≈ 1800 chars at average English token density.
const CHUNK_CHARS    = 1800
const OVERLAP_CHARS  = 230  // ~64 tokens overlap

function chunkText(text: string): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < text.length) {
    const end   = Math.min(start + CHUNK_CHARS, text.length)
    const chunk = text.slice(start, end).trim()
    if (chunk.length > 0) chunks.push(chunk)
    if (end >= text.length) break
    start = end - OVERLAP_CHARS
  }

  return chunks
}

export type EmbedProgress = (done: number, total: number) => void

export async function embedDocument(
  documentId: string,
  text:        string,
  onProgress?: EmbedProgress
): Promise<number> {
  // Clear any existing chunks for this doc (re-embed on update)
  await pool.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId])

  const chunks = chunkText(text)

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

export async function searchChunks(
  queryEmbedding: number[],
  opts: {
    projectId?:  string | null
    documentId?: string | null
    limit?:      number
  } = {}
): Promise<Array<{ chunk: string; documentId: string; documentTitle: string; chunkIndex: number; score: number }>> {
  const { projectId, documentId, limit = 5 } = opts

  const conditions: string[] = []
  const values: unknown[]    = [JSON.stringify(queryEmbedding), limit]
  let   idx                  = 3

  if (documentId) {
    conditions.push(`dc.document_id = $${idx++}`)
    values.push(documentId)
  } else if (projectId) {
    conditions.push(`d.project_id = $${idx++}`)
    values.push(projectId)
  }

  const where = conditions.length ? `AND ${conditions.join(' AND ')}` : ''

  const { rows } = await pool.query(
    `SELECT
       dc.content        AS chunk,
       dc.document_id    AS "documentId",
       d.title           AS "documentTitle",
       dc.chunk_index    AS "chunkIndex",
       1 - (dc.embedding <=> $1::vector) AS score
     FROM document_chunks dc
     JOIN documents d ON d.id = dc.document_id
     WHERE dc.embedding IS NOT NULL
     ${where}
     ORDER BY dc.embedding <=> $1::vector
     LIMIT $2`,
    values
  )

  return rows
}

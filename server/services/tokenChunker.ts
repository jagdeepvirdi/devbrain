import { getEncoding } from 'js-tiktoken'

// Shared by embedder.ts (generic prose chunking) and codeChunker.ts
// (AST-aware code chunking, for the one case where a single declaration is
// too big and has no finer AST boundary to split by) — kept in its own
// module so neither of those two needs to import from the other.

const enc = getEncoding('cl100k_base')

/** Token count for `text` under the same encoding used for chunk sizing. */
export function countTokens(text: string): number {
  return enc.encode(text).length
}

export const TARGET_CHUNK_TOKENS = 512
export const OVERLAP_TOKENS      = 80   // ~15%, matching common RAG chunking defaults
export const MIN_CHUNK_TOKENS    = 10   // drop near-empty fragments (stray headers, page breaks)

export function splitByTokenWindow(text: string): string[] {
  const tokens = enc.encode(text)
  const chunks: string[] = []
  let start = 0

  while (start < tokens.length) {
    const end        = Math.min(start + TARGET_CHUNK_TOKENS, tokens.length)
    const chunkTokens = tokens.slice(start, end)
    const chunk        = enc.decode(chunkTokens).trim()
    if (chunk.length > 0) chunks.push(chunk)
    if (end >= tokens.length) break
    start = end - OVERLAP_TOKENS
  }

  return chunks
}

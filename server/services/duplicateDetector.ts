// ── Duplicate code file detection ───────────────────────────────────────────
// Two-phase: callers shortlist candidate pairs cheaply (e.g. via existing
// pgvector summary embeddings, see routes/documents.ts POST /find-duplicates),
// then use lineSimilarity() here for a precise, deterministic "% of lines
// shared" score — the actual signal for "same code, renamed or lightly
// edited" duplicates. No AI call needed for this half.

/** Trims each line and drops blank ones, so reformatting/indentation noise doesn't affect the score. */
export function normalizeLines(content: string): string[] {
  return content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
}

/**
 * Sørensen–Dice coefficient over line multisets: 2 * shared / (linesA.length + linesB.length).
 * Order-insensitive (a reordered block still counts as shared) but multiset-aware — a line
 * repeated 3 times in one file and only once in the other contributes 1 shared line, not 3.
 * Returns a 0–1 score; 1 means identical (post-normalization) line multisets.
 */
export function lineSimilarity(contentA: string, contentB: string): number {
  const linesA = normalizeLines(contentA)
  const linesB = normalizeLines(contentB)

  if (linesA.length === 0 && linesB.length === 0) return 1
  if (linesA.length === 0 || linesB.length === 0) return 0

  const countA = new Map<string, number>()
  for (const line of linesA) countA.set(line, (countA.get(line) ?? 0) + 1)

  const countB = new Map<string, number>()
  for (const line of linesB) countB.set(line, (countB.get(line) ?? 0) + 1)

  let shared = 0
  for (const [line, a] of countA) {
    const b = countB.get(line)
    if (b) shared += Math.min(a, b)
  }

  return (2 * shared) / (linesA.length + linesB.length)
}

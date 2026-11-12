import { describe, it, expect } from 'vitest'
import { getParser, LANGUAGE_WASM, TREE_SITTER_LANGUAGES } from '../../services/treeSitterLoader.js'

// getParser() is the shared grammar-loading path behind both codeChunker.ts
// (RAG chunking/symbol outlines) and services/codeIntel (entity/call-graph
// extraction) — no test exercised it directly before, only indirectly
// through treeSitterParser.test.ts. These lock in the two contracts both
// callers rely on: a real, working Parser for a supported language, and a
// null (never a throw) for anything unsupported — matching the real WASM
// loading treeSitterParser.test.ts already does, no mocking.
describe('treeSitterLoader', () => {
  it('TREE_SITTER_LANGUAGES matches the LANGUAGE_WASM keys exactly', () => {
    expect(TREE_SITTER_LANGUAGES.sort()).toEqual(Object.keys(LANGUAGE_WASM).sort())
  })

  it('loads a real parser for a supported language that can parse valid source', async () => {
    const parser = await getParser('typescript')
    expect(parser).not.toBeNull()

    const tree = parser!.parse('const x: number = 1')
    expect(tree).toBeTruthy()
    expect(tree!.rootNode.hasError).toBe(false)
  })

  it('caches the underlying grammar across repeated calls for the same language', async () => {
    const first  = await getParser('typescript')
    const second = await getParser('typescript')
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    // Both are independent Parser instances sharing the cached Language —
    // each must still parse correctly on its own.
    expect(second!.parse('const y = 2')!.rootNode.hasError).toBe(false)
  })

  it('returns null, not a throw, for a language with no prebuilt grammar', async () => {
    await expect(getParser('cobol')).resolves.toBeNull()
  })

  it('returns null for null/undefined language without touching the loader', async () => {
    await expect(getParser(null)).resolves.toBeNull()
    await expect(getParser(undefined)).resolves.toBeNull()
  })
})

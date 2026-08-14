import type { Node as SyntaxNode } from 'web-tree-sitter'
import { countTokens, splitByTokenWindow, TARGET_CHUNK_TOKENS, MIN_CHUNK_TOKENS } from './tokenChunker.js'
import { getParser, TREE_SITTER_LANGUAGES } from './treeSitterLoader.js'

// Node types that read as a "declaration" worth its own chunk, across
// tree-sitter grammars generally. Grammars name nodes inconsistently
// (function_declaration / function_definition / function_item / ...), so
// this matches by substring instead of maintaining a per-language node-type
// table for all 16 supported languages.
const BOUNDARY_RE = /function|method|class|struct|enum|interface|impl|trait|constructor/i

function pushChunk(chunks: string[], text: string): void {
  const trimmed = text.trim()
  if (trimmed) chunks.push(trimmed)
}

// `export function foo() {}` / `export class Foo {}` etc. parse as a
// wrapper node (export_statement, export_declaration, ...) whose own type
// doesn't match BOUNDARY_RE, with the actual function_declaration/
// class_declaration one level down as its child — an extremely common
// top-level pattern in TS/JS (including this codebase), so it's checked
// explicitly rather than only matching the child's own node type.
function isBoundaryNode(node: SyntaxNode): boolean {
  if (BOUNDARY_RE.test(node.type)) return true
  return node.namedChildren.some(c => c !== null && BOUNDARY_RE.test(c.type))
}

// Single-pass walk over a node's named children: accumulates small
// consecutive statements into one chunk, starts a fresh chunk at each
// declaration-like boundary, and flushes whenever the running buffer
// crosses the token budget. A single declaration bigger than the budget on
// its own (e.g. one huge function) has no finer AST boundary to split by,
// so it falls back to the plain token-window splitter for just that node.
function walkNode(root: SyntaxNode, source: string): string[] {
  const chunks: string[] = []
  const children = root.namedChildren.filter((c): c is SyntaxNode => c !== null)
  if (children.length === 0) return chunks

  let bufStart = children[0].startIndex

  for (const child of children) {
    const isBoundary = isBoundaryNode(child)

    if (isBoundary && child.startIndex > bufStart) {
      const pendingTokens = countTokens(source.slice(bufStart, child.startIndex))
      if (pendingTokens > 0) {
        pushChunk(chunks, source.slice(bufStart, child.startIndex))
        bufStart = child.startIndex
      }
    }

    const throughChildTokens = countTokens(source.slice(bufStart, child.endIndex))
    if (throughChildTokens > TARGET_CHUNK_TOKENS) {
      if (isBoundary && child.startIndex === bufStart) {
        // The declaration itself is the whole (oversized) buffer.
        for (const piece of splitByTokenWindow(source.slice(child.startIndex, child.endIndex))) {
          pushChunk(chunks, piece)
        }
      } else {
        pushChunk(chunks, source.slice(bufStart, child.endIndex))
      }
      bufStart = child.endIndex
    }
  }

  if (bufStart < root.endIndex) {
    pushChunk(chunks, source.slice(bufStart, root.endIndex))
  }

  return chunks
}

/**
 * AST-aware chunking for a supported source-code `language` — splits at
 * function/class/method boundaries instead of blind token windows, so a
 * chunk reads as one coherent unit of code (better citation accuracy, better
 * embedding quality than a window that starts/ends mid-function).
 * Returns null (never throws) when the language has no grammar available or
 * the source fails to parse cleanly — callers should fall back to the
 * generic chunker in that case, exactly like the rest of this codebase
 * degrades gracefully when an optional capability isn't available.
 */
export async function chunkCodeByAst(text: string, language: string | null | undefined): Promise<string[] | null> {
  const parser = await getParser(language)
  if (!parser) return null

  try {
    const tree = parser.parse(text)
    if (!tree || tree.rootNode.hasError) return null

    const chunks = walkNode(tree.rootNode, text)
    if (chunks.length === 0) return null

    const substantial = chunks.filter(c => countTokens(c) >= MIN_CHUNK_TOKENS)
    return substantial.length > 0 ? substantial : chunks
  } catch {
    return null
  }
}

// Recursively collects one line per declaration-like node (its signature —
// the first source line of the node, not the full body), so a whole file's
// shape can be summarized in a handful of lines instead of dumping its full
// text. This is the "rank symbols, don't dump everything" idea behind
// Aider's repo map, reused here for the component-overview feature.
function collectSignatures(node: SyntaxNode, source: string, out: string[], cap: number): void {
  const children = node.namedChildren.filter((c): c is SyntaxNode => c !== null)
  for (const child of children) {
    if (out.length >= cap) return
    if (isBoundaryNode(child)) {
      const raw = source.slice(child.startIndex, child.endIndex)
      const firstLine = raw.split('\n')[0].trim()
      if (firstLine) out.push(firstLine.length > 160 ? firstLine.slice(0, 160) + '…' : firstLine)
    }
    collectSignatures(child, source, out, cap)
  }
}

/**
 * Extracts a compact "signature outline" for a source file — one line per
 * top-level (and nested) function/class/method declaration, in source
 * order — instead of the full file text. Same null-on-unsupported/
 * parse-error contract as chunkCodeByAst(), for the same reason: callers
 * fall back to a plain truncated snippet when this returns null.
 */
export async function extractSymbolOutline(text: string, language: string | null | undefined, cap = 40): Promise<string[] | null> {
  const parser = await getParser(language)
  if (!parser) return null

  try {
    const tree = parser.parse(text)
    if (!tree || tree.rootNode.hasError) return null

    const out: string[] = []
    collectSignatures(tree.rootNode, text, out, cap)
    return out.length > 0 ? out : null
  } catch {
    return null
  }
}

export const AST_CHUNKABLE_LANGUAGES = TREE_SITTER_LANGUAGES

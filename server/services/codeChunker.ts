import path from 'node:path'
import { createRequire } from 'node:module'
import { Parser, Language, type Node as SyntaxNode } from 'web-tree-sitter'
import { countTokens, splitByTokenWindow, TARGET_CHUNK_TOKENS, MIN_CHUNK_TOKENS } from './tokenChunker.js'

// web-tree-sitter and tree-sitter-wasms are pinned to exact versions in
// package.json (0.25.10 / 0.1.13) — NOT a mismatch to "fix" by bumping.
// web-tree-sitter >=0.26 changed the expected wasm module format (requires
// a "dylink" metadata section); tree-sitter-wasms@0.1.13's prebuilt
// grammars predate that and fail to load under it ("getDylinkMetadata"
// error) even though both packages import/typecheck fine together. Bump
// only after confirming a newer tree-sitter-wasms release is compatible.

const require = createRequire(import.meta.url)

// ── Language -> grammar wasm file ───────────────────────────────────────
// Only languages with a prebuilt grammar in tree-sitter-wasms are listed.
// Anything else (powershell, svelte, perl, sql, plsql, ...) has no entry,
// so chunkCodeByAst() returns null and the caller falls back to the plain
// token-window chunker — same fallback pattern parser.ts uses for MarkItDown.
const LANGUAGE_WASM: Record<string, string> = {
  typescript: 'tree-sitter-typescript.wasm',
  javascript: 'tree-sitter-javascript.wasm',
  python:     'tree-sitter-python.wasm',
  dart:       'tree-sitter-dart.wasm',
  java:       'tree-sitter-java.wasm',
  kotlin:     'tree-sitter-kotlin.wasm',
  go:         'tree-sitter-go.wasm',
  rust:       'tree-sitter-rust.wasm',
  ruby:       'tree-sitter-ruby.wasm',
  php:        'tree-sitter-php.wasm',
  swift:      'tree-sitter-swift.wasm',
  c:          'tree-sitter-c.wasm',
  cpp:        'tree-sitter-cpp.wasm',
  csharp:     'tree-sitter-c_sharp.wasm',
  bash:       'tree-sitter-bash.wasm',
  vue:        'tree-sitter-vue.wasm',
}

// Node types that read as a "declaration" worth its own chunk, across
// tree-sitter grammars generally. Grammars name nodes inconsistently
// (function_declaration / function_definition / function_item / ...), so
// this matches by substring instead of maintaining a per-language node-type
// table for all 16 supported languages.
const BOUNDARY_RE = /function|method|class|struct|enum|interface|impl|trait|constructor/i

let wasmDir: string | null = null
function getWasmDir(): string {
  if (!wasmDir) {
    wasmDir = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out')
  }
  return wasmDir
}

let initPromise: Promise<void> | null = null
function ensureInit(): Promise<void> {
  if (!initPromise) initPromise = Parser.init()
  return initPromise
}

const languageCache = new Map<string, Language>()

async function loadLanguage(wasmFile: string): Promise<Language> {
  const cached = languageCache.get(wasmFile)
  if (cached) return cached
  await ensureInit()
  const lang = await Language.load(path.join(getWasmDir(), wasmFile))
  languageCache.set(wasmFile, lang)
  return lang
}

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
  if (!language) return null
  const wasmFile = LANGUAGE_WASM[language]
  if (!wasmFile) return null

  try {
    const lang = await loadLanguage(wasmFile)
    const parser = new Parser()
    parser.setLanguage(lang)
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

export const AST_CHUNKABLE_LANGUAGES = Object.keys(LANGUAGE_WASM)

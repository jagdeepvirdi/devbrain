import path from 'node:path'
import { createRequire } from 'node:module'
import { Parser, Language } from 'web-tree-sitter'

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
// Anything else (powershell, svelte, perl, sql, plsql, ...) has no entry, so
// getParser() returns null and callers fall back to whatever non-AST
// behavior fits their use case (plain token chunking, regex-based
// extraction, ...).
export const LANGUAGE_WASM: Record<string, string> = {
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

export const TREE_SITTER_LANGUAGES = Object.keys(LANGUAGE_WASM)

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

async function loadLanguageFile(wasmFile: string): Promise<Language> {
  const cached = languageCache.get(wasmFile)
  if (cached) return cached
  await ensureInit()
  const lang = await Language.load(path.join(getWasmDir(), wasmFile))
  languageCache.set(wasmFile, lang)
  return lang
}

/**
 * Loads the tree-sitter grammar for `language` and returns a ready-to-parse
 * Parser, or null if there's no prebuilt grammar for that language, or the
 * grammar fails to load. Never throws — callers fall back to whatever
 * non-AST behavior fits their use case, the same graceful-degradation
 * pattern used throughout this codebase (e.g. parseWithMarkItDown()).
 * Shared by codeChunker.ts (RAG chunking/symbol outlines) and
 * services/codeIntel (entity/call-graph extraction, TASKS.md Phase 40) —
 * one grammar-loading path, not two.
 */
export async function getParser(language: string | null | undefined): Promise<Parser | null> {
  if (!language) return null
  const wasmFile = LANGUAGE_WASM[language]
  if (!wasmFile) return null

  try {
    const lang = await loadLanguageFile(wasmFile)
    const parser = new Parser()
    parser.setLanguage(lang)
    return parser
  } catch {
    return null
  }
}

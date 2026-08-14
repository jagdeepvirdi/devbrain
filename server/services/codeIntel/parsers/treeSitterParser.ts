import { createHash } from 'node:crypto'
import path from 'node:path'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { getParser } from '../../treeSitterLoader.js'
import { CODE_EXT_LANGUAGE } from '../../parser.js'
import { buildNodeId } from '../types.js'
import type { CodeNode, UnresolvedRef, ParseResult } from '../types.js'
import type { BaseParser } from './base.js'

// Generic tree-sitter-based entity/call/import extraction, shared across the
// four languages already covered by treeSitterLoader.ts's prebuilt grammars
// that this phase targets: python, bash, typescript, javascript (see
// TASKS.md Phase 40). Node-type names differ per grammar (function_definition
// vs. function_declaration vs. ...), so per-language differences are kept to
// a small config table below rather than branching throughout — the same
// "match by convention, not an exhaustive per-language table" spirit as
// codeChunker.ts's BOUNDARY_RE.
//
// Bash's `psql -f`/`sqlplus @` special-casing is deliberately NOT here —
// that's parsers/bashParser.ts (Phase 40, later task), layered on top of
// this generic pass.

interface LangConfig {
  isFunction(type: string): boolean
  isClass(type: string): boolean
  isCall(type: string): boolean
  isImport(type: string): boolean
  callTarget(node: SyntaxNode): string | null
  importTarget(node: SyntaxNode): string | null
}

function lastIdentifierPart(text: string): string {
  // `obj.method(...)` / `pkg.Foo(...)` -> the callee's own name, not the
  // whole access chain — good enough to name-match against a known entity
  // in Pass 2 link resolution without tracking full expression types here.
  const parts = text.split(/[.:]+/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : text
}

function stripQuotes(text: string): string {
  return text.replace(/^['"`]|['"`]$/g, '')
}

const PYTHON_CONFIG: LangConfig = {
  isFunction: type => type === 'function_definition',
  isClass:    type => type === 'class_definition',
  isCall:     type => type === 'call',
  isImport:   type => type === 'import_statement' || type === 'import_from_statement',
  callTarget: node => {
    const fn = node.childForFieldName('function')
    return fn ? lastIdentifierPart(fn.text) : null
  },
  importTarget: node => {
    if (node.type === 'import_from_statement') {
      const mod = node.childForFieldName('module_name')
      return mod ? mod.text : null
    }
    const dotted = node.namedChildren.find(c => c !== null && (c.type === 'dotted_name' || c.type === 'aliased_import'))
    return dotted ? dotted.text : null
  },
}

const JS_TS_CONFIG: LangConfig = {
  isFunction: type => /^(function_declaration|generator_function_declaration|method_definition)$/.test(type),
  isClass:    type => type === 'class_declaration',
  isCall:     type => type === 'call_expression',
  isImport:   type => type === 'import_statement',
  callTarget: node => {
    const fn = node.childForFieldName('function')
    return fn ? lastIdentifierPart(fn.text) : null
  },
  importTarget: node => {
    const source = node.childForFieldName('source')
    return source ? stripQuotes(source.text) : null
  },
}

const BASH_CONFIG: LangConfig = {
  isFunction: type => type === 'function_definition',
  isClass:    () => false,
  isCall:     type => type === 'command',
  isImport:   () => false,
  callTarget: node => {
    const name = node.childForFieldName('name')
    return name ? name.text : null
  },
  importTarget: () => null,
}

const LANG_CONFIGS: Record<string, LangConfig> = {
  python:     PYTHON_CONFIG,
  typescript: JS_TS_CONFIG,
  javascript: JS_TS_CONFIG,
  bash:       BASH_CONFIG,
}

function extractName(node: SyntaxNode): string | null {
  const named = node.childForFieldName('name')
  if (named) return named.text
  const fallback = node.namedChildren.find(c => c !== null && /identifier|word|property_identifier/.test(c.type))
  return fallback ? fallback.text : null
}

// Python-only, best-effort: a function/class whose first body statement is a
// bare string literal follows the docstring convention. Other languages have
// no equivalent AST-level convention, so this is skipped for them (docstring
// stays undefined, which is a valid/expected state per the CodeNode schema).
function extractPythonDocstring(node: SyntaxNode): string | undefined {
  const body = node.childForFieldName('body')
  const first = body?.namedChildren.find(c => c !== null)
  if (!first || first.type !== 'expression_statement') return undefined
  const expr = first.namedChildren.find(c => c !== null)
  if (!expr || expr.type !== 'string') return undefined
  return expr.text.replace(/^['"]{1,3}|['"]{1,3}$/g, '').trim() || undefined
}

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function firstLine(text: string): string {
  const line = text.split('\n')[0].trim()
  return line.length > 200 ? line.slice(0, 200) + '…' : line
}

interface WalkState {
  filePath:  string
  projectId: string
  language:  string
  source:    string
  config:    LangConfig
  nodes:     CodeNode[]
  refs:      UnresolvedRef[]
}

function walk(node: SyntaxNode, state: WalkState, enclosingId: string): void {
  const { config } = state

  if (config.isFunction(node.type) || config.isClass(node.type)) {
    const name = extractName(node)
    // Anonymous (e.g. an unnamed function expression) — no stable name to
    // reference from elsewhere, so it can't be a graph entity. Still walk
    // its children below in case it contains named nested declarations.
    if (name) {
      const raw = state.source.slice(node.startIndex, node.endIndex)
      const entityType = config.isClass(node.type) ? 'class' : 'function'
      const id = buildNodeId(state.filePath, entityType, name)
      state.nodes.push({
        id,
        projectId:   state.projectId,
        filePath:    state.filePath,
        language:    state.language,
        entityType,
        name,
        signature:   firstLine(raw),
        docstring:   extractPythonDocstring(node),
        startLine:   node.startPosition.row + 1,
        endLine:     node.endPosition.row + 1,
        contentHash: hashContent(raw),
      })
      enclosingId = id
    }
  } else if (config.isCall(node.type)) {
    const target = config.callTarget(node)
    if (target) state.refs.push({ fromEntityId: enclosingId, rawTargetName: target, kind: 'call' })
  } else if (config.isImport(node.type)) {
    const target = config.importTarget(node)
    if (target) state.refs.push({ fromEntityId: enclosingId, rawTargetName: target, kind: 'import' })
  }

  for (const child of node.namedChildren) {
    if (child) walk(child, state, enclosingId)
  }
}

async function extractEntities(filePath: string, projectId: string, source: string, language: string): Promise<ParseResult> {
  const config = LANG_CONFIGS[language]
  const parser = config ? await getParser(language) : null
  if (!config || !parser) return { nodes: [], edges: [], unresolvedRefs: [] }

  const tree = parser.parse(source)
  if (!tree || tree.rootNode.hasError) return { nodes: [], edges: [], unresolvedRefs: [] }

  // One file-level 'script' node per file — the natural fromEntityId for
  // top-level calls/imports (outside any function), and the natural target
  // for a future INCLUDES edge ("this bash script sources that one").
  const fileName = path.basename(filePath)
  const fileNode: CodeNode = {
    id:          buildNodeId(filePath, 'script', fileName),
    projectId,
    filePath,
    language,
    entityType:  'script',
    name:        fileName,
    startLine:   1,
    endLine:     tree.rootNode.endPosition.row + 1,
    contentHash: hashContent(source),
  }

  const state: WalkState = { filePath, projectId, language, source, config, nodes: [fileNode], refs: [] }
  for (const child of tree.rootNode.namedChildren) {
    if (child) walk(child, state, fileNode.id)
  }

  return { nodes: state.nodes, edges: [], unresolvedRefs: state.refs }
}

// BaseParser's contract only takes (filePath, projectId, source) — language
// is inferred from the extension via the same CODE_EXT_LANGUAGE map the rest
// of the app already dispatches on (parser.ts, the Codes tab). A future
// caller that already knows the language (e.g. the indexer CLI, which
// resolves it once per file before dispatching to a parser) can call
// extractEntitiesForLanguage() directly instead.
export const treeSitterParser: BaseParser = {
  languages: Object.keys(LANG_CONFIGS),
  extractEntities: (filePath, projectId, source) => {
    const ext      = path.extname(filePath).slice(1).toLowerCase()
    const language = CODE_EXT_LANGUAGE[ext]
    return extractEntities(filePath, projectId, source, language ?? '')
  },
}

export function extractEntitiesForLanguage(filePath: string, projectId: string, source: string, language: string): Promise<ParseResult> {
  return extractEntities(filePath, projectId, source, language)
}

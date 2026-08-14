import { getParser } from '../../treeSitterLoader.js'
import { extractEntitiesForLanguage } from './treeSitterParser.js'
import { buildTableNodeId } from '../types.js'
import type { CodeNode, CodeEdge, ParseResult, UnresolvedRef, UnresolvedRefKind, RelationshipType } from '../types.js'
import type { BaseParser } from './base.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// Layers SQL-client invocation detection on top of treeSitterParser.ts's
// generic bash handling (TASKS.md Phase 40). Generic extraction already
// reports a `psql ...`/`sqlplus ...` line as an unresolved 'call' ref — but
// only the bare command name (`rawTargetName: 'psql'`), which resolves to
// nothing useful: the interesting part is which *script* or *procedure* it
// actually invoked, an argument, not the command itself. This module reads
// those arguments precisely off the real AST (tree-sitter-bash already
// parses a command's flags/operands as sibling nodes) rather than
// regex-scanning raw source text, which a connection string like
// `user/pass@host` would trip up (it contains '@' too, just not as the
// sqlplus script-invocation token).
//
// `psql -f file` / `sqlplus @file` -> kind: 'script_invocation' (resolves
// against a real file/script node later, in linkResolver.ts).
// `psql -c "<sql>"` -> classified the same way sql_bridge.py/perl_bridge.py
// already classify embedded SQL: a procedure call (EXEC/CALL/anonymous
// block) becomes kind: 'sql_exec' (consistent with how Perl's embedded DBI
// calls are classified — same semantic event, different host language), a
// plain DML statement becomes a direct READS_TABLE/WRITES_TABLE edge
// (table-only, no column detail — same reasoning as perl_bridge.py: a
// string embedded in another language, not a complete parseable statement
// sqlglot should be trusted with). This is a deliberate refinement over this
// item's original one-line task description ("...into unresolved
// kind: 'script_invocation' references") — treating -c the same as -f
// conflated two different real relationships; the original Decided section
// that introduced this task already grouped `psql -c "CALL proc(...)"` with
// the other procedure-call cases, which sql_exec (not script_invocation)
// actually represents.

const PROC_CALL_PATTERNS = [
  /\b(?:EXEC|EXECUTE)\s+([A-Za-z_]\w*)/i,
  /\{?\s*CALL\s+([A-Za-z_]\w*)/i,
  /\bBEGIN\s+([A-Za-z_]\w*)\s*\(/i,
]
const WRITE_TARGET_PATTERNS: [RegExp, Extract<RelationshipType, 'WRITES_TABLE'>][] = [
  [/\bINSERT\s+INTO\s+([A-Za-z_][\w$#]*)/i, 'WRITES_TABLE'],
  [/\bMERGE\s+INTO\s+([A-Za-z_][\w$#]*)/i, 'WRITES_TABLE'],
  [/\bUPDATE\s+([A-Za-z_][\w$#]*)\s+SET\b/i, 'WRITES_TABLE'],
  [/\bDELETE\s+FROM\s+([A-Za-z_][\w$#]*)/i, 'WRITES_TABLE'],
]
const READ_SOURCE_PATTERNS = [/\bFROM\s+([A-Za-z_][\w$#]*)/i, /\bJOIN\s+([A-Za-z_][\w$#]*)/i]

type Classified =
  | { refKind: Extract<UnresolvedRefKind, 'sql_exec' | 'script_invocation'>; target: string }
  | { tableRel: Extract<RelationshipType, 'READS_TABLE' | 'WRITES_TABLE'>; table: string }
  | null

function classifyInlineSql(sql: string): Classified {
  for (const pattern of PROC_CALL_PATTERNS) {
    const m = pattern.exec(sql)
    if (m) return { refKind: 'sql_exec', target: m[1].toLowerCase() }
  }
  for (const [pattern, rel] of WRITE_TARGET_PATTERNS) {
    const m = pattern.exec(sql)
    if (m) return { tableRel: rel, table: m[1].toLowerCase() }
  }
  for (const pattern of READ_SOURCE_PATTERNS) {
    const m = pattern.exec(sql)
    if (m) return { tableRel: 'READS_TABLE', table: m[1].toLowerCase() }
  }
  return null
}

interface CommandArg {
  text:     string
  isString: boolean // a "..."/'...' string node vs. a bare word
}

function commandArgs(commandNode: SyntaxNode): CommandArg[] {
  const args: CommandArg[] = []
  for (const child of commandNode.namedChildren) {
    if (!child || child.type === 'command_name') continue
    if (child.type === 'string') {
      const content = child.namedChildren.find(c => c !== null && c.type === 'string_content')
      args.push({ text: content ? content.text : child.text, isString: true })
    } else {
      args.push({ text: child.text, isString: false })
    }
  }
  return args
}

function extractSqlClientTarget(commandNode: SyntaxNode, commandName: string): Classified {
  const args = commandArgs(commandNode)

  if (commandName === 'psql') {
    const fIdx = args.findIndex(a => !a.isString && a.text === '-f')
    if (fIdx !== -1 && args[fIdx + 1]) return { refKind: 'script_invocation', target: args[fIdx + 1].text }
    const cIdx = args.findIndex(a => !a.isString && a.text === '-c')
    if (cIdx !== -1 && args[cIdx + 1]) return classifyInlineSql(args[cIdx + 1].text)
    return null
  }

  if (commandName === 'sqlplus') {
    // `@script.sql` is a distinct argument token starting with '@' — not to
    // be confused with a `user/pass@host` connection-string argument, which
    // contains '@' but doesn't *start* with it.
    const at = args.find(a => !a.isString && a.text.startsWith('@') && a.text.length > 1)
    if (at) return { refKind: 'script_invocation', target: at.text.slice(1) }
    return null
  }

  return null
}

// `source foo.sh` / `. foo.sh` — bash's own script-inclusion syntax, not a
// SQL client. Same reasoning as psql/sqlplus above: the generic bash pass
// already reports this line as a 'call' to the bare command name ('source'
// or '.', neither ever a real callable), which is why this needs its own
// handling rather than being left to the generic path.
function extractSourceTarget(commandNode: SyntaxNode): string | null {
  const target = commandArgs(commandNode).find(a => !a.isString)
  return target ? target.text : null
}

interface ScanState {
  projectId:       string
  functionsByLine: Map<number, string> // startLine -> node id, from base.nodes
  extraNodes:      CodeNode[]
  tableNodeIds:    Map<string, string>
  refs:            UnresolvedRef[]
  edges:           CodeEdge[]
}

function walk(node: SyntaxNode, state: ScanState, enclosingId: string): void {
  let nextEnclosing = enclosingId

  if (node.type === 'function_definition') {
    // Matched against base.nodes by start line rather than recomputing an
    // id from the node's own name — extractName() in treeSitterParser.ts
    // has a fallback path (searches namedChildren for an identifier/word if
    // the 'name' field itself is absent) that a bare childForFieldName('name')
    // read here wouldn't mirror, and any divergence would produce a
    // fromEntityId that doesn't match any real code_nodes row (a real FK
    // constraint, not just a cosmetic mismatch).
    const matched = state.functionsByLine.get(node.startPosition.row + 1)
    if (matched) nextEnclosing = matched
  } else if (node.type === 'command') {
    const commandName = node.childForFieldName('name')?.text ?? node.namedChildren[0]?.text
    if (commandName === 'psql' || commandName === 'sqlplus') {
      const classified = extractSqlClientTarget(node, commandName)
      if (classified) {
        if ('refKind' in classified) {
          state.refs.push({ fromEntityId: enclosingId, rawTargetName: classified.target, kind: classified.refKind })
        } else {
          let tableId = state.tableNodeIds.get(classified.table)
          if (!tableId) {
            tableId = buildTableNodeId(state.projectId, classified.table)
            state.tableNodeIds.set(classified.table, tableId)
            state.extraNodes.push({
              id: tableId, projectId: state.projectId, language: 'sql', entityType: 'table', name: classified.table,
            })
          }
          state.edges.push({ sourceId: enclosingId, targetId: tableId, relationshipType: classified.tableRel, columns: null })
        }
      }
    } else if (commandName === 'source' || commandName === '.') {
      const target = extractSourceTarget(node)
      if (target) state.refs.push({ fromEntityId: enclosingId, rawTargetName: target, kind: 'script_invocation' })
    }
  }

  for (const child of node.namedChildren) {
    if (child) walk(child, state, nextEnclosing)
  }
}

async function extractBashEntities(filePath: string, projectId: string, source: string): Promise<ParseResult> {
  const base = await extractEntitiesForLanguage(filePath, projectId, source, 'bash')

  const parser = await getParser('bash')
  if (!parser) return base
  const tree = parser.parse(source)
  if (!tree || tree.rootNode.hasError) return base

  // Read the file-level node's id straight off what extractEntitiesForLanguage
  // actually produced, rather than recomputing it independently — the two
  // must match exactly (code_unresolved_refs.from_entity_id has a real FK to
  // code_nodes.id), and reading it back is immune to ever silently drifting
  // out of sync with however treeSitterParser.ts builds that id.
  const fileNode = base.nodes.find(n => n.entityType === 'script')
  if (!fileNode) return base // defensive — treeSitterParser.ts always adds one; nothing to attach top-level refs to if it somehow didn't
  const fileNodeId = fileNode.id

  const functionsByLine = new Map<number, string>()
  for (const n of base.nodes) {
    if (n.entityType === 'function' && n.startLine !== undefined) functionsByLine.set(n.startLine, n.id)
  }
  const state: ScanState = {
    projectId, functionsByLine, extraNodes: [], tableNodeIds: new Map(), refs: [], edges: [],
  }
  for (const child of tree.rootNode.namedChildren) {
    if (child) walk(child, state, fileNodeId)
  }

  // Drop the generic 'call to psql/sqlplus/source/.' refs the base
  // extraction already produced for the same command nodes this module just
  // walked more precisely — this module's refs replace them, not add
  // alongside.
  const REPLACED_COMMAND_NAMES = new Set(['psql', 'sqlplus', 'source', '.'])
  const withoutGenericSqlClientCalls = base.unresolvedRefs.filter(
    r => !(r.kind === 'call' && REPLACED_COMMAND_NAMES.has(r.rawTargetName)),
  )

  return {
    nodes:          [...base.nodes, ...state.extraNodes],
    edges:          [...base.edges, ...state.edges],
    unresolvedRefs: [...withoutGenericSqlClientCalls, ...state.refs],
  }
}

export const bashParser: BaseParser = {
  languages: ['bash'],
  extractEntities: extractBashEntities,
}

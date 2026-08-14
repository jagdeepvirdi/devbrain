import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import fsPromises from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { buildNodeId, buildTableNodeId } from '../types.js'
import type { CodeNode, CodeEdge, UnresolvedRef, ParseResult, RelationshipType, UnresolvedRefKind, ProjectSqlSchema } from '../types.js'
import type { BaseParser } from './base.js'
import { CODE_EXT_LANGUAGE } from '../../parser.js'

const execFileAsync = promisify(execFile)

// Node-side wrapper around sql_bridge.py / perl_bridge.py (TASKS.md Phase 40)
// — runs the appropriate script, parses its JSON, and normalizes the raw
// (snake_case, name-keyed) output into CodeNode[]/CodeEdge[]/UnresolvedRef[].
// Same optional-local-Python-dependency contract as parseWithMarkItDown() in
// server/services/parser.ts: try/catch -> console.warn -> graceful fallback
// (empty ParseResult here, since BaseParser.extractEntities isn't nullable)
// when Python/sqlglot isn't installed or the script fails for any reason.
//
// Uses execFile (argv array), not exec (shell string interpolation) —
// deliberately, unlike markitdown_bridge.py's existing exec() call: a file
// path or --schema JSON containing shell metacharacters would otherwise be
// a real command-injection vector once interpolated into a shell command
// string. execFile never invokes a shell, so this is immune to that
// regardless of what characters appear in either argument.
//
// Script paths are resolved from THIS file's own location (like
// treeSitterLoader.ts resolves its wasm directory via require.resolve, not
// a cwd-relative guess), not a path relative to process.cwd() —
// deliberately: devbrain.sh/.ps1 both `cd server` before `npm run dev`, and
// the Docker image's WORKDIR is /app mapped from the server/ directory, so
// the *running server*'s cwd is always server/, never the repo root — but
// this module is also invoked by index-code-graph.ts, a standalone CLI
// script whose own cwd depends on wherever a human happens to run it from.
// A cwd-relative path ('server/scripts/...', matching parseWithMarkItDown()'s
// existing convention in parser.ts) would only be correct for one of these
// callers depending on unpredictable invocation context — resolving from
// import.meta.url is correct for both, unconditionally.
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'scripts')
const SQL_BRIDGE   = path.join(SCRIPTS_DIR, 'sql_bridge.py')
const PERL_BRIDGE  = path.join(SCRIPTS_DIR, 'perl_bridge.py')
const MAX_BUFFER   = 20 * 1024 * 1024 // generous — a big PL/SQL file's JSON output can run large

interface RawNode {
  entity_type: string
  name:        string
  signature?:  string | null
  start_line:  number
  end_line:    number
}
interface RawEdge {
  from_entity_name:  string | null
  relationship_type: 'READS_TABLE' | 'WRITES_TABLE'
  table:             string
  columns:           string[] | null
}
interface RawUnresolvedRef {
  from_entity_name: string | null
  raw_target_name:  string
  kind:              UnresolvedRefKind
}
interface RawResult {
  nodes:           RawNode[]
  edges:           RawEdge[]
  unresolved_refs: RawUnresolvedRef[]
}

async function runBridge(args: string[]): Promise<RawResult | null> {
  try {
    const { stdout } = await execFileAsync('python', args, { maxBuffer: MAX_BUFFER })
    return JSON.parse(stdout) as RawResult
  } catch (err) {
    console.warn(`Python bridge failed (${args.join(' ')}):`, (err as Error).message)
    return null
  }
}

function dialectFor(language: string): string {
  return language === 'plsql' ? 'oracle' : 'postgres'
}

async function runSqlBridge(filePath: string, language: string, schema?: ProjectSqlSchema): Promise<RawResult | null> {
  const args = [SQL_BRIDGE, filePath, '--dialect', dialectFor(language)]
  if (schema) args.push('--schema', JSON.stringify(schema))
  return runBridge(args)
}

async function runPerlBridge(filePath: string): Promise<RawResult | null> {
  return runBridge([PERL_BRIDGE, filePath])
}

function hashSource(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}

// The bridges only report line ranges, not byte offsets (they're not doing
// an AST parse with node spans the way treeSitterParser.ts is) — this
// reconstructs an entity's raw text from those line numbers so it can be
// content-hashed the same way every other parser's nodes are.
function hashLines(source: string, startLine: number, endLine: number): string {
  const lines = source.split('\n')
  const slice = lines.slice(Math.max(0, startLine - 1), endLine).join('\n')
  return hashSource(slice)
}

// Normalizes one bridge's raw JSON into a ParseResult. Every file gets the
// same one 'script' node treeSitterParser.ts gives its files — the resolved
// fromEntityId/sourceId for anything the bridge reported at file scope
// (`from_entity_name: null`), keeping the "every file has exactly one
// file-level node" invariant consistent across all parsers, tree-sitter- and
// bridge-based alike.
function normalize(raw: RawResult, filePath: string, projectId: string, language: string, source: string): ParseResult {
  const fileName   = path.basename(filePath)
  const fileNodeId = buildNodeId(filePath, 'script', fileName)

  const nodes: CodeNode[] = [{
    id: fileNodeId, projectId, filePath, language, entityType: 'script', name: fileName,
    startLine: 1, endLine: source.split('\n').length, contentHash: hashSource(source),
  }]

  const nameToId = new Map<string, string>()
  for (const n of raw.nodes) {
    const id = buildNodeId(filePath, n.entity_type, n.name)
    nameToId.set(n.name, id)
    nodes.push({
      id, projectId, filePath, language, entityType: n.entity_type, name: n.name,
      signature:   n.signature ?? undefined,
      startLine:   n.start_line,
      endLine:     n.end_line,
      contentHash: hashLines(source, n.start_line, n.end_line),
    })
  }

  // Defensive fallback (not expected in practice): a bridge script should
  // never reference an entity name it didn't itself report as a node, but
  // if it somehow did, attributing the edge/ref to the file rather than
  // dropping it keeps the data honest without crashing the whole file.
  const resolveFrom = (name: string | null): string => (name ? nameToId.get(name) ?? fileNodeId : fileNodeId)

  const tableNodeIds = new Map<string, string>()
  const edges: CodeEdge[] = []
  for (const e of raw.edges) {
    let tableId = tableNodeIds.get(e.table)
    if (!tableId) {
      tableId = buildTableNodeId(projectId, e.table)
      tableNodeIds.set(e.table, tableId)
      nodes.push({ id: tableId, projectId, language: 'sql', entityType: 'table', name: e.table })
    }
    edges.push({
      sourceId: resolveFrom(e.from_entity_name),
      targetId: tableId,
      relationshipType: e.relationship_type as RelationshipType,
      columns: e.columns,
    })
  }

  const unresolvedRefs: UnresolvedRef[] = raw.unresolved_refs.map(r => ({
    fromEntityId:  resolveFrom(r.from_entity_name),
    rawTargetName: r.raw_target_name,
    kind:          r.kind,
  }))

  return { nodes, edges, unresolvedRefs }
}

const EMPTY_RESULT: ParseResult = { nodes: [], edges: [], unresolvedRefs: [] }

export async function extractEntitiesWithSchema(
  filePath: string, projectId: string, source: string, language: string, schema?: ProjectSqlSchema,
): Promise<ParseResult> {
  const raw = language === 'perl'
    ? await runPerlBridge(filePath)
    : await runSqlBridge(filePath, language, schema)
  if (!raw) return EMPTY_RESULT
  return normalize(raw, filePath, projectId, language, source)
}

// Builds a human-readable outline (one line per procedure/function, its
// signature, line range, and the tables it reads/writes) for a SQL/PLSQL
// file — the sql_bridge.py equivalent of extractSymbolOutline() in
// codeChunker.ts. That tree-sitter-based function has no grammar for
// sql/plsql and always returns null for them, which otherwise leaves large
// SQL/PLSQL files with NO outline fallback at all: routes like /explain that
// truncate raw source to a char cap (see EXPLAIN_SOURCE_CHARS) lose coverage
// of everything past the cutoff, silently, for exactly this file type. This
// runs sql_bridge.py against the FULL untruncated source (it reads from a
// temp file, not the truncated prompt excerpt), so the resulting outline
// covers the whole file regardless of how much of the raw source a caller
// can afford to send the model.
export async function extractSqlOutline(source: string, language: 'sql' | 'plsql'): Promise<string[] | null> {
  const tmpPath = path.join(os.tmpdir(), `devbrain-sql-outline-${randomUUID()}.sql`)
  try {
    await fsPromises.writeFile(tmpPath, source, 'utf-8')
    const raw = await runSqlBridge(tmpPath, language)
    if (!raw || raw.nodes.length === 0) return null

    // Aggregate each entity's table I/O so it can be appended to its outline
    // line — sql_bridge.py reports this per-statement (one edge per table per
    // statement), this collapses it to one summarized set per entity.
    const ioByEntity = new Map<string, { reads: Set<string>; writes: Set<string> }>()
    for (const e of raw.edges) {
      if (!e.from_entity_name) continue
      let io = ioByEntity.get(e.from_entity_name)
      if (!io) {
        io = { reads: new Set(), writes: new Set() }
        ioByEntity.set(e.from_entity_name, io)
      }
      ;(e.relationship_type === 'WRITES_TABLE' ? io.writes : io.reads).add(e.table)
    }

    return raw.nodes.map(n => {
      const io = ioByEntity.get(n.name)
      const ioParts: string[] = []
      if (io?.writes.size) ioParts.push(`writes: ${[...io.writes].join(', ')}`)
      if (io?.reads.size) ioParts.push(`reads: ${[...io.reads].join(', ')}`)
      const ioSuffix = ioParts.length ? ` — ${ioParts.join('; ')}` : ''
      return `${n.signature ?? n.name} (lines ${n.start_line}-${n.end_line})${ioSuffix}`
    })
  } catch {
    return null
  } finally {
    await fsPromises.unlink(tmpPath).catch(() => {})
  }
}

const BRIDGE_LANGUAGES = new Set(['sql', 'plsql', 'perl'])

export const pythonBridgeParser: BaseParser = {
  languages: [...BRIDGE_LANGUAGES],
  extractEntities: (filePath, projectId, source) => {
    const ext      = path.extname(filePath).slice(1).toLowerCase()
    const language = CODE_EXT_LANGUAGE[ext]
    if (!language || !BRIDGE_LANGUAGES.has(language)) return Promise.resolve(EMPTY_RESULT)
    return extractEntitiesWithSchema(filePath, projectId, source, language)
  },
}

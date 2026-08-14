// Unified Entity/Relationship types for the Code Intelligence & Knowledge
// Graph engine (see TASKS.md Phase 40). Mirrors code_nodes/code_edges/
// code_unresolved_refs in schema.sql. `language`/`entityType` are plain
// strings, not narrow unions — the parser registry is designed to grow (new
// languages, new entity kinds) without touching this file.

export type RelationshipType = 'CALLS' | 'IMPORTS' | 'READS_TABLE' | 'WRITES_TABLE' | 'INCLUDES'

export interface CodeNode {
  id:          string   // `${filePath}::${entityType}::${name}` — see buildNodeId()
  projectId:   string
  language:    string    // 'python' | 'perl' | 'bash' | 'typescript' | 'javascript' | 'sql' | 'plsql' | ...
  entityType:  string    // 'function' | 'subroutine' | 'procedure' | 'class' | 'script' | 'table' | ...
  name:        string
  signature?:  string
  docstring?:  string
  // A `'table'` node (see buildTableNodeId()) represents a table named in a
  // READS_TABLE/WRITES_TABLE edge — it may never be CREATE TABLE-defined
  // anywhere in the indexed source, so it has no file location or content
  // to hash. Every other entity type always has all four.
  filePath?:    string
  startLine?:   number
  endLine?:     number
  contentHash?: string
}

export interface CodeEdge {
  sourceId:         string
  targetId:         string
  relationshipType: RelationshipType
  // Populated only for READS_TABLE/WRITES_TABLE edges when column-level
  // lineage is resolvable (see sql_bridge.py, Phase 40) — undefined/null
  // means "unknown", not "no columns".
  columns?:         string[] | null
}

export type UnresolvedRefKind = 'call' | 'import' | 'sql_exec' | 'script_invocation'

// A call reference a parser found but couldn't resolve to a known node by
// itself (e.g. a Perl embedded-SQL string naming a stored procedure it
// doesn't have visibility into). Resolved against the full node set in a
// second pass — see analyzer/linkResolver.ts.
export interface UnresolvedRef {
  fromEntityId:  string
  rawTargetName: string
  kind:          UnresolvedRefKind
  // Set only by linkResolver.ts, on the refs that are STILL unresolved after
  // Pass 2 and are about to be persisted to code_unresolved_refs — never set
  // by a parser. A ref that resolves becomes a real CodeEdge instead and
  // never carries a reason at all.
  reason?:       string
}

// Per-file parser contract — every language module (tree-sitter-based or
// Python-bridge-based) implements this so the indexer can dispatch by file
// extension without knowing how each language is actually parsed.
export interface ParseResult {
  nodes:          CodeNode[]
  edges:          CodeEdge[]
  unresolvedRefs: UnresolvedRef[]
}

export interface SchemaColumn {
  columnName: string
  dataType?:  string
}

// A project's optional user-supplied table definitions, keyed by table name
// — passed to sql_bridge.py as sqlglot's `schema=` argument once populated.
// Empty/undefined is a valid, expected state (Phase 40 ships without
// requiring this up front).
export type ProjectSqlSchema = Record<string, SchemaColumn[]>

const NODE_ID_SEP = '::'

// Every parser must build node ids this way so cross-file/cross-language
// references (Pass 2 link resolution) can look entities up consistently.
export function buildNodeId(filePath: string, entityType: string, name: string): string {
  return `${filePath}${NODE_ID_SEP}${entityType}${NODE_ID_SEP}${name}`
}

// Tables are project-level singletons, not file-scoped — the same `accounts`
// table referenced from ten different procedures across ten different files
// must resolve to the same one node, unlike a function/class id (which is
// legitimately file-scoped: two different files can each have their own
// unrelated `foo`). Deliberately a different shape from buildNodeId() (no
// filePath component) so the two id families can never collide.
export function buildTableNodeId(projectId: string, tableName: string): string {
  return `table${NODE_ID_SEP}${projectId}${NODE_ID_SEP}${tableName.toLowerCase()}`
}

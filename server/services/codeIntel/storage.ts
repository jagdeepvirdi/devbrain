import { pool } from '../../db/pool.js'
import type { CodeNode, CodeEdge, UnresolvedRef, RelationshipType } from './types.js'

// Upsert + traversal queries against code_nodes/code_edges (TASKS.md
// Phase 40). Keeps DB access (snake_case rows <-> camelCase CodeNode/CodeEdge)
// isolated from the parsers and the future indexer CLI, same separation as
// every other services/*.ts file in this codebase.

interface CodeNodeRow {
  id:           string
  project_id:   string
  file_path:    string | null
  language:     string
  entity_type:  string
  name:         string
  signature:    string | null
  docstring:    string | null
  start_line:   number | null
  end_line:     number | null
  content_hash: string | null
}

function rowToNode(row: CodeNodeRow): CodeNode {
  return {
    id:          row.id,
    projectId:   row.project_id,
    filePath:    row.file_path ?? undefined,
    language:    row.language,
    entityType:  row.entity_type,
    name:        row.name,
    signature:   row.signature ?? undefined,
    docstring:   row.docstring ?? undefined,
    startLine:   row.start_line ?? undefined,
    endLine:     row.end_line ?? undefined,
    contentHash: row.content_hash ?? undefined,
  }
}

// ── Writes ───────────────────────────────────────────────────────────────

export async function upsertNodes(nodes: CodeNode[]): Promise<void> {
  for (const node of nodes) {
    await pool.query(
      `INSERT INTO code_nodes
         (id, project_id, file_path, language, entity_type, name, signature, docstring, start_line, end_line, content_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
       ON CONFLICT (id) DO UPDATE SET
         file_path    = EXCLUDED.file_path,
         language     = EXCLUDED.language,
         entity_type  = EXCLUDED.entity_type,
         name         = EXCLUDED.name,
         signature    = EXCLUDED.signature,
         docstring    = EXCLUDED.docstring,
         start_line   = EXCLUDED.start_line,
         end_line     = EXCLUDED.end_line,
         content_hash = EXCLUDED.content_hash,
         updated_at   = now()`,
      [
        node.id, node.projectId, node.filePath ?? null, node.language, node.entityType, node.name,
        node.signature ?? null, node.docstring ?? null, node.startLine ?? null, node.endLine ?? null,
        node.contentHash ?? null,
      ],
    )
  }
}

export async function upsertEdges(edges: CodeEdge[]): Promise<void> {
  for (const edge of edges) {
    await pool.query(
      `INSERT INTO code_edges (source_id, target_id, relationship_type, columns)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source_id, target_id, relationship_type) DO UPDATE SET
         columns = EXCLUDED.columns`,
      [edge.sourceId, edge.targetId, edge.relationshipType, edge.columns ?? null],
    )
  }
}

export async function insertUnresolvedRefs(projectId: string, refs: UnresolvedRef[]): Promise<void> {
  for (const ref of refs) {
    await pool.query(
      `INSERT INTO code_unresolved_refs (project_id, from_entity_id, raw_target_name, kind, reason)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, ref.fromEntityId, ref.rawTargetName, ref.kind, ref.reason ?? null],
    )
  }
}

// Deletes a project's entire graph (code_nodes cascades to code_edges;
// code_unresolved_refs is deleted explicitly since it's project-scoped, not
// cascaded from a single node). Called before a fresh full re-index so
// renamed/removed entities don't linger as stale nodes — see
// index-code-graph.ts (Phase 40, not yet built).
export async function clearProjectGraph(projectId: string): Promise<void> {
  await pool.query('DELETE FROM code_unresolved_refs WHERE project_id = $1', [projectId])
  await pool.query('DELETE FROM code_nodes WHERE project_id = $1', [projectId])
}

// ── Reads ────────────────────────────────────────────────────────────────

// Lightweight projection of every node in a project — what linkResolver.ts's
// Pass 2 needs to match UnresolvedRefs by name (plus entity_type/language to
// filter candidates, file_path to tiebreak them), without pulling full
// signature/docstring/content_hash text for nodes that mostly won't be a
// match at all.
export interface NodeSummary {
  id:         string
  name:       string
  entityType: string
  language:   string
  filePath:   string | null
}

export async function getProjectNodeSummaries(projectId: string): Promise<NodeSummary[]> {
  const { rows } = await pool.query<{ id: string; name: string; entity_type: string; language: string; file_path: string | null }>(
    'SELECT id, name, entity_type, language, file_path FROM code_nodes WHERE project_id = $1',
    [projectId],
  )
  return rows.map(r => ({ id: r.id, name: r.name, entityType: r.entity_type, language: r.language, filePath: r.file_path }))
}

export async function getNodeById(id: string): Promise<CodeNode | null> {
  const { rows } = await pool.query<CodeNodeRow>('SELECT * FROM code_nodes WHERE id = $1', [id])
  return rows[0] ? rowToNode(rows[0]) : null
}

// GET /api/code-intel/:projectId/nodes?search= (server/routes/code-intel.ts).
// Unfiltered `search` lists every node in the project (capped) — matches
// name OR file_path, case-insensitively, so "accounts" finds both a table
// named accounts and a file like billing/accounts_util.py.
export async function searchNodes(projectId: string, search?: string, limit = 100): Promise<CodeNode[]> {
  if (search) {
    const { rows } = await pool.query<CodeNodeRow>(
      `SELECT * FROM code_nodes WHERE project_id = $1 AND (name ILIKE $2 OR file_path ILIKE $2)
       ORDER BY name LIMIT $3`,
      [projectId, `%${search}%`, limit],
    )
    return rows.map(rowToNode)
  }
  const { rows } = await pool.query<CodeNodeRow>(
    'SELECT * FROM code_nodes WHERE project_id = $1 ORDER BY name LIMIT $2',
    [projectId, limit],
  )
  return rows.map(rowToNode)
}

export interface UnresolvedRefRow {
  id:            string
  fromEntityId:  string
  rawTargetName: string
  kind:          string
  reason:        string | null
  createdAt:     Date
}

// GET /api/code-intel/:projectId/unresolved — what Pass 2 (linkResolver.ts)
// couldn't resolve, surfaced rather than hidden (TASKS.md Phase 40's
// explicit design goal: a graph that's honest about its own gaps).
export async function getUnresolvedRefsForProject(projectId: string): Promise<UnresolvedRefRow[]> {
  const { rows } = await pool.query<{
    id: string; from_entity_id: string; raw_target_name: string; kind: string; reason: string | null; created_at: Date
  }>(
    `SELECT id, from_entity_id, raw_target_name, kind, reason, created_at
     FROM code_unresolved_refs WHERE project_id = $1 ORDER BY created_at DESC`,
    [projectId],
  )
  return rows.map(r => ({
    id: r.id, fromEntityId: r.from_entity_id, rawTargetName: r.raw_target_name, kind: r.kind,
    reason: r.reason, createdAt: r.created_at,
  }))
}

// Same shape as getCallers/getCallees, but keeps the edge's own
// relationship_type/columns alongside the node — getContext() (analyzer/,
// Phase 40) needs this to show e.g. "WRITES_TABLE accounts — columns:
// balance, id" rather than just a bare list of related node names.
export interface EdgeDetail {
  node:             CodeNode
  relationshipType: RelationshipType
  columns:          string[] | null
}

type EdgeDetailRow = CodeNodeRow & { relationship_type: RelationshipType; columns: string[] | null }

function rowToEdgeDetail(row: EdgeDetailRow): EdgeDetail {
  return { node: rowToNode(row), relationshipType: row.relationship_type, columns: row.columns }
}

export async function getIncomingEdgeDetails(entityId: string): Promise<EdgeDetail[]> {
  const { rows } = await pool.query<EdgeDetailRow>(
    `SELECT n.*, e.relationship_type, e.columns FROM code_nodes n
     JOIN code_edges e ON e.source_id = n.id
     WHERE e.target_id = $1`,
    [entityId],
  )
  return rows.map(rowToEdgeDetail)
}

export async function getOutgoingEdgeDetails(entityId: string): Promise<EdgeDetail[]> {
  const { rows } = await pool.query<EdgeDetailRow>(
    `SELECT n.*, e.relationship_type, e.columns FROM code_nodes n
     JOIN code_edges e ON e.target_id = n.id
     WHERE e.source_id = $1`,
    [entityId],
  )
  return rows.map(rowToEdgeDetail)
}

export async function getCallers(entityId: string): Promise<CodeNode[]> {
  const { rows } = await pool.query<CodeNodeRow>(
    `SELECT n.* FROM code_nodes n
     JOIN code_edges e ON e.source_id = n.id
     WHERE e.target_id = $1`,
    [entityId],
  )
  return rows.map(rowToNode)
}

export async function getCallees(entityId: string): Promise<CodeNode[]> {
  const { rows } = await pool.query<CodeNodeRow>(
    `SELECT n.* FROM code_nodes n
     JOIN code_edges e ON e.target_id = n.id
     WHERE e.source_id = $1`,
    [entityId],
  )
  return rows.map(rowToNode)
}

export interface ImpactNode extends CodeNode {
  depth: number
}

// Everything that transitively depends on `entityId` — i.e. its callers,
// their callers, and so on up to `depth` hops — answering "what breaks if I
// change this." Direction is deliberately caller-ward (not callee-ward):
// that's what "impact" means for a change to `entityId` itself.
export async function getImpactTree(entityId: string, depth = 3): Promise<ImpactNode[]> {
  const { rows } = await pool.query<CodeNodeRow & { depth: number }>(
    `WITH RECURSIVE impact(id, depth) AS (
       SELECT source_id, 1 FROM code_edges WHERE target_id = $1
       UNION
       SELECT e.source_id, i.depth + 1
       FROM code_edges e
       JOIN impact i ON e.target_id = i.id
       WHERE i.depth < $2
     )
     SELECT DISTINCT ON (n.id) n.*, i.depth
     FROM impact i
     JOIN code_nodes n ON n.id = i.id
     ORDER BY n.id, i.depth`,
    [entityId, depth],
  )
  return rows
    .map(row => ({ ...rowToNode(row), depth: row.depth }))
    .sort((a, b) => a.depth - b.depth)
}

export type { RelationshipType }

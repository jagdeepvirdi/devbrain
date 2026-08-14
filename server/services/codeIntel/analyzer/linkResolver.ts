import path from 'node:path'
import { getProjectNodeSummaries, upsertEdges, insertUnresolvedRefs, type NodeSummary } from '../storage.js'
import type { UnresolvedRef, UnresolvedRefKind, CodeEdge, RelationshipType } from '../types.js'

// Pass 2 of indexing (TASKS.md Phase 40) — run once per indexing job after
// every file's Pass 1 extraction has finished and all of a project's
// code_nodes are already in the database. Each parser only sees its own
// file, so a Perl sub calling a SQL procedure, or a Bash script sourcing
// another file, can only be expressed as an UnresolvedRef ({fromEntityId,
// rawTargetName, kind}) at extraction time — this is what actually turns
// those into real CALLS/IMPORTS/INCLUDES edges (or, for the ones that
// genuinely can't be resolved, a logged-not-dropped code_unresolved_refs
// row), by matching rawTargetName against the full project-wide node set no
// single parser had visibility into.

// Which entity_types are even eligible targets for each kind — e.g. a
// 'call' should never resolve to a 'table' node (READS_TABLE/WRITES_TABLE
// edges are never produced via this path at all; parsers emit those
// directly since a table name is unambiguous the moment it's known, no
// project-wide name search needed). 'sql_exec' is further restricted to
// sql/plsql-language nodes below — it specifically means "this called a SQL
// procedure," so a same-named Python function is never a valid match for it,
// unlike plain 'call', which is intentionally cross-language capable (that's
// the entire point of this pass).
const KIND_ENTITY_TYPES: Record<UnresolvedRefKind, string[]> = {
  call:              ['function', 'subroutine', 'procedure'],
  sql_exec:          ['procedure', 'function'],
  import:            ['script'],
  script_invocation: ['script'],
}

const RELATIONSHIP_FOR_KIND: Record<UnresolvedRefKind, RelationshipType> = {
  call:              'CALLS',
  sql_exec:          'CALLS',
  import:            'IMPORTS',
  script_invocation: 'INCLUDES',
}

function isEligible(kind: UnresolvedRefKind, node: NodeSummary): boolean {
  if (!KIND_ENTITY_TYPES[kind].includes(node.entityType)) return false
  if (kind === 'sql_exec' && node.language !== 'sql' && node.language !== 'plsql') return false
  return true
}

// import/script_invocation targets are frequently a path, not a bare name
// ('../db/pool.js', 'nightly_job.sql') — a file-level 'script' node's own
// `name` is always just its basename (see treeSitterParser.ts/
// pythonBridgeParser.ts), so an exact match against the raw target usually
// only works for same-directory references. Falling back to the raw
// target's own basename catches the common case (a relative import, a bare
// script filename) without attempting full relative-path module resolution
// — a real project's directory layout isn't visible from here, and getting
// that fully right is meaningfully harder than this pass is trying to be.
function basenameOf(target: string): string {
  return path.basename(target.replace(/\\/g, '/'))
}

function findCandidates(ref: UnresolvedRef, byName: Map<string, NodeSummary[]>): NodeSummary[] {
  const exact = (byName.get(ref.rawTargetName) ?? []).filter(n => isEligible(ref.kind, n))
  if (exact.length > 0) return exact

  const base = basenameOf(ref.rawTargetName)
  if (base !== ref.rawTargetName) {
    const baseMatches = (byName.get(base) ?? []).filter(n => isEligible(ref.kind, n))
    if (baseMatches.length > 0) return baseMatches
  }
  return []
}

interface Resolution {
  edge?:   CodeEdge
  reason?: string
}

function resolveOne(ref: UnresolvedRef, byName: Map<string, NodeSummary[]>, byId: Map<string, NodeSummary>): Resolution {
  const candidates = findCandidates(ref, byName)
  if (candidates.length === 0) return { reason: 'no matching name' }

  let winner: NodeSummary | undefined = candidates.length === 1 ? candidates[0] : undefined

  if (!winner) {
    // Tiebreak: prefer whichever candidate lives in the same file as the
    // calling entity — e.g. a locally-defined helper of the same name takes
    // priority over some unrelated file's same-named function.
    const source = byId.get(ref.fromEntityId)
    const sameFile = source?.filePath ? candidates.filter(c => c.filePath === source.filePath) : []
    if (sameFile.length === 1) winner = sameFile[0]
  }

  if (!winner) return { reason: `ambiguous — ${candidates.length} matches` }

  return {
    edge: {
      sourceId: ref.fromEntityId,
      targetId: winner.id,
      relationshipType: RELATIONSHIP_FOR_KIND[ref.kind],
    },
  }
}

export interface LinkResolutionSummary {
  resolved:   number
  unresolved: number
}

// Resolves `refs` (the concatenation of every file's Pass-1 UnresolvedRefs
// for one project) against that project's already-persisted code_nodes,
// writes CALLS/IMPORTS/INCLUDES edges for the ones that resolve, and
// persists the rest to code_unresolved_refs with a reason — nothing is
// silently dropped either way.
export async function resolveLinks(projectId: string, refs: UnresolvedRef[]): Promise<LinkResolutionSummary> {
  if (refs.length === 0) return { resolved: 0, unresolved: 0 }

  const nodes = await getProjectNodeSummaries(projectId)
  const byName = new Map<string, NodeSummary[]>()
  const byId = new Map<string, NodeSummary>()
  for (const node of nodes) {
    byId.set(node.id, node)
    const list = byName.get(node.name)
    if (list) list.push(node)
    else byName.set(node.name, [node])
  }

  const edges: CodeEdge[] = []
  const stillUnresolved: UnresolvedRef[] = []

  for (const ref of refs) {
    const { edge, reason } = resolveOne(ref, byName, byId)
    if (edge) edges.push(edge)
    else stillUnresolved.push({ ...ref, reason })
  }

  if (edges.length > 0) await upsertEdges(edges)
  if (stillUnresolved.length > 0) await insertUnresolvedRefs(projectId, stillUnresolved)

  return { resolved: edges.length, unresolved: stillUnresolved.length }
}

import { readFile } from 'node:fs/promises'
import {
  getCallers, getCallees, getImpactTree, getNodeById, searchNodes, getUnresolvedRefsForProject,
  getIncomingEdgeDetails, getOutgoingEdgeDetails,
  type ImpactNode, type EdgeDetail, type UnresolvedRefRow,
} from '../storage.js'
import type { CodeNode } from '../types.js'

// Public query API over the code graph (TASKS.md Phase 40) — the layer
// server/routes/code-intel.ts calls into, so routes never reach into
// storage.ts's raw SQL directly. getCallers/getCallees/getImpactTree/
// getNodeById/searchNodes/getUnresolvedRefsForProject are storage.ts's own
// queries, re-exported here unchanged; getContext is the one genuinely new
// piece this module adds.
export { getCallers, getCallees, getImpactTree, getNodeById, searchNodes, getUnresolvedRefsForProject }
export type { ImpactNode, UnresolvedRefRow }

function formatNodeLine(node: CodeNode): string {
  const location = node.filePath ? `${node.filePath}:${node.startLine ?? '?'}` : '(no file — e.g. a referenced table)'
  const label = node.signature ?? node.name
  return `- \`${label}\` — ${node.entityType}, ${location}`
}

function formatEdgeLine(detail: EdgeDetail): string {
  const base = formatNodeLine(detail.node)
  const cols = detail.columns && detail.columns.length > 0 ? ` (columns: ${detail.columns.join(', ')})` : ''
  return `${base} — **${detail.relationshipType}**${cols}`
}

async function readEntitySource(node: CodeNode): Promise<string> {
  if (!node.filePath || !node.startLine || !node.endLine) {
    return '_(no source location on this entity — e.g. a table referenced but never `CREATE TABLE`-defined in the indexed source)_'
  }
  try {
    const text = await readFile(node.filePath, 'utf-8')
    const lines = text.split('\n')
    const slice = lines.slice(node.startLine - 1, node.endLine).join('\n')
    return '```' + (node.language || '') + '\n' + slice + '\n```'
  } catch (err) {
    return `_(source unavailable — ${(err as Error).message}; the file may have moved or been deleted since this was last indexed)_`
  }
}

// Everything an LLM (or a developer) needs to refactor `entityId` safely
// without re-reading the whole project: its own source, plus the
// signatures — not full bodies — of whoever calls it and whoever/whatever
// it calls, including per-edge column detail for table reads/writes. This
// is the "LLM refactor context" output from the original spec that kicked
// off this phase, reshaped as a Markdown string rather than a CLI-only
// feature so server/routes/code-intel.ts can serve it directly.
export async function getContext(entityId: string): Promise<string> {
  const node = await getNodeById(entityId)
  if (!node) return `_Entity not found: \`${entityId}\`_`

  const [source, incoming, outgoing] = await Promise.all([
    readEntitySource(node),
    getIncomingEdgeDetails(entityId),
    getOutgoingEdgeDetails(entityId),
  ])

  const lines: string[] = []
  lines.push(`# ${node.name}`)
  lines.push(`_${node.entityType} · ${node.language}${node.filePath ? ` · ${node.filePath}` : ''}_`)
  if (node.docstring) lines.push('', node.docstring)
  lines.push('', '## Source', source)

  lines.push('', `## Callers (${incoming.length})`)
  lines.push(...(incoming.length > 0 ? incoming.map(formatEdgeLine) : ['_none found_']))

  lines.push('', `## Callees / references (${outgoing.length})`)
  lines.push(...(outgoing.length > 0 ? outgoing.map(formatEdgeLine) : ['_none found_']))

  return lines.join('\n')
}

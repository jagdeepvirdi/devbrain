import { pool } from '../db/pool.js'

export type EntityType = 'task' | 'document' | 'issue' | 'release' | 'command'
export const ENTITY_TYPES: EntityType[] = ['task', 'document', 'issue', 'release', 'command']

export type EntityDescriptor = {
  type:     EntityType
  id:       string
  title:    string
  subtitle: string | null
}

// Table + display-column map per type. `document` covers both regular
// documents and Codes tab entries (same table, distinguished by file_type,
// which doubles as the subtitle so a chip can show "code · typescript" etc.
// via the client). Fixed internal map, not user input — safe to interpolate.
const ENTITY_QUERY: Record<EntityType, { table: string; titleExpr: string; subtitleExpr: string }> = {
  task:     { table: 'tasks',     titleExpr: 'title',   subtitleExpr: 'status' },
  document: { table: 'documents', titleExpr: 'title',   subtitleExpr: 'file_type' },
  issue:    { table: 'issues',    titleExpr: 'title',   subtitleExpr: 'status' },
  release:  { table: 'releases',  titleExpr: 'version', subtitleExpr: 'type' },
  command:  { table: 'commands',  titleExpr: 'title',   subtitleExpr: 'language' },
}

export async function resolveEntities(type: EntityType, ids: string[]): Promise<EntityDescriptor[]> {
  if (!ids.length) return []
  const cfg = ENTITY_QUERY[type]
  const { rows } = await pool.query(
    `SELECT id, ${cfg.titleExpr} AS title, ${cfg.subtitleExpr} AS subtitle
     FROM ${cfg.table} WHERE id = ANY($1)`,
    [ids]
  )
  return rows.map((r: { id: string; title: string; subtitle: string | null }) => ({
    type, id: r.id, title: r.title, subtitle: r.subtitle,
  }))
}

export async function entityExists(type: EntityType, id: string): Promise<boolean> {
  const cfg = ENTITY_QUERY[type]
  const { rows } = await pool.query(`SELECT 1 FROM ${cfg.table} WHERE id = $1`, [id])
  return rows.length > 0
}

// Call from an entity's DELETE handler so removing e.g. an Issue doesn't
// leave dangling links pointing at a row that no longer exists — there's no
// DB-level FK to cascade this (polymorphic id), so it's explicit.
export async function deleteLinksFor(type: EntityType, id: string): Promise<void> {
  await pool.query(
    'DELETE FROM entity_links WHERE (a_type = $1 AND a_id = $2) OR (b_type = $1 AND b_id = $2)',
    [type, id]
  )
}

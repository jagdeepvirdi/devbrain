/**
 * Builds a parameterized SET clause for UPDATE queries.
 * $1 is reserved for the WHERE clause (id), so update values start at $2.
 *
 * Usage:
 *   const { setClauses, params } = buildSetClause(['title', 'tags'], ['My Doc', []])
 *   pool.query(`UPDATE docs SET ${setClauses} WHERE id = $1`, [id, ...params])
 */
export function buildSetClause(
  cols: string[],
  vals: unknown[],
): { setClauses: string; params: unknown[] } {
  const setClauses = cols.map((c, i) => `${c} = $${i + 2}`).join(', ')
  return { setClauses, params: vals }
}

/**
 * Builds a parameterized WHERE clause from an optional filter map.
 * Returns { where: 'WHERE a=$1 AND b=$2', params: [...], next: 3 }
 * so callers can append LIMIT/OFFSET starting at `next`.
 *
 * Usage:
 *   const { where, params, next } = buildWhereClause({ 'project_id': id, 'status': s })
 *   pool.query(`SELECT * FROM issues ${where} LIMIT $${next}`, [...params, limit])
 */
export function buildWhereClause(
  filters: Record<string, unknown>,
): { where: string; params: unknown[]; next: number } {
  const conditions: string[] = []
  const params: unknown[] = []
  let idx = 1

  for (const [col, val] of Object.entries(filters)) {
    if (val === undefined || val === null) continue
    conditions.push(`${col} = $${idx++}`)
    params.push(val)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params, next: idx }
}

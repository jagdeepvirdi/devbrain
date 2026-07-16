import { Router } from 'express'
import { z } from 'zod'
import { pool } from '../db/pool.js'
import { requireRole } from '../middleware/auth.js'
import { serverError } from '../lib/errors.js'
import { ENTITY_TYPES, resolveEntities, entityExists, type EntityType, type EntityDescriptor } from '../services/links.js'

const router = Router()

const EntityTypeSchema = z.enum(ENTITY_TYPES as [EntityType, ...EntityType[]])

// ── GET /api/links?entityType=X&entityId=Y ────────────────────────────────
// Returns every item linked to (entityType, entityId), with the "other side"
// resolved to a display-ready {title, subtitle} — batched per type so N
// links only cost one extra query per distinct linked type, not N queries.

router.get('/', async (req, res) => {
  const parsedType = EntityTypeSchema.safeParse(req.query.entityType)
  const entityId    = req.query.entityId as string | undefined
  if (!parsedType.success || !entityId) {
    return res.status(400).json({ error: 'entityType and entityId are required' })
  }
  const type = parsedType.data

  try {
    const { rows } = await pool.query(
      `SELECT id, a_type, a_id, b_type, b_id, created_at FROM entity_links
       WHERE (a_type = $1 AND a_id = $2) OR (b_type = $1 AND b_id = $2)
       ORDER BY created_at DESC`,
      [type, entityId]
    )

    const others = rows.map((r: { id: string; a_type: EntityType; a_id: string; b_type: EntityType; b_id: string; created_at: string }) => {
      const isA = r.a_type === type && r.a_id === entityId
      return {
        linkId:    r.id,
        type:      isA ? r.b_type : r.a_type,
        id:        isA ? r.b_id   : r.a_id,
        createdAt: r.created_at,
      }
    })

    const idsByType = new Map<EntityType, string[]>()
    for (const o of others) {
      const list = idsByType.get(o.type) ?? []
      list.push(o.id)
      idsByType.set(o.type, list)
    }

    const descriptorsByKey = new Map<string, EntityDescriptor>()
    for (const [t, ids] of idsByType) {
      const descs = await resolveEntities(t, ids)
      for (const d of descs) descriptorsByKey.set(`${t}:${d.id}`, d)
    }

    const data = others.map(o => {
      const d = descriptorsByKey.get(`${o.type}:${o.id}`)
      return {
        linkId:    o.linkId,
        type:      o.type,
        id:        o.id,
        title:     d?.title ?? '(deleted)',
        subtitle:  d?.subtitle ?? null,
        createdAt: o.createdAt,
      }
    })

    res.json({ data })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/links/graph ───────────────────────────────────────────────
// The whole link graph — every entity_links row plus a resolved descriptor
// for every distinct node touched, batched per type same as the single-
// entity endpoint above. No pagination: at personal-tool scale the full
// graph is small, and a force layout needs the whole thing anyway to lay
// out sensibly.

router.get('/graph', async (_req, res) => {
  try {
    const { rows } = await pool.query<{ id: string; a_type: EntityType; a_id: string; b_type: EntityType; b_id: string }>(
      'SELECT id, a_type, a_id, b_type, b_id FROM entity_links ORDER BY created_at'
    )

    const idsByType = new Map<EntityType, Set<string>>()
    const track = (type: EntityType, id: string) => {
      const set = idsByType.get(type) ?? new Set<string>()
      set.add(id)
      idsByType.set(type, set)
    }
    for (const r of rows) { track(r.a_type, r.a_id); track(r.b_type, r.b_id) }

    const descriptorsByKey = new Map<string, EntityDescriptor>()
    for (const [type, idSet] of idsByType) {
      const descs = await resolveEntities(type, [...idSet])
      for (const d of descs) descriptorsByKey.set(`${type}:${d.id}`, d)
    }

    const nodes = [...idsByType.entries()].flatMap(([type, idSet]) =>
      [...idSet].map(id => {
        const d = descriptorsByKey.get(`${type}:${id}`)
        return { type, id, title: d?.title ?? '(deleted)', subtitle: d?.subtitle ?? null }
      })
    )

    const edges = rows.map(r => ({
      linkId: r.id,
      from:   { type: r.a_type, id: r.a_id },
      to:     { type: r.b_type, id: r.b_id },
    }))

    res.json({ data: { nodes, edges } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── POST /api/links ────────────────────────────────────────────────────
// Idempotent — linking the same pair twice (in either order) returns the
// existing link rather than erroring or duplicating.

const CreateBody = z.object({
  aType: EntityTypeSchema,
  aId:   z.string().min(1),
  bType: EntityTypeSchema,
  bId:   z.string().min(1),
})

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = CreateBody.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  let { aType, aId, bType, bId } = parsed.data

  if (aType === bType && aId === bId) {
    return res.status(400).json({ error: 'Cannot link an item to itself' })
  }

  try {
    const [aExists, bExists] = await Promise.all([entityExists(aType, aId), entityExists(bType, bId)])
    if (!aExists || !bExists) return res.status(404).json({ error: 'One or both items were not found' })

    // Canonical (a <= b) ordering so (A,B) and (B,A) collapse to one row.
    if (aType > bType || (aType === bType && aId > bId)) {
      ;[aType, bType] = [bType, aType]
      ;[aId, bId] = [bId, aId]
    }

    const { rows } = await pool.query(
      `INSERT INTO entity_links (a_type, a_id, b_type, b_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (a_type, a_id, b_type, b_id) DO UPDATE SET a_type = EXCLUDED.a_type
       RETURNING id, created_at`,
      [aType, aId, bType, bId]
    )
    res.status(201).json({ data: { id: rows[0].id, created_at: rows[0].created_at } })
  } catch (err) {
    serverError(res, err)
  }
})

// ── DELETE /api/links/:id ─────────────────────────────────────────────

router.delete('/:id', requireRole('member'), async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM entity_links WHERE id = $1 RETURNING id', [req.params.id])
    if (!rows.length) return res.status(404).json({ error: 'Link not found' })
    res.json({ data: { deleted: rows[0].id } })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

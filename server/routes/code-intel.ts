import { Router } from 'express'
import {
  getCallers, getCallees, getImpactTree, getNodeById, searchNodes, getUnresolvedRefsForProject, getContext,
} from '../services/codeIntel/analyzer/index.js'
import type { CodeNode } from '../services/codeIntel/types.js'

// Read-only API over the Code Intelligence graph (TASKS.md Phase 40).
// Auth is the app-wide `app.use('/api', requireAuth)` in index.ts, same as
// every other route here — no per-route middleware needed for GETs, matching
// runbooks.ts/documents.ts's own convention. No project-membership ACL
// exists anywhere else in this app either (RBAC here is role-based, not
// per-project row-level — confirmed by grepping for it before adding this
// file), so this doesn't invent a new restriction beyond what every other
// route already does — it only checks that a requested `entityId` actually
// belongs to the `:projectId` in the URL, which is a data-correctness
// check (the URL's own two params staying consistent with each other), not
// a new authorization layer.
const router = Router()

async function requireOwnNode(projectId: string, entityId: string): Promise<CodeNode | null> {
  const node = await getNodeById(entityId)
  if (!node || node.projectId !== projectId) return null
  return node
}

router.get('/:projectId/nodes', async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined
    const nodes = await searchNodes(req.params.projectId, search)
    res.json({ data: nodes })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:projectId/callers/:entityId', async (req, res) => {
  try {
    const node = await requireOwnNode(req.params.projectId, req.params.entityId)
    if (!node) { res.status(404).json({ error: 'Entity not found in this project' }); return }
    res.json({ data: await getCallers(req.params.entityId) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:projectId/callees/:entityId', async (req, res) => {
  try {
    const node = await requireOwnNode(req.params.projectId, req.params.entityId)
    if (!node) { res.status(404).json({ error: 'Entity not found in this project' }); return }
    res.json({ data: await getCallees(req.params.entityId) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

const DEFAULT_IMPACT_DEPTH = 3
const MAX_IMPACT_DEPTH     = 10

router.get('/:projectId/impact/:entityId', async (req, res) => {
  try {
    const node = await requireOwnNode(req.params.projectId, req.params.entityId)
    if (!node) { res.status(404).json({ error: 'Entity not found in this project' }); return }

    const rawDepth = Number(req.query.depth)
    const depth = Number.isInteger(rawDepth) && rawDepth > 0
      ? Math.min(rawDepth, MAX_IMPACT_DEPTH)
      : DEFAULT_IMPACT_DEPTH

    res.json({ data: await getImpactTree(req.params.entityId, depth) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:projectId/context/:entityId', async (req, res) => {
  try {
    const node = await requireOwnNode(req.params.projectId, req.params.entityId)
    if (!node) { res.status(404).json({ error: 'Entity not found in this project' }); return }
    const markdown = await getContext(req.params.entityId)
    res.json({ data: markdown })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

router.get('/:projectId/unresolved', async (req, res) => {
  try {
    res.json({ data: await getUnresolvedRefsForProject(req.params.projectId) })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router

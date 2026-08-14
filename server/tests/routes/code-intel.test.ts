import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCallersMock  = vi.fn()
const getCalleesMock  = vi.fn()
const getImpactTreeMock = vi.fn()
const getNodeByIdMock = vi.fn()
const searchNodesMock = vi.fn()
const getUnresolvedRefsForProjectMock = vi.fn()
const getContextMock  = vi.fn()

vi.mock('../../services/codeIntel/analyzer/index.js', () => ({
  getCallers:                (...a: unknown[]) => getCallersMock(...a),
  getCallees:                (...a: unknown[]) => getCalleesMock(...a),
  getImpactTree:             (...a: unknown[]) => getImpactTreeMock(...a),
  getNodeById:               (...a: unknown[]) => getNodeByIdMock(...a),
  searchNodes:               (...a: unknown[]) => searchNodesMock(...a),
  getUnresolvedRefsForProject: (...a: unknown[]) => getUnresolvedRefsForProjectMock(...a),
  getContext:                (...a: unknown[]) => getContextMock(...a),
}))

import codeIntelRouter from '../../routes/code-intel.js'

type RouteLayer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: (...args: unknown[]) => unknown }[] } }

function getHandler(routePath: string, method: 'get') {
  const layer = (codeIntelRouter as unknown as { stack: RouteLayer[] }).stack.find(
    s => s.route?.path === routePath && s.route.methods[method],
  )
  return layer!.route!.stack[layer!.route!.stack.length - 1].handle as (req: unknown, res: unknown, next: unknown) => Promise<void>
}

function fakeRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() }
}

const PROJECT_ID = 'proj-1'
const ENTITY_ID  = 'a.py::function::main'
const OWN_NODE    = { id: ENTITY_ID, projectId: PROJECT_ID, name: 'main', entityType: 'function', language: 'python' }
const OTHER_NODE  = { id: ENTITY_ID, projectId: 'some-other-project', name: 'main', entityType: 'function', language: 'python' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /:projectId/nodes', () => {
  it('passes the search query param through and returns { data }', async () => {
    searchNodesMock.mockResolvedValue([{ id: 'n1' }])
    const res = fakeRes()

    await getHandler('/:projectId/nodes', 'get')({ params: { projectId: PROJECT_ID }, query: { search: 'accounts' } }, res, () => {})

    expect(searchNodesMock).toHaveBeenCalledWith(PROJECT_ID, 'accounts')
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'n1' }] })
  })

  it('omits search when the query param is absent', async () => {
    searchNodesMock.mockResolvedValue([])
    const res = fakeRes()

    await getHandler('/:projectId/nodes', 'get')({ params: { projectId: PROJECT_ID }, query: {} }, res, () => {})

    expect(searchNodesMock).toHaveBeenCalledWith(PROJECT_ID, undefined)
  })
})

describe('GET /:projectId/callers/:entityId and /callees/:entityId', () => {
  it('404s when the entity does not belong to the requested project', async () => {
    getNodeByIdMock.mockResolvedValue(OTHER_NODE)
    const res = fakeRes()

    await getHandler('/:projectId/callers/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(getCallersMock).not.toHaveBeenCalled()
  })

  it('404s when the entity does not exist at all', async () => {
    getNodeByIdMock.mockResolvedValue(null)
    const res = fakeRes()

    await getHandler('/:projectId/callees/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
  })

  it('returns callers for an entity that belongs to the project', async () => {
    getNodeByIdMock.mockResolvedValue(OWN_NODE)
    getCallersMock.mockResolvedValue([{ id: 'caller1' }])
    const res = fakeRes()

    await getHandler('/:projectId/callers/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(getCallersMock).toHaveBeenCalledWith(ENTITY_ID)
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'caller1' }] })
  })

  it('returns callees for an entity that belongs to the project', async () => {
    getNodeByIdMock.mockResolvedValue(OWN_NODE)
    getCalleesMock.mockResolvedValue([{ id: 'callee1' }])
    const res = fakeRes()

    await getHandler('/:projectId/callees/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(getCalleesMock).toHaveBeenCalledWith(ENTITY_ID)
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'callee1' }] })
  })
})

describe('GET /:projectId/impact/:entityId', () => {
  beforeEach(() => {
    getNodeByIdMock.mockResolvedValue(OWN_NODE)
  })

  it('defaults depth to 3 when not given', async () => {
    getImpactTreeMock.mockResolvedValue([])
    const res = fakeRes()

    await getHandler('/:projectId/impact/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID }, query: {} }, res, () => {})

    expect(getImpactTreeMock).toHaveBeenCalledWith(ENTITY_ID, 3)
  })

  it('uses a valid supplied depth', async () => {
    getImpactTreeMock.mockResolvedValue([])
    const res = fakeRes()

    await getHandler('/:projectId/impact/:entityId', 'get')(
      { params: { projectId: PROJECT_ID, entityId: ENTITY_ID }, query: { depth: '5' } }, res, () => {},
    )

    expect(getImpactTreeMock).toHaveBeenCalledWith(ENTITY_ID, 5)
  })

  it('caps an excessive depth at the maximum', async () => {
    getImpactTreeMock.mockResolvedValue([])
    const res = fakeRes()

    await getHandler('/:projectId/impact/:entityId', 'get')(
      { params: { projectId: PROJECT_ID, entityId: ENTITY_ID }, query: { depth: '999' } }, res, () => {},
    )

    expect(getImpactTreeMock).toHaveBeenCalledWith(ENTITY_ID, 10)
  })

  it('falls back to the default for a nonsense depth value', async () => {
    getImpactTreeMock.mockResolvedValue([])
    const res = fakeRes()

    await getHandler('/:projectId/impact/:entityId', 'get')(
      { params: { projectId: PROJECT_ID, entityId: ENTITY_ID }, query: { depth: 'banana' } }, res, () => {},
    )

    expect(getImpactTreeMock).toHaveBeenCalledWith(ENTITY_ID, 3)
  })
})

describe('GET /:projectId/context/:entityId', () => {
  it('returns the Markdown context for an owned entity', async () => {
    getNodeByIdMock.mockResolvedValue(OWN_NODE)
    getContextMock.mockResolvedValue('# main\n...')
    const res = fakeRes()

    await getHandler('/:projectId/context/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(getContextMock).toHaveBeenCalledWith(ENTITY_ID)
    expect(res.json).toHaveBeenCalledWith({ data: '# main\n...' })
  })

  it('404s for an entity belonging to another project', async () => {
    getNodeByIdMock.mockResolvedValue(OTHER_NODE)
    const res = fakeRes()

    await getHandler('/:projectId/context/:entityId', 'get')({ params: { projectId: PROJECT_ID, entityId: ENTITY_ID } }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(404)
    expect(getContextMock).not.toHaveBeenCalled()
  })
})

describe('GET /:projectId/unresolved', () => {
  it('returns the project\'s unresolved refs', async () => {
    getUnresolvedRefsForProjectMock.mockResolvedValue([{ id: 'u1', reason: 'no matching name' }])
    const res = fakeRes()

    await getHandler('/:projectId/unresolved', 'get')({ params: { projectId: PROJECT_ID } }, res, () => {})

    expect(getUnresolvedRefsForProjectMock).toHaveBeenCalledWith(PROJECT_ID)
    expect(res.json).toHaveBeenCalledWith({ data: [{ id: 'u1', reason: 'no matching name' }] })
  })
})

describe('error handling', () => {
  it('returns 500 with the error message when a query rejects', async () => {
    searchNodesMock.mockRejectedValue(new Error('db exploded'))
    const res = fakeRes()

    await getHandler('/:projectId/nodes', 'get')({ params: { projectId: PROJECT_ID }, query: {} }, res, () => {})

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'db exploded' })
  })
})

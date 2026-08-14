import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NodeSummary } from '../../../../services/codeIntel/storage.js'

const getProjectNodeSummariesMock = vi.fn()
const upsertEdgesMock             = vi.fn()
const insertUnresolvedRefsMock    = vi.fn()

vi.mock('../../../../services/codeIntel/storage.js', () => ({
  getProjectNodeSummaries: (...args: unknown[]) => getProjectNodeSummariesMock(...args),
  upsertEdges:             (...args: unknown[]) => upsertEdgesMock(...args),
  insertUnresolvedRefs:    (...args: unknown[]) => insertUnresolvedRefsMock(...args),
}))

const { resolveLinks } = await import('../../../../services/codeIntel/analyzer/linkResolver.js')

const PROJECT_ID = 'proj-1'

function node(overrides: Partial<NodeSummary>): NodeSummary {
  return { id: 'default-id', name: 'default', entityType: 'function', language: 'python', filePath: 'a.py', ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolveLinks — resolution', () => {
  it('resolves a single unambiguous call to a CALLS edge', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'a.py::function::helper', name: 'helper', entityType: 'function', filePath: 'a.py' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'helper', kind: 'call' },
    ])

    expect(summary).toEqual({ resolved: 1, unresolved: 0 })
    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'a.py::function::main', targetId: 'a.py::function::helper', relationshipType: 'CALLS' },
    ])
    expect(insertUnresolvedRefsMock).not.toHaveBeenCalled()
  })

  it('only matches sql/plsql-language nodes for sql_exec, ignoring a same-named non-SQL function', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'utils.py::function::update_balance', name: 'update_balance', entityType: 'function', language: 'python', filePath: 'utils.py' }),
      node({ id: 'billing.spc::procedure::update_balance', name: 'update_balance', entityType: 'procedure', language: 'plsql', filePath: 'billing.spc' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'app.pl::subroutine::apply_fee', rawTargetName: 'update_balance', kind: 'sql_exec' },
    ])

    expect(summary).toEqual({ resolved: 1, unresolved: 0 })
    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'app.pl::subroutine::apply_fee', targetId: 'billing.spc::procedure::update_balance', relationshipType: 'CALLS' },
    ])
  })

  it('resolves an import via the raw target\'s basename when no exact-name node exists', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'server/db/pool.ts::script::pool.ts', name: 'pool.ts', entityType: 'script', language: 'typescript', filePath: 'server/db/pool.ts' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'server/services/x.ts::script::x.ts', rawTargetName: '../db/pool.ts', kind: 'import' },
    ])

    expect(summary).toEqual({ resolved: 1, unresolved: 0 })
    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'server/services/x.ts::script::x.ts', targetId: 'server/db/pool.ts::script::pool.ts', relationshipType: 'IMPORTS' },
    ])
  })

  it('resolves a script_invocation to an INCLUDES edge', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'scripts/backup.sql::script::backup.sql', name: 'backup.sql', entityType: 'script', language: 'sql', filePath: 'scripts/backup.sql' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'scripts/run.sh::function::run_backup', rawTargetName: 'backup.sql', kind: 'script_invocation' },
    ])

    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'scripts/run.sh::function::run_backup', targetId: 'scripts/backup.sql::script::backup.sql', relationshipType: 'INCLUDES' },
    ])
    expect(summary.resolved).toBe(1)
  })

  it('never matches a non-callable entity_type (e.g. a table) for a call kind', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'table::proj-1::helper', name: 'helper', entityType: 'table', language: 'sql', filePath: undefined as unknown as string }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'helper', kind: 'call' },
    ])

    expect(summary).toEqual({ resolved: 0, unresolved: 1 })
    expect(insertUnresolvedRefsMock).toHaveBeenCalledWith(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'helper', kind: 'call', reason: 'no matching name' },
    ])
  })
})

describe('resolveLinks — ambiguity and non-resolution', () => {
  it('reports "no matching name" when nothing matches', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([])

    await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'ghost_fn', kind: 'call' },
    ])

    expect(insertUnresolvedRefsMock).toHaveBeenCalledWith(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'ghost_fn', kind: 'call', reason: 'no matching name' },
    ])
  })

  it('reports "ambiguous — N matches" when multiple candidates exist and none share the caller\'s file', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      // The caller (in c.py) is included, same as real usage, so this
      // genuinely exercises "tiebreak found no same-file match" rather than
      // "no source entity found at all" (a different, less realistic path).
      node({ id: 'c.py::function::main', name: 'main', filePath: 'c.py' }),
      node({ id: 'a.py::function::helper', name: 'helper', filePath: 'a.py' }),
      node({ id: 'b.py::function::helper', name: 'helper', filePath: 'b.py' }),
    ])

    await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'c.py::function::main', rawTargetName: 'helper', kind: 'call' },
    ])

    expect(insertUnresolvedRefsMock).toHaveBeenCalledWith(PROJECT_ID, [
      { fromEntityId: 'c.py::function::main', rawTargetName: 'helper', kind: 'call', reason: 'ambiguous — 2 matches' },
    ])
  })

  it('tiebreaks ambiguous candidates by preferring the one in the same file as the caller', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      // The caller itself is included here, same as real usage — Pass 1
      // writes every file's nodes (including `main`) before Pass 2 runs, so
      // getProjectNodeSummaries always includes the calling entity too.
      node({ id: 'a.py::function::main', name: 'main', filePath: 'a.py' }),
      node({ id: 'a.py::function::helper', name: 'helper', filePath: 'a.py' }),
      node({ id: 'b.py::function::helper', name: 'helper', filePath: 'b.py' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'helper', kind: 'call' },
    ])

    expect(summary).toEqual({ resolved: 1, unresolved: 0 })
    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'a.py::function::main', targetId: 'a.py::function::helper', relationshipType: 'CALLS' },
    ])
  })
})

describe('resolveLinks — batching and edge cases', () => {
  it('returns {resolved:0, unresolved:0} and touches no storage function for an empty ref list', async () => {
    const summary = await resolveLinks(PROJECT_ID, [])
    expect(summary).toEqual({ resolved: 0, unresolved: 0 })
    expect(getProjectNodeSummariesMock).not.toHaveBeenCalled()
    expect(upsertEdgesMock).not.toHaveBeenCalled()
    expect(insertUnresolvedRefsMock).not.toHaveBeenCalled()
  })

  it('partitions a mixed batch into resolved edges and unresolved refs correctly', async () => {
    getProjectNodeSummariesMock.mockResolvedValue([
      node({ id: 'a.py::function::helper', name: 'helper', filePath: 'a.py' }),
    ])

    const summary = await resolveLinks(PROJECT_ID, [
      { fromEntityId: 'a.py::function::main', rawTargetName: 'helper', kind: 'call' },
      { fromEntityId: 'a.py::function::main', rawTargetName: 'ghost', kind: 'call' },
    ])

    expect(summary).toEqual({ resolved: 1, unresolved: 1 })
    expect(upsertEdgesMock).toHaveBeenCalledTimes(1)
    expect(insertUnresolvedRefsMock).toHaveBeenCalledTimes(1)
  })
})

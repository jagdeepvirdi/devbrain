import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CodeNode, CodeEdge, UnresolvedRef } from '../../../services/codeIntel/types.js'

vi.mock('../../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const storage = await import('../../../services/codeIntel/storage.js')
const { pool } = await import('../../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

const fullNode: CodeNode = {
  id:          'a.ts::function::foo',
  projectId:   'p1',
  filePath:    'a.ts',
  language:    'typescript',
  entityType:  'function',
  name:        'foo',
  signature:   '(x: number) => void',
  docstring:   'does foo things',
  startLine:   1,
  endLine:     10,
  contentHash: 'abc123',
}

const minimalNode: CodeNode = {
  id:         'table::p1::accounts',
  projectId:  'p1',
  language:   'sql',
  entityType: 'table',
  name:       'accounts',
}

function nodeRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id:           'a.ts::function::foo',
    project_id:   'p1',
    file_path:    'a.ts',
    language:     'typescript',
    entity_type:  'function',
    name:         'foo',
    signature:    '(x: number) => void',
    docstring:    'does foo things',
    start_line:   1,
    end_line:     10,
    content_hash: 'abc123',
    ...overrides,
  }
}

function nullFieldNodeRow() {
  return {
    id:           'table::p1::accounts',
    project_id:   'p1',
    file_path:    null,
    language:     'sql',
    entity_type:  'table',
    name:         'accounts',
    signature:    null,
    docstring:    null,
    start_line:   null,
    end_line:     null,
    content_hash: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('upsertNodes', () => {
  it('does nothing for an empty array', async () => {
    await storage.upsertNodes([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts each node with all fields populated', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    await storage.upsertNodes([fullNode])

    expect(mockQuery).toHaveBeenCalledTimes(1)
    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('INSERT INTO code_nodes')
    expect(params).toEqual([
      'a.ts::function::foo', 'p1', 'a.ts', 'typescript', 'function', 'foo',
      '(x: number) => void', 'does foo things', 1, 10, 'abc123',
    ])
  })

  it('nullifies missing optional fields and loops over multiple nodes', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    await storage.upsertNodes([fullNode, minimalNode])

    expect(mockQuery).toHaveBeenCalledTimes(2)
    const [, params] = mockQuery.mock.calls[1]
    expect(params).toEqual([
      'table::p1::accounts', 'p1', null, 'sql', 'table', 'accounts',
      null, null, null, null, null,
    ])
  })
})

describe('upsertEdges', () => {
  it('does nothing for an empty array', async () => {
    await storage.upsertEdges([])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts an edge with columns, and nullifies missing columns', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    const edges: CodeEdge[] = [
      { sourceId: 's1', targetId: 't1', relationshipType: 'WRITES_TABLE', columns: ['id', 'balance'] },
      { sourceId: 's2', targetId: 't2', relationshipType: 'CALLS' },
    ]
    await storage.upsertEdges(edges)

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(String(mockQuery.mock.calls[0][0])).toContain('INSERT INTO code_edges')
    expect(mockQuery.mock.calls[0][1]).toEqual(['s1', 't1', 'WRITES_TABLE', ['id', 'balance']])
    expect(mockQuery.mock.calls[1][1]).toEqual(['s2', 't2', 'CALLS', null])
  })
})

describe('insertUnresolvedRefs', () => {
  it('does nothing for an empty array', async () => {
    await storage.insertUnresolvedRefs('p1', [])
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('inserts each ref, nullifying a missing reason', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    const refs: UnresolvedRef[] = [
      { fromEntityId: 'e1', rawTargetName: 'do_thing', kind: 'call', reason: 'ambiguous match' },
      { fromEntityId: 'e2', rawTargetName: 'other', kind: 'import' },
    ]
    await storage.insertUnresolvedRefs('p1', refs)

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(String(mockQuery.mock.calls[0][0])).toContain('INSERT INTO code_unresolved_refs')
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1', 'e1', 'do_thing', 'call', 'ambiguous match'])
    expect(mockQuery.mock.calls[1][1]).toEqual(['p1', 'e2', 'other', 'import', null])
  })
})

describe('clearProjectGraph', () => {
  it('deletes unresolved refs then nodes, both scoped to the project', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)

    await storage.clearProjectGraph('p1')

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(String(mockQuery.mock.calls[0][0])).toContain('DELETE FROM code_unresolved_refs')
    expect(mockQuery.mock.calls[0][1]).toEqual(['p1'])
    expect(String(mockQuery.mock.calls[1][0])).toContain('DELETE FROM code_nodes')
    expect(mockQuery.mock.calls[1][1]).toEqual(['p1'])
  })
})

describe('getProjectNodeSummaries', () => {
  it('maps snake_case rows to NodeSummary', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'a.ts::function::foo', name: 'foo', entity_type: 'function', language: 'typescript', file_path: 'a.ts' }],
    } as never)

    const result = await storage.getProjectNodeSummaries('p1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['p1'])
    expect(result).toEqual([
      { id: 'a.ts::function::foo', name: 'foo', entityType: 'function', language: 'typescript', filePath: 'a.ts' },
    ])
  })
})

describe('getNodeById', () => {
  it('returns the mapped node when found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] } as never)

    const result = await storage.getNodeById('a.ts::function::foo')

    expect(mockQuery.mock.calls[0][1]).toEqual(['a.ts::function::foo'])
    expect(result).toEqual(fullNode)
  })

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const result = await storage.getNodeById('missing')

    expect(result).toBeNull()
  })

  it('maps null optional columns to undefined', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [nullFieldNodeRow()] } as never)

    const result = await storage.getNodeById('table::p1::accounts')

    expect(result).toEqual(minimalNode)
  })
})

describe('searchNodes', () => {
  it('filters by name/file_path ILIKE when a search term is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] } as never)

    const result = await storage.searchNodes('p1', 'foo', 50)

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).toContain('ILIKE')
    expect(params).toEqual(['p1', '%foo%', 50])
    expect(result).toEqual([fullNode])
  })

  it('lists unfiltered nodes with default limit when no search term is given', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await storage.searchNodes('p1')

    const [sql, params] = mockQuery.mock.calls[0]
    expect(String(sql)).not.toContain('ILIKE')
    expect(params).toEqual(['p1', 100])
  })
})

describe('getUnresolvedRefsForProject', () => {
  it('maps snake_case rows to UnresolvedRefRow', async () => {
    const createdAt = new Date('2026-08-14T00:00:00Z')
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'r1', from_entity_id: 'e1', raw_target_name: 'do_thing', kind: 'call', reason: 'no match', created_at: createdAt }],
    } as never)

    const result = await storage.getUnresolvedRefsForProject('p1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['p1'])
    expect(result).toEqual([
      { id: 'r1', fromEntityId: 'e1', rawTargetName: 'do_thing', kind: 'call', reason: 'no match', createdAt },
    ])
  })
})

describe('getIncomingEdgeDetails / getOutgoingEdgeDetails', () => {
  it('maps a joined node + edge row to EdgeDetail (incoming)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...nodeRow(), relationship_type: 'CALLS', columns: null }],
    } as never)

    const result = await storage.getIncomingEdgeDetails('e1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1'])
    expect(result).toEqual([{ node: fullNode, relationshipType: 'CALLS', columns: null }])
  })

  it('maps a joined node + edge row to EdgeDetail (outgoing)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ ...nodeRow(), relationship_type: 'WRITES_TABLE', columns: ['id'] }],
    } as never)

    const result = await storage.getOutgoingEdgeDetails('e1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1'])
    expect(result).toEqual([{ node: fullNode, relationshipType: 'WRITES_TABLE', columns: ['id'] }])
  })
})

describe('getCallers / getCallees', () => {
  it('returns callers mapped to CodeNode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] } as never)

    const result = await storage.getCallers('e1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1'])
    expect(result).toEqual([fullNode])
  })

  it('returns callees mapped to CodeNode', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [nodeRow()] } as never)

    const result = await storage.getCallees('e1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1'])
    expect(result).toEqual([fullNode])
  })
})

describe('getImpactTree', () => {
  it('maps rows to ImpactNode, sorted by depth, and passes the default depth', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { ...nodeRow({ id: 'b.ts::function::bar', name: 'bar' }), depth: 2 },
        { ...nodeRow(), depth: 1 },
      ],
    } as never)

    const result = await storage.getImpactTree('e1')

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1', 3])
    expect(result.map(n => n.depth)).toEqual([1, 2])
    expect(result[0]).toEqual({ ...fullNode, depth: 1 })
  })

  it('passes a custom depth through to the query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    await storage.getImpactTree('e1', 5)

    expect(mockQuery.mock.calls[0][1]).toEqual(['e1', 5])
  })
})

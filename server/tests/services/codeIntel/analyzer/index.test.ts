import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CodeNode } from '../../../../services/codeIntel/types.js'

const getNodeByIdMock          = vi.fn()
const getIncomingEdgeDetailsMock = vi.fn()
const getOutgoingEdgeDetailsMock = vi.fn()
const getCallersMock  = vi.fn()
const getCalleesMock  = vi.fn()
const getImpactTreeMock = vi.fn()
const readFileMock = vi.fn()

vi.mock('../../../../services/codeIntel/storage.js', () => ({
  getNodeById:            (...a: unknown[]) => getNodeByIdMock(...a),
  getIncomingEdgeDetails: (...a: unknown[]) => getIncomingEdgeDetailsMock(...a),
  getOutgoingEdgeDetails: (...a: unknown[]) => getOutgoingEdgeDetailsMock(...a),
  getCallers:             (...a: unknown[]) => getCallersMock(...a),
  getCallees:             (...a: unknown[]) => getCalleesMock(...a),
  getImpactTree:          (...a: unknown[]) => getImpactTreeMock(...a),
}))
vi.mock('node:fs/promises', () => ({ readFile: (...a: unknown[]) => readFileMock(...a) }))

const { getContext, getCallers, getCallees, getImpactTree } = await import('../../../../services/codeIntel/analyzer/index.js')

function node(overrides: Partial<CodeNode>): CodeNode {
  return {
    id: 'a.py::function::main', projectId: 'proj-1', language: 'python', entityType: 'function', name: 'main',
    filePath: 'a.py', startLine: 2, endLine: 4, contentHash: 'abc', ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getContext', () => {
  it('returns a not-found message for an unknown entity id', async () => {
    getNodeByIdMock.mockResolvedValue(null)
    const md = await getContext('nope')
    expect(md).toContain('Entity not found')
  })

  it('includes the sliced source, docstring, callers, and callees in the Markdown output', async () => {
    getNodeByIdMock.mockResolvedValue(node({ docstring: 'Runs the thing.' }))
    readFileMock.mockResolvedValue('line1\ndef main():\n    return 1\nline4\n')
    getIncomingEdgeDetailsMock.mockResolvedValue([
      { node: node({ id: 'b.py::function::caller', name: 'caller', filePath: 'b.py', startLine: 1 }), relationshipType: 'CALLS', columns: null },
    ])
    getOutgoingEdgeDetailsMock.mockResolvedValue([
      { node: node({ id: 'table::proj-1::accounts', name: 'accounts', entityType: 'table', filePath: undefined, startLine: undefined }),
        relationshipType: 'READS_TABLE', columns: ['id', 'balance'] },
    ])

    const md = await getContext('a.py::function::main')

    expect(md).toContain('# main')
    expect(md).toContain('Runs the thing.')
    expect(md).toContain('def main():\n    return 1')
    expect(md).toContain('Callers (1)')
    expect(md).toContain('caller')
    expect(md).toContain('Callees / references (1)')
    expect(md).toContain('READS_TABLE')
    expect(md).toContain('columns: id, balance')
  })

  it('shows "none found" sections when there are no callers or callees', async () => {
    getNodeByIdMock.mockResolvedValue(node({}))
    readFileMock.mockResolvedValue('def main():\n    pass\n')
    getIncomingEdgeDetailsMock.mockResolvedValue([])
    getOutgoingEdgeDetailsMock.mockResolvedValue([])

    const md = await getContext('a.py::function::main')
    expect(md).toContain('Callers (0)')
    expect(md).toContain('_none found_')
  })

  it('handles a table node (no file location) without attempting to read a file', async () => {
    getNodeByIdMock.mockResolvedValue(node({
      id: 'table::proj-1::accounts', name: 'accounts', entityType: 'table', filePath: undefined, startLine: undefined, endLine: undefined,
    }))
    getIncomingEdgeDetailsMock.mockResolvedValue([])
    getOutgoingEdgeDetailsMock.mockResolvedValue([])

    const md = await getContext('table::proj-1::accounts')
    expect(readFileMock).not.toHaveBeenCalled()
    expect(md).toContain('no source location')
  })

  it('degrades gracefully when the source file can no longer be read', async () => {
    getNodeByIdMock.mockResolvedValue(node({}))
    readFileMock.mockRejectedValue(new Error('ENOENT: no such file'))
    getIncomingEdgeDetailsMock.mockResolvedValue([])
    getOutgoingEdgeDetailsMock.mockResolvedValue([])

    const md = await getContext('a.py::function::main')
    expect(md).toContain('source unavailable')
  })
})

describe('re-exports', () => {
  it('re-exports getCallers/getCallees/getImpactTree from storage.ts unchanged', async () => {
    getCallersMock.mockResolvedValue(['x'])
    getCalleesMock.mockResolvedValue(['y'])
    getImpactTreeMock.mockResolvedValue(['z'])

    expect(await getCallers('id')).toEqual(['x'])
    expect(await getCallees('id')).toEqual(['y'])
    expect(await getImpactTree('id', 2)).toEqual(['z'])
    expect(getImpactTreeMock).toHaveBeenCalledWith('id', 2)
  })
})

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const upsertNodesMock        = vi.fn()
const upsertEdgesMock        = vi.fn()
const clearProjectGraphMock  = vi.fn()
const resolveLinksMock       = vi.fn()
const treeSitterExtractMock  = vi.fn()
const bashExtractMock        = vi.fn()
const pythonBridgeExtractMock = vi.fn()
const extractEntitiesWithSchemaMock = vi.fn()

vi.mock('../../services/codeIntel/storage.js', () => ({
  upsertNodes:       (...a: unknown[]) => upsertNodesMock(...a),
  upsertEdges:       (...a: unknown[]) => upsertEdgesMock(...a),
  clearProjectGraph: (...a: unknown[]) => clearProjectGraphMock(...a),
}))
vi.mock('../../services/codeIntel/analyzer/linkResolver.js', () => ({
  resolveLinks: (...a: unknown[]) => resolveLinksMock(...a),
}))
vi.mock('../../services/codeIntel/parsers/treeSitterParser.js', () => ({
  treeSitterParser: { languages: ['python', 'typescript', 'javascript'], extractEntities: (...a: unknown[]) => treeSitterExtractMock(...a) },
}))
vi.mock('../../services/codeIntel/parsers/bashParser.js', () => ({
  bashParser: { languages: ['bash'], extractEntities: (...a: unknown[]) => bashExtractMock(...a) },
}))
vi.mock('../../services/codeIntel/parsers/pythonBridgeParser.js', () => ({
  pythonBridgeParser: { languages: ['sql', 'plsql', 'perl'], extractEntities: (...a: unknown[]) => pythonBridgeExtractMock(...a) },
  extractEntitiesWithSchema: (...a: unknown[]) => extractEntitiesWithSchemaMock(...a),
}))
// index-code-graph.ts imports the real db/pool.js for project/schema lookups
// (runIndexer itself doesn't touch it — only main() does) — stubbed so
// importing the module doesn't require a real DATABASE_URL/full env schema.
vi.mock('../../db/pool.js', () => ({ pool: { query: vi.fn(), end: vi.fn() } }))

const emptyResult = { nodes: [], edges: [], unresolvedRefs: [] }

const { runIndexer } = await import('../../scripts/index-code-graph.js')

const PROJECT_ID = 'proj-1'
let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-index-test-'))
  await fs.writeFile(path.join(tmpDir, 'main.py'), 'def main():\n    pass\n')
  await fs.writeFile(path.join(tmpDir, 'run.sh'), 'run() {\n  echo hi\n}\n')
  await fs.writeFile(path.join(tmpDir, 'query.sql'), 'SELECT 1;\n')
  await fs.writeFile(path.join(tmpDir, 'notes.txt'), 'not code\n')
  await fs.writeFile(path.join(tmpDir, '.gitignore'), 'ignored.py\n')
  await fs.writeFile(path.join(tmpDir, 'ignored.py'), 'def should_not_be_seen(): pass\n')
  await fs.mkdir(path.join(tmpDir, 'sub'))
  await fs.writeFile(path.join(tmpDir, 'sub', 'nested.py'), 'def nested(): pass\n')
  await fs.mkdir(path.join(tmpDir, 'node_modules'))
  await fs.writeFile(path.join(tmpDir, 'node_modules', 'vendor.py'), 'def vendored(): pass\n')
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.clearAllMocks()
  treeSitterExtractMock.mockResolvedValue(emptyResult)
  bashExtractMock.mockResolvedValue(emptyResult)
  pythonBridgeExtractMock.mockResolvedValue(emptyResult)
  extractEntitiesWithSchemaMock.mockResolvedValue(emptyResult)
  resolveLinksMock.mockResolvedValue({ resolved: 0, unresolved: 0 })
})

describe('runIndexer — walking and dispatch', () => {
  it('clears the project graph before indexing', async () => {
    await runIndexer(tmpDir, PROJECT_ID, undefined)
    expect(clearProjectGraphMock).toHaveBeenCalledWith(PROJECT_ID)
  })

  it('dispatches each file to the correct parser by extension, recursing into subdirectories', async () => {
    await runIndexer(tmpDir, PROJECT_ID, undefined)

    expect(treeSitterExtractMock).toHaveBeenCalledTimes(2) // main.py + sub/nested.py
    expect(bashExtractMock).toHaveBeenCalledTimes(1)       // run.sh
    expect(pythonBridgeExtractMock).toHaveBeenCalledTimes(1) // query.sql (no schema)

    const calledPaths = treeSitterExtractMock.mock.calls.map(c => c[0])
    expect(calledPaths.some(p => p.endsWith('sub' + path.sep + 'nested.py') || p.endsWith('sub/nested.py'))).toBe(true)
  })

  it('excludes node_modules (default) and .gitignore-listed files without ever passing them to a parser', async () => {
    await runIndexer(tmpDir, PROJECT_ID, undefined)

    const allCalledPaths = [
      ...treeSitterExtractMock.mock.calls, ...bashExtractMock.mock.calls, ...pythonBridgeExtractMock.mock.calls,
    ].map(c => c[0] as string)

    expect(allCalledPaths.some(p => p.includes('node_modules'))).toBe(false)
    expect(allCalledPaths.some(p => p.includes('ignored.py'))).toBe(false)
  })

  it('records an unrecognized extension as skipped, not as a parsed file', async () => {
    const summary = await runIndexer(tmpDir, PROJECT_ID, undefined)
    const notesSkip = summary.skipped.find(s => s.path.endsWith('notes.txt'))
    expect(notesSkip?.reason).toBe('unrecognized extension')
  })

  it('uses extractEntitiesWithSchema (not the generic dispatch) for sql files when a project schema is supplied', async () => {
    const schema = { accounts: [{ columnName: 'id', dataType: 'int' }] }
    await runIndexer(tmpDir, PROJECT_ID, schema)

    expect(extractEntitiesWithSchemaMock).toHaveBeenCalledWith(
      expect.stringContaining('query.sql'), PROJECT_ID, expect.any(String), 'sql', schema,
    )
    expect(pythonBridgeExtractMock).not.toHaveBeenCalled()
  })
})

describe('runIndexer — aggregation and writes', () => {
  it('aggregates nodes/edges/refs from every parsed file and writes them once', async () => {
    // Two python files exist in the fixture tree (main.py, sub/nested.py) so
    // this mock fires twice — differentiate by path rather than
    // mockResolvedValue-ing one payload for both calls.
    treeSitterExtractMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('main.py')) {
        return {
          nodes: [{ id: 'n1', projectId: PROJECT_ID, language: 'python', entityType: 'function', name: 'main' }],
          edges: [], unresolvedRefs: [{ fromEntityId: 'n1', rawTargetName: 'helper', kind: 'call' }],
        }
      }
      return emptyResult
    })
    bashExtractMock.mockResolvedValue({
      nodes: [{ id: 'n2', projectId: PROJECT_ID, language: 'bash', entityType: 'function', name: 'run' }],
      edges: [{ sourceId: 'n2', targetId: 'table::proj-1::accounts', relationshipType: 'READS_TABLE', columns: null }],
      unresolvedRefs: [],
    })
    resolveLinksMock.mockResolvedValue({ resolved: 1, unresolved: 1 })

    const summary = await runIndexer(tmpDir, PROJECT_ID, undefined)

    expect(upsertNodesMock).toHaveBeenCalledTimes(1)
    const writtenNodes = upsertNodesMock.mock.calls[0][0]
    expect(writtenNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'n1' }), expect.objectContaining({ id: 'n2' }),
    ]))

    expect(upsertEdgesMock).toHaveBeenCalledWith([
      { sourceId: 'n2', targetId: 'table::proj-1::accounts', relationshipType: 'READS_TABLE', columns: null },
    ])
    expect(resolveLinksMock).toHaveBeenCalledWith(PROJECT_ID, [
      { fromEntityId: 'n1', rawTargetName: 'helper', kind: 'call' },
    ])

    expect(summary.nodesWritten).toBe(2)
    expect(summary.directEdgesWritten).toBe(1)
    expect(summary.referencesFound).toBe(1)
    expect(summary.referencesResolved).toBe(1)
    expect(summary.referencesUnresolved).toBe(1)
  })

  it('reports per-language parsed-file counts', async () => {
    const summary = await runIndexer(tmpDir, PROJECT_ID, undefined)
    expect(summary.perLanguage).toEqual({ python: 2, bash: 1, sql: 1 })
    expect(summary.filesParsed).toBe(4)
  })
})

describe('runIndexer — partial-failure resilience', () => {
  it("one file's parse failure is recorded as skipped without stopping the rest of the run", async () => {
    treeSitterExtractMock.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('main.py')) throw new Error('boom')
      return emptyResult
    })

    const summary = await runIndexer(tmpDir, PROJECT_ID, undefined)

    const failedEntry = summary.skipped.find(s => s.path.endsWith('main.py'))
    expect(failedEntry?.reason).toContain('parse error')
    expect(failedEntry?.reason).toContain('boom')
    // sub/nested.py is also python and should still have been attempted.
    expect(treeSitterExtractMock).toHaveBeenCalledTimes(2)
  })
})

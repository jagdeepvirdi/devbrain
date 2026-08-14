import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'node:path'

// pythonBridgeParser.ts resolves its scripts from its own file location, not
// process.cwd() (see the comment there for why) — this test file is 3
// directories deeper than server/ (server/tests/services/codeIntel/), same
// distance as pythonBridgeParser.ts itself (server/services/codeIntel/parsers/),
// so the same '../../../scripts/...' climb from __dirname lands on the same
// real absolute path it will actually invoke, not a guessed string that
// could silently drift out of sync with it.
const SQL_BRIDGE_PY  = path.join(__dirname, '../../../scripts/sql_bridge.py')
const PERL_BRIDGE_PY = path.join(__dirname, '../../../scripts/perl_bridge.py')

// Mocked the same way tests/services/parser.test.ts mocks node:child_process
// for markitdown_bridge.py — CI shouldn't need Python/sqlglot installed to
// run this suite. sql_bridge.py/perl_bridge.py's own correctness (parsing,
// table/column extraction, DBI classification, ...) was verified separately
// against a real local Python+sqlglot install while building them (TASKS.md
// Phase 40, items 4-5); what's under test here is pythonBridgeParser.ts's
// own job — normalizing their JSON into CodeNode[]/CodeEdge[]/UnresolvedRef[].
const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
  // pythonBridgeParser.ts imports CODE_EXT_LANGUAGE from services/parser.ts,
  // which calls promisify(exec) at module load — needs a stub to exist even
  // though this suite never exercises that path.
  exec: vi.fn(),
}))

function mockStdout(json: unknown): void {
  execFileMock.mockImplementation((_file, _args, _options, cb) => {
    cb(null, { stdout: JSON.stringify(json) })
  })
}

function mockFailure(message: string): void {
  execFileMock.mockImplementation((_file, _args, _options, cb) => {
    cb(new Error(message))
  })
}

beforeEach(() => {
  execFileMock.mockReset()
})

const { extractEntitiesWithSchema, pythonBridgeParser, extractSqlOutline } = await import('../../../services/codeIntel/parsers/pythonBridgeParser.js')

describe('pythonBridgeParser — SQL normalization', () => {
  it('builds the file-level script node, the procedure node, and a table node for a READS_TABLE edge', async () => {
    mockStdout({
      nodes: [{ entity_type: 'procedure', name: 'get_balance', signature: 'CREATE PROCEDURE get_balance(...)', start_line: 2, end_line: 6 }],
      edges: [{ from_entity_name: 'get_balance', relationship_type: 'READS_TABLE', table: 'accounts', columns: ['balance', 'id'] }],
      unresolved_refs: [],
    })

    const source = 'line1\nCREATE PROCEDURE get_balance(...)\nBEGIN\n  SELECT balance FROM accounts;\nEND;\nline6\n'
    const result = await extractEntitiesWithSchema('billing/proc.sql', 'proj-1', source, 'sql')

    const fileNode = result.nodes.find(n => n.entityType === 'script')!
    const procNode = result.nodes.find(n => n.entityType === 'procedure')!
    const tableNode = result.nodes.find(n => n.entityType === 'table')!

    expect(fileNode.id).toBe('billing/proc.sql::script::proc.sql')
    expect(procNode.id).toBe('billing/proc.sql::procedure::get_balance')
    expect(procNode.startLine).toBe(2)
    expect(procNode.endLine).toBe(6)
    expect(procNode.contentHash).toBeTruthy()

    // Table nodes are project-scoped, not file-scoped — no filePath component.
    expect(tableNode.id).toBe('table::proj-1::accounts')
    expect(tableNode.filePath).toBeUndefined()
    expect(tableNode.startLine).toBeUndefined()

    expect(result.edges).toEqual([{
      sourceId: procNode.id, targetId: tableNode.id, relationshipType: 'READS_TABLE', columns: ['balance', 'id'],
    }])
  })

  it('resolves from_entity_name: null to the file-level script node', async () => {
    mockStdout({
      nodes: [],
      edges: [{ from_entity_name: null, relationship_type: 'READS_TABLE', table: 'accounts', columns: null }],
      unresolved_refs: [],
    })

    const result = await extractEntitiesWithSchema('top_level.sql', 'proj-1', 'SELECT * FROM accounts;', 'sql')
    const fileNode = result.nodes.find(n => n.entityType === 'script')!
    expect(result.edges[0].sourceId).toBe(fileNode.id)
  })

  it('reuses the same table node id across multiple edges to the same table', async () => {
    mockStdout({
      nodes: [],
      edges: [
        { from_entity_name: null, relationship_type: 'READS_TABLE', table: 'accounts', columns: null },
        { from_entity_name: null, relationship_type: 'WRITES_TABLE', table: 'accounts', columns: null },
      ],
      unresolved_refs: [],
    })

    const result = await extractEntitiesWithSchema('x.sql', 'proj-1', 'x', 'sql')
    const tableNodes = result.nodes.filter(n => n.entityType === 'table')
    expect(tableNodes).toHaveLength(1)
    expect(result.edges[0].targetId).toBe(result.edges[1].targetId)
  })

  it('passes --dialect oracle for plsql and --dialect postgres for sql', async () => {
    mockStdout({ nodes: [], edges: [], unresolved_refs: [] })

    await extractEntitiesWithSchema('proc.spc', 'proj-1', 'x', 'plsql')
    expect(execFileMock.mock.calls[0][1]).toEqual(expect.arrayContaining(['--dialect', 'oracle']))

    await extractEntitiesWithSchema('query.sql', 'proj-1', 'x', 'sql')
    expect(execFileMock.mock.calls[1][1]).toEqual(expect.arrayContaining(['--dialect', 'postgres']))
  })

  it('passes --schema as JSON when a project schema is supplied', async () => {
    mockStdout({ nodes: [], edges: [], unresolved_refs: [] })
    const schema = { accounts: [{ columnName: 'id', dataType: 'int' }] }

    await extractEntitiesWithSchema('query.sql', 'proj-1', 'x', 'sql', schema)
    const args = execFileMock.mock.calls[0][1] as string[]
    const schemaIdx = args.indexOf('--schema')
    expect(schemaIdx).toBeGreaterThan(-1)
    expect(JSON.parse(args[schemaIdx + 1])).toEqual(schema)
  })
})

describe('pythonBridgeParser — Perl normalization', () => {
  it('normalizes subroutine nodes and import/call unresolved refs', async () => {
    mockStdout({
      nodes: [{ entity_type: 'subroutine', name: 'apply_fee', signature: 'sub apply_fee {', start_line: 3, end_line: 9 }],
      edges: [],
      unresolved_refs: [
        { from_entity_name: null, raw_target_name: 'DBI', kind: 'import' },
        { from_entity_name: 'apply_fee', raw_target_name: 'helper', kind: 'call' },
        { from_entity_name: 'apply_fee', raw_target_name: 'mark_delinquent', kind: 'sql_exec' },
      ],
    })

    const result = await extractEntitiesWithSchema('Billing.pm', 'proj-1', 'x'.repeat(1), 'perl')
    const subNode = result.nodes.find(n => n.entityType === 'subroutine')!
    const fileNode = result.nodes.find(n => n.entityType === 'script')!

    expect(subNode.name).toBe('apply_fee')
    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fileNode.id, rawTargetName: 'DBI', kind: 'import' },
      { fromEntityId: subNode.id, rawTargetName: 'helper', kind: 'call' },
      { fromEntityId: subNode.id, rawTargetName: 'mark_delinquent', kind: 'sql_exec' },
    ])
  })
})

describe('pythonBridgeParser — graceful degradation', () => {
  it('returns an empty ParseResult (not a throw) when the bridge process fails', async () => {
    mockFailure('python: command not found')
    const result = await extractEntitiesWithSchema('x.sql', 'proj-1', 'x', 'sql')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
  })

  it('returns an empty ParseResult when the bridge outputs malformed JSON', async () => {
    execFileMock.mockImplementation((_file, _args, _options, cb) => {
      cb(null, { stdout: 'not json at all' })
    })
    const result = await extractEntitiesWithSchema('x.sql', 'proj-1', 'x', 'sql')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
  })
})

describe('pythonBridgeParser — extractSqlOutline', () => {
  it('builds one outline line per entity, with signature, line range, and reads/writes tables', async () => {
    mockStdout({
      nodes: [
        { entity_type: 'procedure', name: 'get_balance', signature: 'PROCEDURE get_balance(p_id IN NUMBER)', start_line: 2, end_line: 9 },
      ],
      edges: [
        { from_entity_name: 'get_balance', relationship_type: 'READS_TABLE', table: 'accounts', columns: null },
        { from_entity_name: 'get_balance', relationship_type: 'WRITES_TABLE', table: 'audit_log', columns: null },
      ],
      unresolved_refs: [],
    })

    const outline = await extractSqlOutline('CREATE PROCEDURE get_balance...', 'plsql')

    expect(outline).toEqual([
      'PROCEDURE get_balance(p_id IN NUMBER) (lines 2-9) — writes: audit_log; reads: accounts',
    ])
  })

  it('falls back to the entity name when sql_bridge.py reports no signature', async () => {
    mockStdout({
      nodes: [{ entity_type: 'procedure', name: 'noop', signature: null, start_line: 1, end_line: 1 }],
      edges: [],
      unresolved_refs: [],
    })

    const outline = await extractSqlOutline('x', 'sql')
    expect(outline).toEqual(['noop (lines 1-1)'])
  })

  it('returns null when the bridge finds no entities at all', async () => {
    mockStdout({ nodes: [], edges: [], unresolved_refs: [] })
    const outline = await extractSqlOutline('SELECT 1;', 'sql')
    expect(outline).toBeNull()
  })

  it('returns null (not a throw) when the bridge process fails', async () => {
    mockFailure('python: command not found')
    const outline = await extractSqlOutline('x', 'sql')
    expect(outline).toBeNull()
  })
})

describe('pythonBridgeParser — BaseParser dispatch', () => {
  it('infers sql/plsql/perl from the file extension and calls the bridge', async () => {
    mockStdout({ nodes: [], edges: [], unresolved_refs: [] })
    await pythonBridgeParser.extractEntities('billing/proc.spc', 'proj-1', 'x')
    expect(execFileMock).toHaveBeenCalledWith(
      'python', expect.arrayContaining([SQL_BRIDGE_PY, 'billing/proc.spc']), expect.anything(), expect.anything(),
    )
  })

  it('dispatches .pl files to perl_bridge.py, not sql_bridge.py', async () => {
    mockStdout({ nodes: [], edges: [], unresolved_refs: [] })
    await pythonBridgeParser.extractEntities('script.pl', 'proj-1', 'x')
    expect(execFileMock).toHaveBeenCalledWith(
      'python', [PERL_BRIDGE_PY, 'script.pl'], expect.anything(), expect.anything(),
    )
  })

  it('returns empty for an unrecognized extension without invoking the bridge at all', async () => {
    const result = await pythonBridgeParser.extractEntities('README.md', 'proj-1', '# hi')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
    expect(execFileMock).not.toHaveBeenCalled()
  })
})

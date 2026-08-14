import { describe, it, expect } from 'vitest'
import { bashParser } from '../../../services/codeIntel/parsers/bashParser.js'

const PROJECT_ID = 'proj-1'

describe('bashParser — psql', () => {
  it('reports -f as a script_invocation, not a generic call to psql', async () => {
    const source = [
      'run_backup() {',
      '  psql -h localhost -f backup.sql mydb',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/backup.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'run_backup')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fn.id, rawTargetName: 'backup.sql', kind: 'script_invocation' },
    ])
    // The generic bash 'call' extraction would otherwise report this same
    // line as a call to the bare command name 'psql' — that must be gone,
    // replaced by the more precise ref above, not present alongside it.
    expect(result.unresolvedRefs.some(r => r.rawTargetName === 'psql')).toBe(false)
  })

  it('classifies -c "CALL proc(...)" as sql_exec, not script_invocation', async () => {
    const source = [
      'apply_fee() {',
      '  psql -c "CALL update_balance(1, 2)" mydb',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/fee.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'apply_fee')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fn.id, rawTargetName: 'update_balance', kind: 'sql_exec' },
    ])
  })

  it('classifies -c with plain DML as a READS_TABLE/WRITES_TABLE edge with a table node', async () => {
    const source = [
      'nightly() {',
      '  psql -c "UPDATE accounts SET status = 1" mydb',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/nightly.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'nightly')!
    const tableNode = result.nodes.find(n => n.entityType === 'table')!

    expect(tableNode.name).toBe('accounts')
    expect(tableNode.id).toBe(`table::${PROJECT_ID}::accounts`)
    expect(result.edges).toEqual([
      { sourceId: fn.id, targetId: tableNode.id, relationshipType: 'WRITES_TABLE', columns: null },
    ])
  })
})

describe('bashParser — source / .', () => {
  it('reports "source other.sh" as a script_invocation, not a generic call to source', async () => {
    const source = [
      'run_backup() {',
      '  source db_helpers.sh',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/backup.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'run_backup')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fn.id, rawTargetName: 'db_helpers.sh', kind: 'script_invocation' },
    ])
    expect(result.unresolvedRefs.some(r => r.rawTargetName === 'source')).toBe(false)
  })

  it('treats the "." alias the same as "source"', async () => {
    const source = [
      'run_backup() {',
      '  . ./db_helpers.sh',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/backup.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'run_backup')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fn.id, rawTargetName: './db_helpers.sh', kind: 'script_invocation' },
    ])
  })
})

describe('bashParser — sqlplus', () => {
  it('extracts the @script argument, not the connection-string @ inside user/pass@db', async () => {
    const source = [
      'nightly_job() {',
      '  sqlplus -s user/pass@db @nightly_job.sql',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/job.sh', PROJECT_ID, source)
    const fn = result.nodes.find(n => n.name === 'nightly_job')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fn.id, rawTargetName: 'nightly_job.sql', kind: 'script_invocation' },
    ])
  })
})

describe('bashParser — scope and passthrough', () => {
  it('attributes a top-level psql call (outside any function) to the file-level script node', async () => {
    const source = 'psql -f init.sql mydb\n'
    const result = await bashParser.extractEntities('scripts/init.sh', PROJECT_ID, source)
    const fileNode = result.nodes.find(n => n.entityType === 'script')!

    expect(result.unresolvedRefs).toEqual([
      { fromEntityId: fileNode.id, rawTargetName: 'init.sql', kind: 'script_invocation' },
    ])
  })

  it('leaves ordinary (non-SQL-client) generic call detection untouched', async () => {
    const source = [
      'main() {',
      '  helper_function',
      '}',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/main.sh', PROJECT_ID, source)
    expect(result.unresolvedRefs.some(r => r.rawTargetName === 'helper_function' && r.kind === 'call')).toBe(true)
  })

  it('still extracts function nodes exactly as the generic bash parser does', async () => {
    const source = [
      'first() { echo one; }',
      'second() { psql -f x.sql; }',
    ].join('\n')

    const result = await bashParser.extractEntities('scripts/two.sh', PROJECT_ID, source)
    expect(result.nodes.map(n => n.name)).toEqual(expect.arrayContaining(['first', 'second']))
  })
})

describe('bashParser — BaseParser conformance', () => {
  it('declares itself for the bash language only', () => {
    expect(bashParser.languages).toEqual(['bash'])
  })
})

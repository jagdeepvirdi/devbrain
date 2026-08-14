import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Real subprocess tests of perl_bridge.py itself (pure stdlib, no sqlglot
// needed — but still needs a Python interpreter to run at all). Same
// skip-gracefully contract as sql_bridge.test.ts — see that file's comment
// for the full rationale.
let pythonAvailable = false
try {
  execSync('python --version', { stdio: 'ignore' })
  pythonAvailable = true
} catch { /* Python not installed — tests below skip, not fail */ }

const PERL_BRIDGE = path.join(__dirname, '../../scripts/perl_bridge.py')

const tmpFiles: string[] = []
async function writeTmp(name: string, content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `devbrain-perl-bridge-test-${Date.now()}-${name}`)
  await fs.writeFile(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}

afterAll(async () => {
  await Promise.allSettled(tmpFiles.map(f => fs.unlink(f)))
})

interface RawResult {
  nodes: { entity_type: string; name: string }[]
  edges: { table: string; relationship_type: string }[]
  unresolved_refs: { raw_target_name: string; kind: string }[]
}

function run(filePath: string): RawResult {
  const stdout = execFileSync('python', [PERL_BRIDGE, filePath], { encoding: 'utf-8' })
  return JSON.parse(stdout)
}

describe.skipIf(!pythonAvailable)('perl_bridge.py', () => {
  it('extracts a sub, a use import, and an embedded SQL string calling a procedure', async () => {
    const file = await writeTmp('billing.pl', [
      'use strict;',
      'use DBI;',
      '',
      'sub apply_fee {',
      '    my ($acct_id, $fee) = @_;',
      '    $dbh->do("EXEC mark_delinquent(?)", undef, $acct_id);',
      '}',
      '',
      '1;',
    ].join('\n'))

    const result = run(file)

    expect(result.nodes).toEqual([
      expect.objectContaining({ entity_type: 'subroutine', name: 'apply_fee' }),
    ])
    expect(result.unresolved_refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ raw_target_name: 'DBI', kind: 'import' }),
      expect.objectContaining({ raw_target_name: 'mark_delinquent', kind: 'sql_exec' }),
    ]))
  })

  it('extracts a plain embedded SELECT as a READS_TABLE edge, not a sql_exec ref', async () => {
    const file = await writeTmp('reader.pl', [
      'use strict;',
      '',
      'sub get_balance {',
      '    my ($acct_id) = @_;',
      '    my $sth = $dbh->prepare("SELECT balance FROM accounts WHERE id = ?");',
      '    $sth->execute($acct_id);',
      '}',
    ].join('\n'))

    const result = run(file)
    expect(result.edges).toEqual([
      expect.objectContaining({ table: 'accounts', relationship_type: 'READS_TABLE' }),
    ])
  })
})

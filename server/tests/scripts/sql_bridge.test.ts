import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Real subprocess tests of sql_bridge.py itself — not the Node-side wrapper
// (pythonBridgeParser.test.ts mocks child_process entirely for that; this
// file deliberately does the opposite, exercising the actual Python/sqlglot
// logic). Skips gracefully (not fails) when Python/sqlglot aren't installed
// — same "optional local Python dependency" contract markitdown_bridge.py-
// dependent behavior is already treated with elsewhere in this codebase,
// just made explicit here via a real availability check instead of a mock.
let pythonAvailable = false
try {
  execSync('python -c "import sqlglot"', { stdio: 'ignore' })
  pythonAvailable = true
} catch { /* Python or sqlglot not installed — tests below skip, not fail */ }

const SQL_BRIDGE = path.join(__dirname, '../../scripts/sql_bridge.py')

const tmpFiles: string[] = []
async function writeTmp(name: string, content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `devbrain-sql-bridge-test-${Date.now()}-${name}`)
  await fs.writeFile(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}

afterAll(async () => {
  await Promise.allSettled(tmpFiles.map(f => fs.unlink(f)))
})

function run(filePath: string, dialect: 'postgres' | 'oracle'): { nodes: unknown[]; edges: { table: string; relationship_type: string }[] } {
  const stdout = execFileSync('python', [SQL_BRIDGE, filePath, '--dialect', dialect], { encoding: 'utf-8' })
  return JSON.parse(stdout)
}

describe.skipIf(!pythonAvailable)('sql_bridge.py — Postgres', () => {
  it('extracts a plain SELECT and INSERT as table edges', async () => {
    const file = await writeTmp('plain.sql', [
      'SELECT id, name FROM users WHERE active = true;',
      "INSERT INTO audit_log (acct_id, amt) VALUES (1, 100);",
    ].join('\n'))

    const result = run(file, 'postgres')
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'users', relationship_type: 'READS_TABLE' }),
      expect.objectContaining({ table: 'audit_log', relationship_type: 'WRITES_TABLE' }),
    ]))
  })
})

describe.skipIf(!pythonAvailable)('sql_bridge.py — Oracle', () => {
  it('extracts a CREATE OR REPLACE PROCEDURE as a node with its table reads/writes', async () => {
    const file = await writeTmp('proc.sql', [
      'CREATE OR REPLACE PROCEDURE apply_fee(p_id IN NUMBER, p_fee IN NUMBER) IS',
      'BEGIN',
      '  UPDATE accounts SET balance = balance + p_fee WHERE id = p_id;',
      'END apply_fee;',
      '/',
    ].join('\n'))

    const result = run(file, 'oracle')
    expect(result.nodes).toEqual([
      expect.objectContaining({ entity_type: 'procedure', name: 'apply_fee' }),
    ])
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'accounts', relationship_type: 'WRITES_TABLE' }),
    ]))
  })
})

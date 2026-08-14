import { describe, it, expect } from 'vitest'
import { extractEntitiesForLanguage, treeSitterParser } from '../../../services/codeIntel/parsers/treeSitterParser.js'

const PROJECT_ID = 'proj-1'

describe('treeSitterParser — Python', () => {
  it('extracts a top-level function with a call inside it', async () => {
    const source = [
      'import os',
      '',
      'def helper():',
      '    return 1',
      '',
      'def main():',
      '    helper()',
      '    return os.getcwd()',
    ].join('\n')

    const result = await extractEntitiesForLanguage('billing/app.py', PROJECT_ID, source, 'python')

    const names = result.nodes.map(n => n.name)
    expect(names).toEqual(expect.arrayContaining(['app.py', 'helper', 'main']))

    const mainNode = result.nodes.find(n => n.name === 'main')!
    expect(mainNode.entityType).toBe('function')
    expect(mainNode.language).toBe('python')
    expect(mainNode.signature).toContain('def main')

    const callFromMain = result.unresolvedRefs.filter(r => r.fromEntityId === mainNode.id && r.kind === 'call')
    expect(callFromMain.some(r => r.rawTargetName === 'helper')).toBe(true)

    const fileNode = result.nodes.find(n => n.entityType === 'script')!
    const topLevelImport = result.unresolvedRefs.find(r => r.kind === 'import' && r.fromEntityId === fileNode.id)
    expect(topLevelImport?.rawTargetName).toBe('os')
  })

  it('extracts a class and its methods as separate nodes', async () => {
    const source = [
      'class Billing:',
      '    def charge(self, amount):',
      '        return amount',
    ].join('\n')

    const result = await extractEntitiesForLanguage('billing/models.py', PROJECT_ID, source, 'python')
    const billing = result.nodes.find(n => n.name === 'Billing')
    const charge  = result.nodes.find(n => n.name === 'charge')

    expect(billing?.entityType).toBe('class')
    expect(charge?.entityType).toBe('function')
  })

  it('captures a Python docstring', async () => {
    const source = [
      'def total(items):',
      '    """Sums up item prices."""',
      '    return sum(items)',
    ].join('\n')

    const result = await extractEntitiesForLanguage('billing/util.py', PROJECT_ID, source, 'python')
    const total = result.nodes.find(n => n.name === 'total')
    expect(total?.docstring).toContain('Sums up item prices')
  })
})

describe('treeSitterParser — TypeScript/JavaScript', () => {
  it('extracts an exported function and an import', async () => {
    const source = [
      "import { pool } from '../db/pool.js'",
      '',
      'export function loadUser(id: string) {',
      '  return pool.query(id)',
      '}',
    ].join('\n')

    const result = await extractEntitiesForLanguage('server/services/users.ts', PROJECT_ID, source, 'typescript')
    const fn = result.nodes.find(n => n.name === 'loadUser')
    expect(fn?.entityType).toBe('function')

    const importRef = result.unresolvedRefs.find(r => r.kind === 'import')
    expect(importRef?.rawTargetName).toBe('../db/pool.js')

    const callRef = result.unresolvedRefs.find(r => r.kind === 'call' && r.fromEntityId === fn?.id)
    expect(callRef?.rawTargetName).toBe('query')
  })
})

describe('treeSitterParser — Bash', () => {
  it('extracts a function and command invocations inside it', async () => {
    const source = [
      'run_backup() {',
      '  echo "starting"',
      '  pg_dump devbrain > backup.sql',
      '}',
    ].join('\n')

    const result = await extractEntitiesForLanguage('scripts/backup.sh', PROJECT_ID, source, 'bash')
    const fn = result.nodes.find(n => n.name === 'run_backup')
    expect(fn?.entityType).toBe('function')

    const calls = result.unresolvedRefs.filter(r => r.fromEntityId === fn?.id).map(r => r.rawTargetName)
    expect(calls).toEqual(expect.arrayContaining(['echo', 'pg_dump']))
  })
})

describe('treeSitterParser — unsupported / degenerate inputs', () => {
  it('returns empty result for a language with no config (e.g. dart)', async () => {
    const result = await extractEntitiesForLanguage('lib/main.dart', PROJECT_ID, 'void main() {}', 'dart')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
  })

  it('returns empty result for source with a syntax error', async () => {
    const broken = 'def foo( : : : not python at all @#$%'
    const result = await extractEntitiesForLanguage('bad.py', PROJECT_ID, broken, 'python')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
  })

  it('the BaseParser wrapper infers language from the file extension', async () => {
    const source = 'def main():\n    pass'
    const result = await treeSitterParser.extractEntities('foo/bar.py', PROJECT_ID, source)
    expect(result.nodes.some(n => n.name === 'main')).toBe(true)
  })

  it('the BaseParser wrapper returns empty for an unrecognized extension', async () => {
    const result = await treeSitterParser.extractEntities('README.md', PROJECT_ID, '# hi')
    expect(result).toEqual({ nodes: [], edges: [], unresolvedRefs: [] })
  })
})

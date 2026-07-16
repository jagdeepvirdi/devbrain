import { describe, it, expect } from 'vitest'
import { chunkCodeByAst, AST_CHUNKABLE_LANGUAGES } from '../../services/codeChunker.js'

describe('chunkCodeByAst — unsupported / degenerate inputs', () => {
  it('returns null for a language with no grammar available', async () => {
    const result = await chunkCodeByAst('print "hi\\n";', 'perl')
    expect(result).toBeNull()
  })

  it('returns null when language is not provided', async () => {
    const result = await chunkCodeByAst('some text', null)
    expect(result).toBeNull()
  })

  it('returns null for source with a syntax error (falls back to generic chunker)', async () => {
    const broken = 'function foo( { { { not valid typescript at all @#$%'
    const result = await chunkCodeByAst(broken, 'typescript')
    expect(result).toBeNull()
  })

  it('lists at least the core languages as AST-chunkable', () => {
    expect(AST_CHUNKABLE_LANGUAGES).toEqual(expect.arrayContaining(['typescript', 'javascript', 'python', 'dart', 'go', 'rust']))
  })
})

describe('chunkCodeByAst — TypeScript', () => {
  it('splits two top-level functions into separate chunks', async () => {
    const source = [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export function subtract(a: number, b: number): number {',
      '  return a - b',
      '}',
    ].join('\n')

    const chunks = await chunkCodeByAst(source, 'typescript')
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThanOrEqual(2)
    expect(chunks!.some(c => c.includes('function add'))).toBe(true)
    expect(chunks!.some(c => c.includes('function subtract'))).toBe(true)
    // Each declaration should land whole, not split mid-function.
    const addChunk = chunks!.find(c => c.includes('function add'))!
    expect(addChunk).toContain('return a + b')
  })

  it('keeps a small class with two methods intact when it fits the token budget', async () => {
    const source = [
      'class Greeter {',
      '  greet(name: string): string {',
      '    return `Hello, ${name}!`',
      '  }',
      '',
      '  farewell(name: string): string {',
      '    return `Bye, ${name}!`',
      '  }',
      '}',
    ].join('\n')

    const chunks = await chunkCodeByAst(source, 'typescript')
    expect(chunks).not.toBeNull()
    // Small enough to be one chunk containing both methods.
    expect(chunks!.some(c => c.includes('greet') && c.includes('farewell'))).toBe(true)
  })
})

describe('chunkCodeByAst — Python', () => {
  it('splits a class into method-level chunks when a fixed-size preamble pads it past budget', async () => {
    const filler = '# padding line to grow the class body\n'.repeat(400)
    const source = [
      'class Calculator:',
      filler,
      '    def add(self, a, b):',
      '        return a + b',
      '',
      '    def subtract(self, a, b):',
      '        return a - b',
    ].join('\n')

    const chunks = await chunkCodeByAst(source, 'python')
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(1)
  })

  it('handles a simple function', async () => {
    const source = 'def greet(name):\n    return f"Hello, {name}!"\n'
    const chunks = await chunkCodeByAst(source, 'python')
    expect(chunks).not.toBeNull()
    expect(chunks!.some(c => c.includes('def greet'))).toBe(true)
  })
})

describe('chunkCodeByAst — Dart (PlayCru/Music Player relevance)', () => {
  it('splits a Dart class with multiple methods', async () => {
    const source = [
      'class Player {',
      '  void play() {',
      '    print("playing");',
      '  }',
      '',
      '  void pause() {',
      '    print("paused");',
      '  }',
      '}',
    ].join('\n')

    const chunks = await chunkCodeByAst(source, 'dart')
    expect(chunks).not.toBeNull()
    expect(chunks!.some(c => c.includes('play'))).toBe(true)
  })
})

describe('chunkCodeByAst — Go and Rust', () => {
  it('handles a Go function', async () => {
    const source = 'package main\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n'
    const chunks = await chunkCodeByAst(source, 'go')
    expect(chunks).not.toBeNull()
    expect(chunks!.some(c => c.includes('func Add'))).toBe(true)
  })

  it('handles a Rust function', async () => {
    const source = 'fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n'
    const chunks = await chunkCodeByAst(source, 'rust')
    expect(chunks).not.toBeNull()
    expect(chunks!.some(c => c.includes('fn add'))).toBe(true)
  })
})

describe('chunkCodeByAst — oversized single declaration', () => {
  it('falls back to token-window splitting inside one enormous function', async () => {
    const bigBody = Array.from({ length: 2000 }, (_, i) => `  const x${i} = ${i};`).join('\n')
    const source = `function huge() {\n${bigBody}\n  return 0\n}\n`

    const chunks = await chunkCodeByAst(source, 'javascript')
    expect(chunks).not.toBeNull()
    expect(chunks!.length).toBeGreaterThan(1)
  })
})

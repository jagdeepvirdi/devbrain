import { describe, it, expect } from 'vitest'
import { chunkCodeByAst, extractSymbolOutline, AST_CHUNKABLE_LANGUAGES } from '../../services/codeChunker.js'

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

describe('extractSymbolOutline — unsupported / degenerate inputs', () => {
  it('returns null for a language with no grammar available', async () => {
    const result = await extractSymbolOutline('sub greet { print "hi" }', 'perl')
    expect(result).toBeNull()
  })

  it('returns null when language is not provided', async () => {
    const result = await extractSymbolOutline('some text', null)
    expect(result).toBeNull()
  })

  it('returns null for source with a syntax error', async () => {
    const result = await extractSymbolOutline('function foo( { { { @#$%', 'typescript')
    expect(result).toBeNull()
  })
})

describe('extractSymbolOutline — real files', () => {
  it('produces one signature line per top-level TypeScript function, not the full body', async () => {
    const source = [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export function subtract(a: number, b: number): number {',
      '  return a - b',
      '}',
    ].join('\n')

    const outline = await extractSymbolOutline(source, 'typescript')
    expect(outline).not.toBeNull()
    expect(outline!.some(l => l.includes('function add'))).toBe(true)
    expect(outline!.some(l => l.includes('function subtract'))).toBe(true)
    // Signature lines only — the body ("return a + b") should not appear.
    expect(outline!.some(l => l.includes('return a'))).toBe(false)
  })

  it('collects nested method signatures inside a class', async () => {
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

    const outline = await extractSymbolOutline(source, 'typescript')
    expect(outline).not.toBeNull()
    expect(outline!.some(l => l.includes('class Greeter'))).toBe(true)
    expect(outline!.some(l => l.includes('greet(name'))).toBe(true)
    expect(outline!.some(l => l.includes('farewell(name'))).toBe(true)
  })

  it('caps output at the given limit for a file with many declarations', async () => {
    const source = Array.from({ length: 60 }, (_, i) => `function fn${i}() {\n  return ${i}\n}`).join('\n\n')
    const outline = await extractSymbolOutline(source, 'javascript', 10)
    expect(outline).not.toBeNull()
    expect(outline!.length).toBeLessThanOrEqual(10)
  })

  it('truncates an absurdly long single-line signature', async () => {
    const longParams = Array.from({ length: 100 }, (_, i) => `p${i}: number`).join(', ')
    const source = `function huge(${longParams}) {\n  return 0\n}`
    const outline = await extractSymbolOutline(source, 'typescript')
    expect(outline).not.toBeNull()
    const line = outline!.find(l => l.includes('function huge'))!
    expect(line.length).toBeLessThanOrEqual(161) // 160 chars + ellipsis
    expect(line.endsWith('…')).toBe(true)
  })
})

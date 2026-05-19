import { describe, it, expect, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseFile } from '../../services/parser.js'

// ── Temp file helpers ─────────────────────────────────────────────────────────

const tmpFiles: string[] = []

async function writeTmp(name: string, content: string): Promise<string> {
  const p = path.join(os.tmpdir(), `devbrain-test-${Date.now()}-${name}`)
  await fs.writeFile(p, content, 'utf-8')
  tmpFiles.push(p)
  return p
}

afterAll(async () => {
  await Promise.allSettled(tmpFiles.map(f => fs.unlink(f)))
})

// ── Markdown ──────────────────────────────────────────────────────────────────

describe('parseFile — .md', () => {
  it('returns fileType md and the raw markdown text', async () => {
    const content = '# Hello\n\nThis is a **markdown** file.'
    const p       = await writeTmp('test.md', content)

    const result = await parseFile(p, 'my-notes.md')

    expect(result.fileType).toBe('md')
    expect(result.title).toBe('my-notes')
    expect(result.text).toBe(content.trim())
  })

  it('trims leading and trailing whitespace from the text', async () => {
    const p      = await writeTmp('padded.md', '\n\n  content  \n\n')
    const result = await parseFile(p, 'padded.md')
    expect(result.text).toBe('content')
  })
})

// ── Plain text ────────────────────────────────────────────────────────────────

describe('parseFile — .txt', () => {
  it('returns fileType txt with raw text content', async () => {
    const content = 'Line one\nLine two\nLine three'
    const p       = await writeTmp('notes.txt', content)

    const result = await parseFile(p, 'notes.txt')

    expect(result.fileType).toBe('txt')
    expect(result.title).toBe('notes')
    expect(result.text).toBe(content)
  })
})

// ── Unsupported extension ─────────────────────────────────────────────────────

describe('parseFile — unsupported type', () => {
  it('throws an error for unsupported extensions', async () => {
    const p = await writeTmp('data.csv', 'a,b,c')

    await expect(parseFile(p, 'data.csv')).rejects.toThrow(/Unsupported file type/)
  })
})

// ── Title extraction ──────────────────────────────────────────────────────────

describe('parseFile — title extraction', () => {
  it('strips the extension to form the title', async () => {
    const p = await writeTmp('release-notes.md', '# v1.2')
    const { title } = await parseFile(p, 'release-notes.md')
    expect(title).toBe('release-notes')
  })

  it('handles names with multiple dots', async () => {
    const p = await writeTmp('v1.2.3.txt', 'content')
    const { title } = await parseFile(p, 'v1.2.3.txt')
    expect(title).toBe('v1.2.3')
  })
})

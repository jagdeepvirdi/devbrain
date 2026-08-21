import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs     from 'fs/promises'
import os     from 'os'
import path   from 'path'
import crypto from 'crypto'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocumentsBatch: vi.fn(),
}))

import { pool } from '../../db/pool.js'
import { embedDocumentsBatch } from '../../services/embedder.js'
import { syncProjectCode, syncProjectDocs } from '../../services/codeSync.js'

const mockQuery = vi.mocked(pool.query)
const mockEmbed = vi.mocked(embedDocumentsBatch)

let nextId = 1
function freshId(): string { return `doc-${nextId++}` }

// Minimal stand-in for the pool: answers the "existing docs" SELECT with
// whatever rows the test supplies, and hands out a fresh id for every INSERT.
// UPDATE/embedding-status queries are accepted unconditionally — the tests
// assert on their SQL/params directly where it matters.
function makeQueryMock(existingRows: any[] = []) {
  return vi.fn(async (sql: string) => {
    if (sql.includes('SELECT id, source, content_hash')) return { rows: existingRows }
    if (sql.trim().startsWith('INSERT INTO documents')) return { rows: [{ id: freshId() }] }
    return { rows: [] }
  })
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex')
}

let tmpDir: string

beforeEach(async () => {
  vi.clearAllMocks()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codesync-'))
  mockEmbed.mockImplementation(async (docs: any[]) => docs.map(d => ({ id: d.id, chunkCount: 1 })))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('syncProjectCode', () => {
  it('imports code files and ignores non-code extensions', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1')
    await fs.writeFile(path.join(tmpDir, 'b.txt'), 'not code')
    mockQuery.mockImplementation(makeQueryMock([]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.scanned).toBe(1)
    expect(result.created).toBe(1)
    expect(result.updated).toBe(0)
    expect(mockEmbed).toHaveBeenCalledTimes(1)
    expect(mockEmbed.mock.calls[0][2]).toEqual({ skipSummary: true })
  })

  it('skips SKIP_DIRS and dot-directories', async () => {
    await fs.mkdir(path.join(tmpDir, 'node_modules'))
    await fs.writeFile(path.join(tmpDir, 'node_modules', 'noise.ts'), 'noise')
    await fs.mkdir(path.join(tmpDir, '.git'))
    await fs.writeFile(path.join(tmpDir, '.git', 'noise2.ts'), 'noise')
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1')
    mockQuery.mockImplementation(makeQueryMock([]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.scanned).toBe(1)
  })

  it('respects the project root .gitignore', async () => {
    await fs.writeFile(path.join(tmpDir, '.gitignore'), 'ignored/\n')
    await fs.mkdir(path.join(tmpDir, 'ignored'))
    await fs.writeFile(path.join(tmpDir, 'ignored', 'z.ts'), 'noise')
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1')
    mockQuery.mockImplementation(makeQueryMock([]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.scanned).toBe(1)
  })

  it('skips files over the max size instead of importing them', async () => {
    await fs.writeFile(path.join(tmpDir, 'big.ts'), 'x'.repeat(1024 * 1024 + 10))
    mockQuery.mockImplementation(makeQueryMock([]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.scanned).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('skips an unchanged file whose embedding already finished', async () => {
    const content = 'export const a = 1'
    await fs.writeFile(path.join(tmpDir, 'a.ts'), content)
    mockQuery.mockImplementation(makeQueryMock([
      { id: 'existing-1', source: 'a.ts', content_hash: sha256(content), embedding_status: 'done' },
    ]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.skipped).toBe(1)
    expect(result.created).toBe(0)
    expect(result.updated).toBe(0)
    expect(mockEmbed).not.toHaveBeenCalled()
  })

  it('re-syncs a file with a matching hash whose embedding never finished', async () => {
    const content = 'export const a = 1'
    await fs.writeFile(path.join(tmpDir, 'a.ts'), content)
    mockQuery.mockImplementation(makeQueryMock([
      { id: 'existing-1', source: 'a.ts', content_hash: sha256(content), embedding_status: 'processing' },
    ]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.updated).toBe(1)
    expect(mockEmbed).toHaveBeenCalledTimes(1)
  })

  it('updates a file whose content hash changed since the last sync', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 2')
    mockQuery.mockImplementation(makeQueryMock([
      { id: 'existing-1', source: 'a.ts', content_hash: 'stale-hash', embedding_status: 'done' },
    ]))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.updated).toBe(1)
    expect(result.created).toBe(0)
  })

  it('counts a doc as failed (not created) when its embedding errors, and flips its status to failed', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1')
    mockQuery.mockImplementation(makeQueryMock([]))
    mockEmbed.mockImplementation(async (docs: any[]) => docs.map(d => ({ id: d.id, chunkCount: 0, error: 'embed failed' })))

    const result = await syncProjectCode('proj1', tmpDir)

    expect(result.failed).toBe(1)
    expect(result.created).toBe(0)
    expect(result.errors).toEqual([{ path: 'a.ts', message: 'embed failed' }])

    const failedCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes("embedding_status = 'failed'"))
    expect(failedCall).toBeTruthy()
    const doneCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes("embedding_status = 'done'"))
    expect(doneCall![1]).toEqual([[]])
  })

  it('records a per-file error and continues when a file fails to read', async () => {
    await fs.writeFile(path.join(tmpDir, 'a.ts'), 'export const a = 1')
    await fs.writeFile(path.join(tmpDir, 'b.ts'), 'export const b = 1')
    mockQuery.mockImplementation(makeQueryMock([]))

    // Delete b.ts after the walk sees it but before it's read, to force a
    // real fs.stat failure inside the per-file try/catch.
    const originalReaddir = fs.readdir
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(async (...args: any[]) => {
      const entries = await (originalReaddir as any)(...args)
      if (args[0] === tmpDir) await fs.rm(path.join(tmpDir, 'b.ts'))
      return entries
    })

    const result = await syncProjectCode('proj1', tmpDir)
    readdirSpy.mockRestore()

    expect(result.scanned).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.created).toBe(1)
    expect(result.errors[0].path).toBe('b.ts')
  })
})

describe('syncProjectDocs', () => {
  it('imports markdown files but excludes TASKS.md and sessions/', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# hi')
    await fs.writeFile(path.join(tmpDir, 'TASKS.md'), '# tasks')
    await fs.mkdir(path.join(tmpDir, 'sessions'))
    await fs.writeFile(path.join(tmpDir, 'sessions', 'log.md'), '# session log')
    mockQuery.mockImplementation(makeQueryMock([]))

    const result = await syncProjectDocs('proj1', tmpDir)

    expect(result.scanned).toBe(1)
    expect(result.created).toBe(1)
  })

  it('tags synced docs git-sync (not code)', async () => {
    await fs.writeFile(path.join(tmpDir, 'README.md'), '# hi')
    mockQuery.mockImplementation(makeQueryMock([]))

    await syncProjectDocs('proj1', tmpDir)

    const insertCall = mockQuery.mock.calls.find(c => typeof c[0] === 'string' && c[0].startsWith('INSERT INTO documents'))
    expect(insertCall![1]).toEqual(
      expect.arrayContaining([expect.arrayContaining(['git-sync'])])
    )
    const tagsParam = (insertCall![1] as any[])[4]
    expect(tagsParam).toEqual(['git-sync'])
  })
})

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const envMock = vi.hoisted(() => ({ AI_PROVIDER: 'ollama' as string }))
vi.mock('../../lib/env.js', () => ({ env: envMock }))
vi.mock('../../services/ai.js', () => ({ aiChat: vi.fn() }))

import {
  weekBounds, chunk, parseSummary, summarizeCommits, collectCommits, collectStats,
  collectBranches, buildProjectDigest, CHUNK_SIZE, type Commit,
} from '../../services/gitDigest.js'
import { aiChat } from '../../services/ai.js'

const mockAi = vi.mocked(aiChat)
const GOOD = JSON.stringify({ highlights: ['h'], features: ['f'], fixes: ['x'], risks: [], summary: 's' })

beforeEach(() => { vi.resetAllMocks(); envMock.AI_PROVIDER = 'ollama' })

const commit = (n: number): Commit => ({ sha: `s${n}`, date: '2026-11-10T00:00:00Z', author: 'a', subject: `c${n}` })

describe('weekBounds', () => {
  it('normalizes any day to Monday..next Monday', () => {
    expect(weekBounds('2026-11-13')).toEqual({ start: '2026-11-09', end: '2026-11-16' }) // Fri
    expect(weekBounds('2026-11-09')).toEqual({ start: '2026-11-09', end: '2026-11-16' }) // Mon
    expect(weekBounds('2026-11-15')).toEqual({ start: '2026-11-09', end: '2026-11-16' }) // Sun
  })
  it('rejects malformed or impossible dates', () => {
    expect(() => weekBounds('13-11-2026')).toThrow('week must be')
    expect(() => weekBounds('2026-13-45')).toThrow('week must be')
  })
})

describe('chunk', () => {
  it('splits into CHUNK_SIZE groups', () => {
    const parts = chunk(Array.from({ length: CHUNK_SIZE * 2 + 1 }, (_, i) => i))
    expect(parts.map(p => p.length)).toEqual([CHUNK_SIZE, CHUNK_SIZE, 1])
  })
})

describe('parseSummary', () => {
  it('extracts JSON from markdown fences and coerces bad fields', () => {
    const s = parseSummary('```json\n{"highlights":["a",3],"features":"nope","summary":5}\n```')
    expect(s).toEqual({ highlights: ['a'], features: [], fixes: [], risks: [], summary: '' })
  })
  it('throws when there is no JSON object', () => {
    expect(() => parseSummary('nothing')).toThrow('no JSON')
  })
})

describe('summarizeCommits', () => {
  it('short-circuits with no model call when there are no commits', async () => {
    expect((await summarizeCommits([])).summary).toBe('No commits this week.')
    expect(mockAi).not.toHaveBeenCalled()
  })

  it('uses a single model call for one chunk', async () => {
    mockAi.mockResolvedValueOnce(GOOD)
    await summarizeCommits([commit(1)])
    expect(mockAi).toHaveBeenCalledTimes(1)
  })

  it('map-reduces: one call per chunk plus one merge call', async () => {
    mockAi.mockResolvedValue(GOOD)
    await summarizeCommits(Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => commit(i)))
    expect(mockAi).toHaveBeenCalledTimes(3)
  })

  it('retries once on malformed JSON, then succeeds', async () => {
    mockAi.mockResolvedValueOnce('garbage').mockResolvedValueOnce(GOOD)
    const s = await summarizeCommits([commit(1)])
    expect(mockAi).toHaveBeenCalledTimes(2)
    expect(s.summary).toBe('s')
  })

  it('propagates when a chunk fails twice', async () => {
    mockAi.mockResolvedValue('garbage')
    await expect(summarizeCommits([commit(1)])).rejects.toThrow('no JSON')
  })

  it('falls back to a mechanical union when the merge step fails', async () => {
    mockAi
      .mockResolvedValueOnce(GOOD).mockResolvedValueOnce(GOOD)   // 2 chunks
      .mockResolvedValue('garbage')                              // merge x2
    const s = await summarizeCommits(Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => commit(i)))
    expect(s.highlights).toEqual(['h'])   // deduped across chunks
  })
})

// ── Real git fixture ─────────────────────────────────────────────────────────

function mkRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gitdigest-'))
  const run = (args: string[], date?: string) => execFileSync('git', args, {
    cwd: dir, stdio: 'pipe',
    env: {
      ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
    } as NodeJS.ProcessEnv,
  })
  run(['init', '-q', '-b', 'main'])
  const commitFile = (name: string, body: string, msg: string, date: string) => {
    writeFileSync(path.join(dir, name), body)
    run(['add', '.'])
    run(['commit', '-q', '-m', msg], date)
  }
  // Chronological order matters: git log --since stops walking at the first commit older
  // than the cutoff, so an out-of-order fixture would silently hide the in-week commits.
  commitFile('c.txt', 'old\n', 'chore: previous week', '2026-11-02T12:00:00Z')
  commitFile('a.txt', 'one\ntwo\n', 'feat: in week', '2026-11-10T12:00:00Z')
  commitFile('b.txt', 'x\n', 'fix: also in week', '2026-11-12T12:00:00Z')
  return dir
}

const repo = mkRepo()
afterAll(() => rmSync(repo, { recursive: true, force: true }))

describe('git collection (temp repo)', () => {
  it('collects only commits inside the week window', async () => {
    const commits = await collectCommits(repo, '2026-11-09', '2026-11-16')
    expect(commits.map(c => c.subject).sort()).toEqual(['feat: in week', 'fix: also in week'])
  })

  it('sums shortstat for the window', async () => {
    const s = await collectStats(repo, '2026-11-09', '2026-11-16')
    expect(s).toEqual({ files_changed: 2, insertions: 3, deletions: 0 })
  })

  it('lists branches touched since the week start', async () => {
    expect(await collectBranches(repo, '2026-11-09')).toEqual(['main'])
  })

  it('fails (rather than running anything) for a nonexistent repo path', async () => {
    await expect(collectCommits('--upload-pack=evil', '2026-11-09', '2026-11-16')).rejects.toThrow()
  })

  it('buildProjectDigest assembles the digest', async () => {
    mockAi.mockResolvedValueOnce(GOOD)
    const d = await buildProjectDigest(repo, '2026-11-13')
    expect(d).toMatchObject({ week_start: '2026-11-09', week_end: '2026-11-16', commit_count: 2 })
    expect(d.summary.summary).toBe('s')
  })

  it('buildProjectDigest refuses cloud AI providers before touching git or the model', async () => {
    envMock.AI_PROVIDER = 'claude'
    await expect(buildProjectDigest(repo, '2026-11-13')).rejects.toThrow('AI_PROVIDER=ollama')
    expect(mockAi).not.toHaveBeenCalled()
  })
})

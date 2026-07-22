import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os   from 'node:os'
import path from 'node:path'
import type { Response } from 'express'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

class FakeWatcher extends EventEmitter {
  close = vi.fn().mockResolvedValue(undefined)
}

const mockWatch = vi.fn()
vi.mock('chokidar', () => ({
  default: { watch: (...args: unknown[]) => mockWatch(...args) },
}))

const { readTaskTree, subscribe, refreshProjectWatch, initTasksWatcher } = await import('../../services/tasks-watcher.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

async function write(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf-8')
}

function fakeRes() {
  return { write: vi.fn() } as unknown as Response & { write: ReturnType<typeof vi.fn> }
}

describe('readTaskTree', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-tasks-watcher-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns an empty tree when TASKS.md does not exist', async () => {
    const tree = await readTaskTree('p1', root)
    expect(tree).toEqual({ projectId: 'p1', lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 })
  })

  it('parses frontmatter, phases, all four item statuses, and a done-date stamp', async () => {
    await write(root, 'TASKS.md', [
      '---',
      'last_updated: 2026-01-01T10:00:00Z',
      '---',
      '## Phase 1',
      '- [x] done item <!-- done: 2026-01-01 -->',
      '- [ ] todo item',
      '- [~] in progress item',
      '- [!] blocked item',
      '## Phase 2',
      '- [x] another done',
    ].join('\n'))

    const tree = await readTaskTree('p1', root)

    expect(tree.projectId).toBe('p1')
    // Same YAML-Date normalization as claude-discovery.ts / session-reader.ts (see lib/frontmatter.ts)
    expect(tree.lastUpdated).toBe('2026-01-01T10:00:00.000Z')
    expect(tree.phases).toHaveLength(2)
    expect(tree.phases[0]).toEqual({
      name: 'Phase 1', total: 4, done: 1, pct: 25,
      items: [
        { text: 'done item', status: 'done', doneDate: '2026-01-01' },
        { text: 'todo item', status: 'todo' },
        { text: 'in progress item', status: 'in_progress' },
        { text: 'blocked item', status: 'blocked' },
      ],
    })
    expect(tree.phases[1]).toEqual({ name: 'Phase 2', total: 1, done: 1, pct: 100, items: [{ text: 'another done', status: 'done' }] })
    expect(tree.totalDone).toBe(2)
    expect(tree.totalItems).toBe(5)
    expect(tree.overallPct).toBe(40)
  })

  it('leaves lastUpdated null when frontmatter has no last_updated field', async () => {
    await write(root, 'TASKS.md', '---\n---\n## P\n- [x] a')
    const tree = await readTaskTree('p1', root)
    expect(tree.lastUpdated).toBeNull()
  })

  it('falls back to a partial result when frontmatter is malformed', async () => {
    await write(root, 'TASKS.md', '---\nlast_updated: [oops\n---\n## P\n- [x] a')
    const tree = await readTaskTree('p1', root)
    expect(tree.lastUpdated).toBeNull()
    expect(tree.phases).toEqual([])
    expect(tree.overallPct).toBe(0)
  })

  it('gives a phase with no items a 0% pct instead of dividing by zero', async () => {
    await write(root, 'TASKS.md', '---\n---\n## Empty Phase\n## Phase With Items\n- [x] a')
    const tree = await readTaskTree('p1', root)
    expect(tree.phases[0]).toEqual({ name: 'Empty Phase', total: 0, done: 0, pct: 0, items: [] })
  })

  it('ignores a checklist-shaped line that appears before any phase heading', async () => {
    await write(root, 'TASKS.md', '---\n---\n- [x] orphaned item, no ## heading yet\n## Phase 1\n- [x] a')
    const tree = await readTaskTree('p1', root)
    expect(tree.phases).toEqual([{ name: 'Phase 1', total: 1, done: 1, pct: 100, items: [{ text: 'a', status: 'done' }] }])
  })

  it('returns no phases when the body has no "## " headings at all', async () => {
    await write(root, 'TASKS.md', '---\nlast_updated: 2026-01-01T00:00:00Z\n---\njust some prose, no headings')
    const tree = await readTaskTree('p1', root)
    expect(tree.phases).toEqual([])
    expect(tree.overallPct).toBe(0)
  })
})

describe('watcher lifecycle: subscribe, broadcast, refreshProjectWatch', () => {
  let root: string

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-tasks-watcher-live-'))
    await write(root, 'TASKS.md', '---\n---\n## P\n- [x] a')
  })

  afterEach(async () => {
    vi.useRealTimers()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('starts a chokidar watcher on TASKS.md, and broadcasts a debounced update to subscribers on change', async () => {
    const watcher = new FakeWatcher()
    mockWatch.mockReturnValue(watcher)

    await refreshProjectWatch('p1', root)

    expect(mockWatch).toHaveBeenCalledWith(
      path.join(root, 'TASKS.md'),
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    )

    const res = fakeRes()
    subscribe('p1', res)

    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(299)
    expect(res.write).not.toHaveBeenCalled()

    // The debounce fires here (fake timer), but its callback awaits real
    // fs.readFile — fake timers don't control that, so bridge to real timers
    // and poll for the broadcast to actually land.
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledTimes(1))

    const payload = res.write.mock.calls[0][0] as string
    expect(payload.startsWith('data: ')).toBe(true)
    expect(JSON.parse(payload.slice(6))).toMatchObject({ projectId: 'p1' })
  })

  it('coalesces rapid changes into a single broadcast (debounce restarts the timer)', async () => {
    const watcher = new FakeWatcher()
    mockWatch.mockReturnValue(watcher)
    await refreshProjectWatch('p2', root)
    const res = fakeRes()
    subscribe('p2', res)

    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(200)
    watcher.emit('change') // restarts the 300ms window
    await vi.advanceTimersByTimeAsync(200)
    expect(res.write).not.toHaveBeenCalled() // only 200ms since the 2nd change

    await vi.advanceTimersByTimeAsync(100)
    vi.useRealTimers()
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledTimes(1))
  })

  it('does not broadcast to a subscriber after it has unsubscribed', async () => {
    const watcher = new FakeWatcher()
    mockWatch.mockReturnValue(watcher)
    await refreshProjectWatch('p3', root)
    const res = fakeRes()
    const unsubscribe = subscribe('p3', res)
    unsubscribe()

    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(300)

    expect(res.write).not.toHaveBeenCalled()
  })

  it('removes a subscriber whose write() throws, without affecting other subscribers', async () => {
    const watcher = new FakeWatcher()
    mockWatch.mockReturnValue(watcher)
    await refreshProjectWatch('p4', root)

    const bad = fakeRes()
    bad.write.mockImplementation(() => { throw new Error('client gone') })
    const good = fakeRes()
    subscribe('p4', bad)
    subscribe('p4', good)

    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()
    await vi.waitFor(() => expect(good.write).toHaveBeenCalledTimes(1))
    expect(bad.write).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()
    await vi.waitFor(() => expect(good.write).toHaveBeenCalledTimes(2))
    expect(bad.write).toHaveBeenCalledTimes(1) // removed after throwing, not called again
  })

  it('closes the previous watcher and clears any pending debounce timer when refreshed again', async () => {
    const watcher1 = new FakeWatcher()
    mockWatch.mockReturnValueOnce(watcher1)
    await refreshProjectWatch('p5', root)

    const res = fakeRes()
    subscribe('p5', res)
    watcher1.emit('change') // starts a pending debounce timer

    const watcher2 = new FakeWatcher()
    mockWatch.mockReturnValueOnce(watcher2)
    await refreshProjectWatch('p5', root) // closes watcher1 and clears its pending timer

    expect(watcher1.close).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(300)
    expect(res.write).not.toHaveBeenCalled() // the old pending broadcast never fired

    watcher2.emit('change')
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()
    await vi.waitFor(() => expect(res.write).toHaveBeenCalledTimes(1)) // only the new watcher's change broadcasts
  })

  it('closes the existing watcher and does not start a new one when fsPath is null', async () => {
    const watcher = new FakeWatcher()
    mockWatch.mockReturnValueOnce(watcher)
    await refreshProjectWatch('p6', root)
    mockWatch.mockClear()

    await refreshProjectWatch('p6', null)

    expect(watcher.close).toHaveBeenCalledTimes(1)
    expect(mockWatch).not.toHaveBeenCalled()
  })
})

describe('initTasksWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts a watcher for every project with a fs_path, and logs the count', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'a', fs_path: '/a' }, { id: 'b', fs_path: '/b' }] } as never)
    mockWatch.mockReturnValue(new FakeWatcher())
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await initTasksWatcher()

    expect(mockWatch).toHaveBeenCalledTimes(2)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('watching 2 project(s)'))
    logSpy.mockRestore()
  })

  it('logs zero projects and does not start any watcher when there are none', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await initTasksWatcher()

    expect(mockWatch).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('watching 0 project(s)'))
    logSpy.mockRestore()
  })

  it('logs an error and does not throw when the query fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(initTasksWatcher()).resolves.toBeUndefined()

    expect(errSpy).toHaveBeenCalledWith('  tasks-watcher: init failed:', 'db down')
    errSpy.mockRestore()
  })
})

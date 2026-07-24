import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import os   from 'node:os'
import path from 'node:path'
import type { Response } from 'express'

// The dedicated LISTEN client (see startListening in tasks-watcher.ts) is a real
// Postgres connection in production; here it's a fake EventEmitter the tests can
// manually .emit('notification', ...) on to simulate what Postgres would deliver
// after publishTaskUpdate's pg_notify — there's no real pub/sub to round-trip
// through against a mocked pool.
class FakeListenClient extends EventEmitter {
  query   = vi.fn().mockResolvedValue({ rows: [] })
  release = vi.fn()
}
const listenClient = new FakeListenClient()

vi.mock('../../db/pool.js', () => ({
  pool: {
    query:   vi.fn(),
    connect: vi.fn().mockResolvedValue(listenClient),
  },
}))

class FakeWatcher extends EventEmitter {
  close = vi.fn().mockResolvedValue(undefined)
}

const mockWatch = vi.fn()
vi.mock('chokidar', () => ({
  default: { watch: (...args: unknown[]) => mockWatch(...args) },
}))

const { readTaskTree, subscribe, refreshProjectWatch, initTasksWatcher, startListening, stopListening } = await import('../../services/tasks-watcher.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

// Simulates the real round-trip: production code calls publishTaskUpdate (INSERT +
// pg_notify), Postgres delivers the notification to every LISTENing instance, which
// re-reads task_tree_cache and broadcasts. Here: manually emit on the fake listen
// client, backed by a canned row for whatever project id the SELECT asks for.
function fireNotification(projectId: string) {
  listenClient.emit('notification', { channel: 'tasks_update', payload: projectId })
}

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

  // Registered once for the whole block — startListening() attaches a 'notification'
  // listener to the shared fake listenClient; calling it per-test would stack up
  // duplicate listeners and double-broadcast.
  beforeAll(async () => {
    await startListening()
  })

  beforeEach(async () => {
    vi.clearAllMocks()
    mockQuery.mockImplementation((sql: unknown, params?: unknown) => {
      if (typeof sql === 'string' && sql.includes('SELECT tree FROM task_tree_cache')) {
        const projectId = (params as [string])[0]
        return Promise.resolve({ rows: [{ tree: { projectId, lastUpdated: null, phases: [], overallPct: 0, totalDone: 0, totalItems: 0 } }] })
      }
      return Promise.resolve({ rows: [] })
    })
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

    // The debounce fires here (fake timer), but its callback awaits real fs.readFile
    // and pool.query (publishTaskUpdate) — fake timers don't control that, so bridge
    // to real timers and poll. fireNotification simulates the pg_notify round-trip
    // a real Postgres would deliver once publishTaskUpdate's INSERT/NOTIFY land.
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    fireNotification('p1')
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
    fireNotification('p2')
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
    fireNotification('p4')
    await vi.waitFor(() => expect(good.write).toHaveBeenCalledTimes(1))
    expect(bad.write).toHaveBeenCalledTimes(1)

    vi.useFakeTimers()
    watcher.emit('change')
    await vi.advanceTimersByTimeAsync(300)
    vi.useRealTimers()
    fireNotification('p4')
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
    fireNotification('p5')
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

// Each test here gives pool.connect() its own fresh FakeListenClient via
// mockResolvedValueOnce, instead of the shared module-level `listenClient` the other
// describe blocks use — startListening() attaches a new listener every call, and the
// shared instance accumulates one from every prior call in this file, which would
// make exact call-count assertions here flaky depending on test order.
describe('startListening / stopListening', () => {
  it('issues LISTEN on the dedicated client', async () => {
    const client = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never)

    await startListening()

    expect(client.query).toHaveBeenCalledWith('LISTEN tasks_update')
  })

  it('retries after a delay when pool.connect() fails, then succeeds', async () => {
    vi.useFakeTimers()
    const client = new FakeListenClient()
    vi.mocked(pool.connect)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(client as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const callsBefore = vi.mocked(pool.connect).mock.calls.length

    await startListening()
    expect(errSpy).toHaveBeenCalledWith(
      '  tasks-watcher: failed to start listen connection, retrying:', 'connection refused'
    )

    await vi.advanceTimersByTimeAsync(2000)
    expect(vi.mocked(pool.connect).mock.calls.length).toBe(callsBefore + 2)
    expect(client.query).toHaveBeenCalledWith('LISTEN tasks_update')

    errSpy.mockRestore()
    vi.useRealTimers()
  })

  it('reconnects when the listen connection itself errors', async () => {
    vi.useFakeTimers()
    const client1 = new FakeListenClient()
    const client2 = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client1 as never).mockResolvedValueOnce(client2 as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await startListening()
    client1.emit('error', new Error('connection lost'))
    await vi.advanceTimersByTimeAsync(2000)

    expect(errSpy).toHaveBeenCalledWith('  tasks-watcher: listen connection error, reconnecting:', 'connection lost')
    expect(client2.query).toHaveBeenCalledWith('LISTEN tasks_update')

    errSpy.mockRestore()
    vi.useRealTimers()
  })

  it('destroys the connection via release(true) on stopListening', async () => {
    const client = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never)

    await startListening()
    stopListening()

    expect(client.release).toHaveBeenCalledWith(true)
  })

  it('is safe to call stopListening twice in a row', async () => {
    const client = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never)

    await startListening()
    stopListening()
    expect(() => stopListening()).not.toThrow()
    expect(client.release).toHaveBeenCalledTimes(1)
  })

  it('logs an error without throwing when the cache lookup fails after a notification', async () => {
    const client = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never)
    await startListening()

    mockQuery.mockRejectedValueOnce(new Error('select failed'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    client.emit('notification', { channel: 'tasks_update', payload: 'px' })

    await vi.waitFor(() => expect(errSpy).toHaveBeenCalledWith(
      '  tasks-watcher: failed to load cached tree after notify:', 'select failed'
    ))
    errSpy.mockRestore()
  })

  it('ignores a notification with no payload', async () => {
    const client = new FakeListenClient()
    vi.mocked(pool.connect).mockResolvedValueOnce(client as never)
    await startListening()
    mockQuery.mockClear()

    client.emit('notification', { channel: 'tasks_update', payload: undefined })
    await new Promise(resolve => setImmediate(resolve))

    expect(mockQuery).not.toHaveBeenCalled()
  })
})

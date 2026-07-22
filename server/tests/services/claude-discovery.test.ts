import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os   from 'node:os'
import path from 'node:path'
import { discoverProjects } from '../../services/claude-discovery.js'

async function write(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf-8')
}

async function mkdirp(root: string, relPath: string) {
  await fs.mkdir(path.join(root, relPath), { recursive: true })
}

function tasksMd(opts: { project?: string; lastUpdated?: string; body: string }): string {
  const fm = ['---', opts.project ? `project: ${opts.project}` : null, opts.lastUpdated ? `last_updated: ${opts.lastUpdated}` : null, '---'].filter(Boolean).join('\n')
  return `${fm}\n${opts.body}`
}

describe('discoverProjects (Claude Code)', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-claude-discovery-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('discovers a full project: marker file + TASKS.md phases + sessions + project match', async () => {
    await write(root, 'proj-full/CLAUDE.md', '')
    await write(root, 'proj-full/TASKS.md', tasksMd({
      project: 'My Project', lastUpdated: '2026-01-01T10:00:00Z',
      body: [
        '## Phase 1',
        '- [x] item1',
        '- [x] item2',
        '- [ ] item3',
        '- [~] item4',
        '## Phase 2',
        '- [!] blocked item',
      ].join('\n'),
    }))
    await mkdirp(root, 'proj-full/sessions/2026-01-05_10-30_abc123')
    await write(root, 'proj-full/sessions/2026-01-05_10-30_abc123/SESSION.md', '# session')
    await mkdirp(root, 'proj-full/sessions/2026-01-01_09-00_xyz')
    await mkdirp(root, 'proj-full/sessions/not-a-date-folder')

    const existing = [{ id: 'proj-1', name: 'My Project', short_name: 'myproj' }]
    const results = await discoverProjects(root, new AbortController().signal, existing)

    expect(results).toHaveLength(1)
    const p = results[0]
    expect(p.name).toBe('My Project')
    // YAML parses the unquoted timestamp into a Date; parseTasksMd normalizes
    // it back to a real ISO string via toISOString() (see services/claude-discovery.ts)
    expect(p.lastUpdated).toBe('2026-01-01T10:00:00.000Z')
    expect(p.phases).toEqual([
      { name: 'Phase 1', total: 4, done: 2, pct: 50 },
      { name: 'Phase 2', total: 1, done: 0, pct: 0 },
    ])
    expect(p.overallPct).toBe(40) // 2 of 5 total across both phases
    expect(p.lastSessionDate).toBe('2026-01-05T10:30:00Z') // most recent, non-date folder ignored
    expect(p.matchedProjectId).toBe('proj-1')
    expect(p.matchedProjectName).toBe('My Project')
  })

  it('discovers a marker-only project with directory-name fallback and empty phases', async () => {
    await write(root, 'bare-marker/CLAUDE.md', '')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('bare-marker')
    expect(results[0].phases).toEqual([])
    expect(results[0].overallPct).toBe(0)
    expect(results[0].lastUpdated).toBeNull()
    expect(results[0].lastSessionDate).toBeNull()
    expect(results[0].matchedProjectId).toBeUndefined()
  })

  it('keeps a quoted (non-Date) last_updated string as-is', async () => {
    await write(root, 'quoted-date/CLAUDE.md', '')
    await write(root, 'quoted-date/TASKS.md', '---\nproject: Quoted\nlast_updated: "not-a-real-date"\n---\n')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results[0].lastUpdated).toBe('not-a-real-date')
  })

  it('qualifies via TASKS.md frontmatter alone when a project field is present', async () => {
    await write(root, 'tasks-only/TASKS.md', tasksMd({ project: 'Tasks Only', body: '## P\n- [x] a' }))

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('Tasks Only')
    expect(results[0].phases).toEqual([{ name: 'P', total: 1, done: 1, pct: 100 }])
  })

  it('does not qualify via TASKS.md when the project frontmatter field is missing', async () => {
    await write(root, 'no-project-field/TASKS.md', '---\nsomething: else\n---\n## P\n- [x] a')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toEqual([])
  })

  it('qualifies via a sessions/<dir>/SESSION.md alone, with no marker file or TASKS.md', async () => {
    await mkdirp(root, 'sessions-only/sessions/2026-02-01_08-00_id1')
    await write(root, 'sessions-only/sessions/2026-02-01_08-00_id1/SESSION.md', '# s')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('sessions-only')
    expect(results[0].phases).toEqual([])
  })

  it('does not qualify when "sessions" exists but is a file, not a directory', async () => {
    await write(root, 'weird-sessions/sessions', 'not a directory')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toEqual([])
  })

  it('skips node_modules and dotfolders even when they contain a marker file', async () => {
    await write(root, 'node_modules/fake-pkg/CLAUDE.md', '')
    await write(root, '.hidden/CLAUDE.md', '')
    await write(root, 'normal-proj/CLAUDE.md', '')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results.map(r => r.name)).toEqual(['normal-proj'])
  })

  it('does not recurse into an already-qualifying folder (no nested double-count)', async () => {
    await write(root, 'outer/CLAUDE.md', '')
    await write(root, 'outer/nested/CLAUDE.md', '')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('outer')
  })

  it('finds a project at depth 3 but not one nested one level deeper (maxDepth=3)', async () => {
    await write(root, 'l1/l2/proj3/CLAUDE.md', '')
    await write(root, 'l1/l2/l3/proj4/CLAUDE.md', '')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results.map(r => r.name)).toEqual(['proj3'])
  })

  it('falls back to the directory name gracefully when TASKS.md has malformed frontmatter', async () => {
    await write(root, 'broken/CLAUDE.md', '')
    await write(root, 'broken/TASKS.md', '---\nproject: [oops\n---\n## Phase\n- [x] a')

    const results = await discoverProjects(root, new AbortController().signal, [])

    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('broken')
    expect(results[0].phases).toEqual([])
  })

  it('returns [] for a scan root that does not exist, without throwing', async () => {
    const results = await discoverProjects(path.join(root, 'does-not-exist'), new AbortController().signal, [])
    expect(results).toEqual([])
  })

  it('returns [] immediately when the abort signal is already aborted', async () => {
    await write(root, 'proj-full/CLAUDE.md', '')
    const controller = new AbortController()
    controller.abort()

    const results = await discoverProjects(root, controller.signal, [])

    expect(results).toEqual([])
  })

  it('matches an existing project by normalized short_name when the display name differs', async () => {
    await write(root, 'quant-cru/CLAUDE.md', '')
    await write(root, 'quant-cru/TASKS.md', tasksMd({ project: 'QuantCru', body: '' }))
    const existing = [{ id: 'p9', name: 'WealthView Pro', short_name: 'quantcru' }]

    const results = await discoverProjects(root, new AbortController().signal, existing)

    expect(results[0].matchedProjectId).toBe('p9')
  })
})

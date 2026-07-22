import { describe, it, expect, vi, beforeEach } from 'vitest'
import matter from 'gray-matter'
import type { Archiver } from 'archiver'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

const { addProjectToArchive, buildZipToStream } = await import('../../services/exporter.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

function fakeArchive() {
  return {
    append:   vi.fn(),
    finalize: vi.fn().mockResolvedValue(undefined),
  } as unknown as Archiver & { append: ReturnType<typeof vi.fn>; finalize: ReturnType<typeof vi.fn> }
}

// Two rows per table: one exercising every optional field, one exercising the
// "field is absent/empty" branch, so both sides of every conditional in
// exporter.ts's markdown builders get covered.
const docs = [
  { id: 'd1', title: 'API Notes', file_type: 'md', tags: ['api', 'notes'], source: 'upload', created_at: '2026-01-01', content: '# hello\n\nworld' },
  // content: null (not '') — exercises the `?? ''` fallback
  { id: 'd2', title: 'Blank doc', file_type: 'txt', tags: [], source: 'upload', created_at: '2026-01-01', content: null },
]

const issues = [
  {
    id: 'i1', title: 'Login broken', status: 'open', priority: 'high', tags: ['auth'],
    description: 'Users cannot log in', resolution: '', created_at: '2026-01-02', resolved_at: null,
    investigation_steps: [{ instruction: 'Check logs', done: true }, { instruction: 'Reproduce', done: false }],
    notes: [{ content: 'Looks like a token issue', created_at: '2026-01-02' }],
  },
  {
    id: 'i2', title: 'Bare issue', status: 'resolved', priority: 'low', tags: [],
    description: '', resolution: 'n/a', created_at: '2026-01-03', resolved_at: '2026-01-04',
    // null (not []) — jsonb columns can come back null; exercises the `?? []` fallback too
    investigation_steps: null, notes: null,
  },
]

const commands = [
  { id: 'c1', title: 'Deploy', command: 'npm run deploy', language: 'bash', description: 'Deploy to prod', tags: ['ops'], is_favorite: true, created_at: '2026-01-05' },
  { id: 'c2', title: 'Bare command', command: 'ls', language: 'bash', description: '', tags: [], is_favorite: false, created_at: '2026-01-05' },
]

const releases = [
  {
    id: 'r1', version: '1.2.0', date: '2026-01-06', type: 'minor',
    features: ['New dashboard'], fixes: ['Fixed crash'], breaking_changes: ['Removed old API'],
    notes: 'Notable release', created_at: '2026-01-06',
  },
  {
    id: 'r2', version: '1.2.1', date: '2026-01-07', type: 'patch',
    // null (not []) — exercises the `?? []` fallback, same reasoning as the bare issue above
    features: null, fixes: null, breaking_changes: null, notes: '', created_at: '2026-01-07',
  },
]

const runbooks = [
  {
    id: 'rb1', title: 'Restart service', steps: [
      { instruction: 'SSH in', command: 'ssh host', note: 'use vpn' },
      { instruction: 'Restart', command: 'systemctl restart app' },
      { instruction: 'Confirm it is healthy' },
    ], tags: ['ops'], last_used_at: null, created_at: '2026-01-08',
  },
  {
    // steps: null (not []) — exercises the `?? []` fallback, same reasoning as above
    id: 'rb2', title: 'Empty runbook', steps: null, tags: [], last_used_at: null, created_at: '2026-01-09',
  },
]

const project = { id: 'p1', name: 'PlayCru', short_name: 'playcru' }

function mockTableQueries(overrides: Partial<Record<'documents' | 'issues' | 'commands' | 'releases' | 'runbooks' | 'projects', unknown[]>> = {}) {
  mockQuery.mockImplementation(async (sql: unknown) => {
    const text = String(sql)
    if (text.includes('FROM documents')) return { rows: overrides.documents ?? docs }
    if (text.includes('FROM issues'))    return { rows: overrides.issues ?? issues }
    if (text.includes('FROM commands'))  return { rows: overrides.commands ?? commands }
    if (text.includes('FROM releases'))  return { rows: overrides.releases ?? releases }
    if (text.includes('FROM runbooks'))  return { rows: overrides.runbooks ?? runbooks }
    if (text.includes('FROM projects'))  return { rows: overrides.projects ?? [project] }
    throw new Error(`unexpected query: ${text}`)
  })
}

describe('addProjectToArchive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTableQueries()
  })

  it('appends one markdown file per document, with frontmatter and content preserved', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)

    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/documents/api-notes.md')
    expect(call).toBeDefined()
    const parsed = matter(call![0] as string)
    expect(parsed.data.title).toBe('API Notes')
    expect(parsed.data.file_type).toBe('md')
    expect(parsed.data.tags).toEqual(['api', 'notes'])
    expect(parsed.content.trim()).toBe('# hello\n\nworld')
  })

  it('appends one markdown file per issue, with steps/notes sections present or absent', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)

    const full = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/issues/login-broken.md')
    expect(full).toBeDefined()
    const parsedFull = matter(full![0] as string)
    expect(parsedFull.data.status).toBe('open')
    expect(parsedFull.data.priority).toBe('high')
    expect(parsedFull.content).toContain('## Investigation Steps')
    expect(parsedFull.content).toContain('- [x] Check logs')
    expect(parsedFull.content).toContain('- [ ] Reproduce')
    expect(parsedFull.content).toContain('## Notes')
    expect(parsedFull.content).toContain('Looks like a token issue')

    const bare = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/issues/bare-issue.md')
    expect(bare).toBeDefined()
    const parsedBare = matter(bare![0] as string)
    expect(parsedBare.content).not.toContain('## Investigation Steps')
    expect(parsedBare.content).not.toContain('## Notes')
  })

  it('appends one markdown file per command with a fenced code block', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)

    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/commands/deploy.md')
    expect(call).toBeDefined()
    const parsed = matter(call![0] as string)
    expect(parsed.data.language).toBe('bash')
    expect(parsed.data.is_favorite).toBe(true)
    expect(parsed.content).toContain('```bash')
    expect(parsed.content).toContain('npm run deploy')
  })

  it('appends a collective issues.md with all issues and skips it when there are none', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)

    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/issues.md')
    expect(call).toBeDefined()
    const body = call![0] as string
    expect(body).toContain('# Issues — PlayCru')
    expect(body).toContain('## Login broken')
    expect(body).toContain('## Bare issue')
    expect(body).toContain('---') // separator between multiple issues

    mockTableQueries({ issues: [] })
    const archive2 = fakeArchive()
    await addProjectToArchive(archive2, project)
    expect(archive2.append.mock.calls.some(([, opts]) => opts.name === 'playcru/issues.md')).toBe(false)
  })

  it('appends a collective commands.md and skips it when there are none', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)
    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/commands.md')
    expect(call).toBeDefined()
    const body = call![0] as string
    expect(body).toContain('# Commands — PlayCru')
    expect(body).toContain('**Favorite:** true | **Tags:** ops')
    expect(body).toContain('**Favorite:** false | **Tags:** —') // empty tags fallback

    mockTableQueries({ commands: [] })
    const archive2 = fakeArchive()
    await addProjectToArchive(archive2, project)
    expect(archive2.append.mock.calls.some(([, opts]) => opts.name === 'playcru/commands.md')).toBe(false)
  })

  it('appends a collective releases.md covering both populated and empty optional sections', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)
    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/releases.md')
    expect(call).toBeDefined()
    const body = call![0] as string
    expect(body).toContain('# Releases — PlayCru')
    expect(body).toContain('## 1.2.0 (2026-01-06)')
    expect(body).toContain('### Features')
    expect(body).toContain('New dashboard')
    expect(body).toContain('### Breaking Changes')
    // 1.2.1 has no features/fixes/breaking changes/notes — no matching headers for it specifically,
    // but the release itself is still listed
    expect(body).toContain('## 1.2.1 (2026-01-07)')

    mockTableQueries({ releases: [] })
    const archive2 = fakeArchive()
    await addProjectToArchive(archive2, project)
    expect(archive2.append.mock.calls.some(([, opts]) => opts.name === 'playcru/releases.md')).toBe(false)
  })

  it('appends a collective runbooks.md with steps rendered, and skips it when there are none', async () => {
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)
    const call = archive.append.mock.calls.find(([, opts]) => opts.name === 'playcru/runbooks.md')
    expect(call).toBeDefined()
    const body = call![0] as string
    expect(body).toContain('# Runbooks — PlayCru')
    expect(body).toContain('## Restart service')
    expect(body).toContain('1. SSH in')
    expect(body).toContain('`ssh host`')
    expect(body).toContain('*use vpn*')
    expect(body).toContain('3. Confirm it is healthy') // step with no command/note
    expect(body).toContain('## Empty runbook')

    mockTableQueries({ runbooks: [] })
    const archive2 = fakeArchive()
    await addProjectToArchive(archive2, project)
    expect(archive2.append.mock.calls.some(([, opts]) => opts.name === 'playcru/runbooks.md')).toBe(false)
  })

  it('slugifies titles: lowercases, strips symbols, and falls back to "untitled"', async () => {
    mockTableQueries({
      documents: [{ ...docs[0], title: 'Weird!! Title -- With Spaces' }],
    })
    const archive = fakeArchive()
    await addProjectToArchive(archive, project)
    expect(archive.append.mock.calls.some(([, opts]) => opts.name === 'playcru/documents/weird-title-with-spaces.md')).toBe(true)

    mockTableQueries({
      documents: [{ ...docs[0], title: '!!!' }],
    })
    const archive2 = fakeArchive()
    await addProjectToArchive(archive2, project)
    expect(archive2.append.mock.calls.some(([, opts]) => opts.name === 'playcru/documents/untitled.md')).toBe(true)
  })
})

describe('buildZipToStream', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTableQueries()
  })

  it("queries all projects (no filter) and finalizes the archive when projectIds is 'all'", async () => {
    mockTableQueries({ projects: [project, { id: 'p2', name: 'Memex', short_name: 'memex' }] })
    const archive = fakeArchive()

    await buildZipToStream(archive, 'all')

    const projectsCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM projects'))
    expect(projectsCall).toBeDefined()
    expect(projectsCall![1]).toBeUndefined()

    // One set of per-item + collective files was appended for each of the 2 projects
    expect(archive.append.mock.calls.some(([, opts]) => opts.name === 'playcru/documents/api-notes.md')).toBe(true)
    expect(archive.append.mock.calls.some(([, opts]) => opts.name === 'memex/documents/api-notes.md')).toBe(true)
    expect(archive.finalize).toHaveBeenCalledTimes(1)
  })

  it('filters projects by id when projectIds is an explicit array', async () => {
    const archive = fakeArchive()
    await buildZipToStream(archive, ['p1'])

    const projectsCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes('FROM projects'))
    expect(projectsCall).toBeDefined()
    expect(String(projectsCall![0])).toContain('WHERE id = ANY($1)')
    expect(projectsCall![1]).toEqual([['p1']])
    expect(archive.finalize).toHaveBeenCalledTimes(1)
  })

  it('finalizes an empty archive when no projects match', async () => {
    mockTableQueries({ projects: [] })
    const archive = fakeArchive()

    await buildZipToStream(archive, ['nonexistent'])

    expect(archive.append).not.toHaveBeenCalled()
    expect(archive.finalize).toHaveBeenCalledTimes(1)
  })
})

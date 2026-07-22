import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import os   from 'node:os'
import path from 'node:path'
import { readSessions, readSessionDetail } from '../../services/session-reader.js'

async function write(root: string, relPath: string, content: string) {
  const full = path.join(root, relPath)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content, 'utf-8')
}

function sessionMd(opts: {
  sessionId?: string; started?: string; status?: string; ended?: string
  goals?: string[]; workDone?: string[]; decisions?: string[]; openItems?: string[]
}): string {
  const fm = [
    '---',
    opts.sessionId ? `session_id: ${opts.sessionId}` : null,
    opts.started ? `started: ${opts.started}` : null,
    opts.status ? `status: ${opts.status}` : null,
    '---',
  ].filter(Boolean).join('\n')
  const section = (title: string, items?: string[]) => items && items.length
    ? `## ${title}\n${items.map((line, idx) => `${idx % 2 === 0 ? '-' : '*'} ${line}`).join('\n')}\n`
    : ''
  const endedBlock = opts.ended ? `## Session Ended\nended: ${opts.ended}\n` : ''
  return [fm, section('Goals', opts.goals), section('Work Done', opts.workDone), section('Decisions', opts.decisions), section('Open Items', opts.openItems), endedBlock].join('\n')
}

describe('readSessions', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-session-reader-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns [] when the sessions directory does not exist', async () => {
    expect(await readSessions(root)).toEqual([])
  })

  it('returns [] when the sessions directory is empty', async () => {
    await fs.mkdir(path.join(root, 'sessions'), { recursive: true })
    expect(await readSessions(root)).toEqual([])
  })

  it('parses a full session: frontmatter, both bullet styles, and an ended block', async () => {
    await write(root, 'sessions/2026-01-05_10-30_abc/SESSION.md', sessionMd({
      sessionId: 'sess-abc', started: '2026-01-05T10:30:00Z', status: 'completed', ended: '2026-01-05T12:00:00Z',
      goals: ['Ship the feature', 'Write tests'],
      workDone: ['Implemented X', 'Fixed Y', 'Refactored Z'],
      decisions: ['Use approach A'],
      openItems: ['Follow up on B'],
    }))

    const [session] = await readSessions(root)

    expect(session.sessionId).toBe('sess-abc')
    expect(session.folderName).toBe('2026-01-05_10-30_abc')
    expect(session.date).toBe('2026-01-05')
    // YAML parses the unquoted timestamp into a Date; readSessions normalizes
    // it back to a real ISO string (see frontmatterString in session-reader.ts)
    expect(session.started).toBe('2026-01-05T10:30:00.000Z')
    expect(session.status).toBe('completed')
    expect(session.ended).toBe('2026-01-05T12:00:00Z')
    expect(session.goals).toEqual(['Ship the feature', 'Write tests'])
    expect(session.workDone).toEqual(['Implemented X', 'Fixed Y', 'Refactored Z'])
    expect(session.decisions).toEqual(['Use approach A'])
    expect(session.openItems).toEqual(['Follow up on B'])
    expect(session.workDoneCount).toBe(3)
  })

  it('falls back to folder-derived values when frontmatter is minimal, defaults to active, and omits `ended`', async () => {
    await write(root, 'sessions/2026-02-01_09-00_xyz/SESSION.md', '---\n---\n## Goals\n- Do the thing\n')

    const [session] = await readSessions(root)

    expect(session.sessionId).toBe('2026-02-01_09-00_xyz')
    expect(session.started).toBe('2026-02-01')
    expect(session.status).toBe('active')
    expect(session).not.toHaveProperty('ended')
  })

  it('keeps scanning the "Session Ended" block past lines that do not match `ended:`', async () => {
    await write(root, 'sessions/2026-01-01_09-00_e/SESSION.md', [
      '---', '---',
      '## Session Ended',
      '(some other note that is not the ended field)',
      'ended: 2026-01-01T15:00:00Z',
    ].join('\n'))

    const [session] = await readSessions(root)

    expect(session.ended).toBe('2026-01-01T15:00:00Z')
  })

  it('keeps a quoted (non-Date) started string as-is', async () => {
    await write(root, 'sessions/2026-01-01_09-00_q/SESSION.md', '---\nstarted: "not-a-real-date"\n---\n')

    const [session] = await readSessions(root)

    expect(session.started).toBe('not-a-real-date')
  })

  it('sorts sessions newest-first by folder name', async () => {
    await write(root, 'sessions/2026-01-01_09-00_a/SESSION.md', '---\n---\n')
    await write(root, 'sessions/2026-03-01_09-00_c/SESSION.md', '---\n---\n')
    await write(root, 'sessions/2026-02-01_09-00_b/SESSION.md', '---\n---\n')

    const results = await readSessions(root)

    expect(results.map(s => s.folderName)).toEqual(['2026-03-01_09-00_c', '2026-02-01_09-00_b', '2026-01-01_09-00_a'])
  })

  it('skips a folder without a readable SESSION.md, without breaking the rest', async () => {
    await write(root, 'sessions/not-a-dir', 'this is a file, not a session folder')
    await write(root, 'sessions/2026-01-01_09-00_ok/SESSION.md', '---\n---\n')

    const results = await readSessions(root)

    expect(results).toHaveLength(1)
    expect(results[0].folderName).toBe('2026-01-01_09-00_ok')
  })

  it('returns an empty date and started value when the folder name has no YYYY-MM-DD prefix', async () => {
    await write(root, 'sessions/weird-folder-name/SESSION.md', '---\n---\n')

    const [session] = await readSessions(root)

    expect(session.date).toBe('')
    expect(session.started).toBe('')
  })
})

describe('readSessionDetail', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'devbrain-session-reader-detail-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it('returns null when the sessions directory does not exist', async () => {
    expect(await readSessionDetail(root, 'anything')).toBeNull()
  })

  it('matches by session_id frontmatter field and includes rawMarkdown, status, and ended', async () => {
    const raw = sessionMd({ sessionId: 'sess-xyz', goals: ['G1'], status: 'completed', ended: '2026-01-01T12:00:00Z' })
    await write(root, 'sessions/2026-01-01_09-00_folder/SESSION.md', raw)

    const detail = await readSessionDetail(root, 'sess-xyz')

    expect(detail).not.toBeNull()
    expect(detail!.sessionId).toBe('sess-xyz')
    expect(detail!.rawMarkdown).toBe(raw)
    expect(detail!.goals).toEqual(['G1'])
    expect(detail!.status).toBe('completed')
    expect(detail!.ended).toBe('2026-01-01T12:00:00Z')
  })

  it('falls back to matching by folder name when session_id is absent', async () => {
    await write(root, 'sessions/2026-01-01_09-00_folder/SESSION.md', '---\n---\n')

    const detail = await readSessionDetail(root, '2026-01-01_09-00_folder')

    expect(detail).not.toBeNull()
    expect(detail!.sessionId).toBe('2026-01-01_09-00_folder')
  })

  it('returns null when no session matches the given id', async () => {
    await write(root, 'sessions/2026-01-01_09-00_folder/SESSION.md', sessionMd({ sessionId: 'sess-a' }))

    expect(await readSessionDetail(root, 'sess-does-not-exist')).toBeNull()
  })

  it('skips an unreadable session folder without throwing, and reports no match', async () => {
    // Only a broken entry — forces the loop to hit its catch/continue rather
    // than short-circuiting on an earlier real match (readSessionDetail
    // returns as soon as it finds one, so a valid sibling could otherwise
    // mask this entirely depending on directory iteration order).
    await write(root, 'sessions/not-a-dir', 'a file, not a folder')

    expect(await readSessionDetail(root, 'sess-ok')).toBeNull()
  })

  it('still finds a match when a broken sibling folder exists', async () => {
    await write(root, 'sessions/not-a-dir', 'a file, not a folder')
    await write(root, 'sessions/2026-01-01_09-00_ok/SESSION.md', sessionMd({ sessionId: 'sess-ok' }))

    const detail = await readSessionDetail(root, 'sess-ok')

    expect(detail).not.toBeNull()
    expect(detail!.sessionId).toBe('sess-ok')
  })
})

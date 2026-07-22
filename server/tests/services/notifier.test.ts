import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/crypto.js', () => ({
  decrypt: vi.fn((s: string) => s.replace('enc:', '')),
}))

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

const { sendAppriseNotification } = await import('../../services/notifier.js')
const { pool } = await import('../../db/pool.js')
const { decrypt } = await import('../../services/crypto.js')
const { spawn } = await import('child_process')

const mockQuery = vi.mocked(pool.query)
const mockDecrypt = vi.mocked(decrypt)
const mockSpawn = vi.mocked(spawn)

type FakeChild = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  return child
}

async function resolveSpawn(child: FakeChild, code: number, stdout = '') {
  await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
  if (stdout) child.stdout.emit('data', Buffer.from(stdout))
  child.emit('close', code)
}

function channel(overrides: Partial<{ id: string; name: string; apprise_url: string }> = {}) {
  return { id: 'chan-1', name: 'Telegram', apprise_url: 'enc:tgram://token/chat', ...overrides }
}

describe('sendAppriseNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns [] without spawning when the user has no enabled channels', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)

    const result = await sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B' })

    expect(result).toEqual([])
    expect(mockSpawn).not.toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1)
  })

  it('sends to all channels when no projectId filter is given, and records success', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel({ id: 'c1', name: 'Telegram' })] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1', channel: 'telegram' }] } as never) // INSERT

    const promise = sendAppriseNotification({ userId: 'u1', title: 'Hello', body: 'World' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)

    await resolveSpawn(child, 0, JSON.stringify({ sent: true }))
    const result = await promise

    expect(mockDecrypt).toHaveBeenCalledWith('enc:tgram://token/chat')
    const payload = JSON.parse((child.stdin.write.mock.calls[0][0]) as string)
    expect(payload).toEqual({ title: 'Hello', body: 'World', level: 'info', apprise_urls: ['tgram://token/chat'] })
    expect(child.stdin.end).toHaveBeenCalled()

    // No projectId → no project_notification_prefs lookup, just channels + one insert
    expect(mockQuery).toHaveBeenCalledTimes(2)
    const insertCall = mockQuery.mock.calls[1]
    expect(String(insertCall[0])).toContain('INSERT INTO notifications')
    expect(insertCall[1]).toEqual(['u1', 'external_info', 'Hello', 'World', null, null, 'telegram', 'sent'])
    expect(result).toEqual([{ id: 'n1', channel: 'telegram' }])
  })

  it('applies per-project channel preferences: default-allowed, explicitly-allowed, and disabled', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        channel({ id: 'c1', name: 'NoPref' }),   // no prefs row → defaults to allowed
        channel({ id: 'c2', name: 'Allowed' }),  // prefs row, enabled true
        channel({ id: 'c3', name: 'Disabled' }), // prefs row, enabled false
      ],
    } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never)                    // prefs for c1 → none
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: true }] } as never)   // prefs for c2
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false }] } as never)  // prefs for c3
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)        // insert for c1
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n2' }] } as never)        // insert for c2

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B', projectId: 'p1' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await resolveSpawn(child, 0, JSON.stringify({ sent: true }))
    const result = await promise

    const payload = JSON.parse(child.stdin.write.mock.calls[0][0] as string)
    expect(payload.apprise_urls).toHaveLength(2) // c3 (Disabled) excluded
    expect(mockDecrypt).toHaveBeenCalledTimes(2)
    expect(result).toHaveLength(2)

    const prefsCalls = mockQuery.mock.calls.filter(([sql]) => String(sql).includes('project_notification_prefs'))
    expect(prefsCalls).toHaveLength(3)
    expect(prefsCalls[0][1]).toEqual(['p1', 'c1'])
  })

  it('skips a channel whose apprise_url fails to decrypt, without aborting the others', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [channel({ id: 'c1', name: 'Bad' }), channel({ id: 'c2', name: 'Good' })],
    } as never)
    mockDecrypt.mockImplementationOnce(() => { throw new Error('bad ciphertext') })
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never) // insert for c2 only

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await resolveSpawn(child, 0, JSON.stringify({ sent: true }))
    const result = await promise

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to decrypt URL for channel Bad'), expect.any(Error))
    const payload = JSON.parse(child.stdin.write.mock.calls[0][0] as string)
    expect(payload.apprise_urls).toHaveLength(1)
    expect(result).toHaveLength(1)

    errSpy.mockRestore()
  })

  it('returns [] without spawning when every channel is filtered out', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel({ id: 'c1' })] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ enabled: false }] } as never) // prefs disables it

    const result = await sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B', projectId: 'p1' })

    expect(result).toEqual([])
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('records delivery failure with the stderr message when the python process exits non-zero', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel()] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'Original' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
    child.stderr.emit('data', Buffer.from('boom'))
    child.emit('close', 1)
    await promise

    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1]).toEqual(['u1', 'external_info', 'T', 'Original - Error: boom', null, null, 'telegram', 'failed'])
  })

  it('falls back to a generic exit-code message when stderr is empty', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel()] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await vi.waitFor(() => expect(mockSpawn).toHaveBeenCalledTimes(1))
    child.emit('close', 7)
    await promise

    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1][3]).toBe('B - Error: Python exited with code 7')
  })

  it('records delivery failure and logs when python stdout is not valid JSON', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel()] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await resolveSpawn(child, 0, 'not json{')
    await promise

    expect(errSpy).toHaveBeenCalledWith('Failed to parse apprise_client.py output:', expect.any(Error))
    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1][7]).toBe('failed')
    expect(insertCall[1][3]).toContain('Invalid JSON output: not json{')

    errSpy.mockRestore()
  })

  it('leaves the body unchanged when the python result is unsent but carries no error message', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel()] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'Plain' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await resolveSpawn(child, 0, JSON.stringify({ sent: false }))
    await promise

    const insertCall = mockQuery.mock.calls[1]
    expect(insertCall[1][3]).toBe('Plain')
    expect(insertCall[1][7]).toBe('failed')
  })

  it('tags entity_type/entity_id with the project when projectId is set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [channel()] } as never)
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // prefs: none → default allowed
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'n1' }] } as never)

    const promise = sendAppriseNotification({ userId: 'u1', title: 'T', body: 'B', projectId: 'proj-9', level: 'warning' })
    const child = fakeChild()
    mockSpawn.mockReturnValue(child as never)
    await resolveSpawn(child, 0, JSON.stringify({ sent: true }))
    await promise

    const insertCall = mockQuery.mock.calls[2]
    expect(insertCall[1]).toEqual(['u1', 'external_warning', 'T', 'B', 'project', 'proj-9', 'telegram', 'sent'])
  })
})

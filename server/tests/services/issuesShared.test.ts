import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn() },
}))

vi.mock('../../services/ai.js', () => ({
  aiEmbed: vi.fn(),
}))

const { embedIssueAsync } = await import('../../services/issuesShared.js')
const { pool } = await import('../../db/pool.js')
const { aiEmbed } = await import('../../services/ai.js')

const mockQuery = vi.mocked(pool.query)
const mockAiEmbed = vi.mocked(aiEmbed)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('embedIssueAsync', () => {
  it('marks processing, embeds, then marks done on success', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockAiEmbed.mockResolvedValueOnce([0.1, 0.2, 0.3])

    embedIssueAsync('i1', 'Login broken', 'stack trace here')

    expect(mockQuery.mock.calls[0][0]).toContain(`embedding_status = 'processing'`)
    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))

    expect(mockAiEmbed).toHaveBeenCalledWith('Login broken. stack trace here')
    expect(mockQuery.mock.calls[1][0]).toContain(`embedding_status = 'done'`)
    expect(mockQuery.mock.calls[1][1]).toEqual(['i1', '[0.1,0.2,0.3]'])
  })

  it('joins only the non-empty parts of title/description', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockAiEmbed.mockResolvedValueOnce([1])

    embedIssueAsync('i1', 'Title only', '')

    await vi.waitFor(() => expect(mockAiEmbed).toHaveBeenCalled())
    expect(mockAiEmbed).toHaveBeenCalledWith('Title only')
  })

  it('swallows a failure marking the issue processing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db down')) // processing update
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // done update
    mockAiEmbed.mockResolvedValueOnce([1])

    embedIssueAsync('i1', 'Title', 'Desc')

    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
    expect(mockQuery.mock.calls[1][0]).toContain(`embedding_status = 'done'`)
  })

  it('marks failed when the embed call itself rejects', async () => {
    mockQuery.mockResolvedValue({ rows: [] } as never)
    mockAiEmbed.mockRejectedValueOnce(new Error('ollama unreachable'))

    embedIssueAsync('i1', 'Title', 'Desc')

    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
    expect(mockQuery.mock.calls[1][0]).toContain(`embedding_status = 'failed'`)
    expect(mockQuery.mock.calls[1][1]).toEqual(['i1'])
  })

  it('swallows a failure marking the issue failed (embed rejects and the failed-status update also fails)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] } as never) // processing update
    mockQuery.mockRejectedValueOnce(new Error('db down'))  // failed-status update
    mockAiEmbed.mockRejectedValueOnce(new Error('ollama unreachable'))

    embedIssueAsync('i1', 'Title', 'Desc')

    await vi.waitFor(() => expect(mockQuery).toHaveBeenCalledTimes(2))
  })
})

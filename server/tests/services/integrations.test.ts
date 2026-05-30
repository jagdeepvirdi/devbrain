import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before anything else
vi.mock('../../db/pool.js', () => ({
  pool: {
    query: vi.fn(),
  },
}))

vi.mock('../../services/crypto.js', () => ({
  decrypt: vi.fn(s => s.replace('enc:', '')),
}))

// Import service after mocks are registered
const { syncGitHub, syncLinear } = await import('../../services/integrations.js')
const { pool } = await import('../../db/pool.js')

const mockQuery = vi.mocked(pool.query)

describe('Integrations Service Sync Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('syncGitHub — syncs non-PR issues', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { id: 101, title: 'I1', body: 'D1', state: 'open', labels: [] },
        { id: 102, title: 'I2', body: 'D2', state: 'open', labels: [], pull_request: {} },
      ])
    })
    vi.stubGlobal('fetch', mockFetch)

    mockQuery.mockResolvedValue({ rowCount: 1 } as any)

    const integration = { project_id: 'p1', external_project_id: 'o/r' }
    const result = await syncGitHub(integration, 'token')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
    expect(result.total).toBe(2)
  })

  it('syncLinear — maps priority and status correctly', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: {
          issues: {
            nodes: [
              { id: 'l1', title: 'L1', description: '', priority: 2, state: { name: 'In Progress' }, labels: { nodes: [] } }
            ]
          }
        }
      })
    })
    vi.stubGlobal('fetch', mockFetch)

    mockQuery.mockResolvedValue({ rowCount: 1 } as any)

    const integration = { project_id: 'p1', external_project_id: 'TEAM' }
    await syncLinear(integration, 'key')

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO issues'),
      expect.arrayContaining(['high', 'investigating', 'linear:l1'])
    )
  })
})

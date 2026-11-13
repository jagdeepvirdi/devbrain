import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DashboardPage } from './Dashboard'
import type { DashboardData } from '../lib/api'

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ selectedProject: () => null }),
}))

const getMock              = vi.fn()
const statsV2Mock          = vi.fn()
const activityMock         = vi.fn()
const issueThroughputMock  = vi.fn()
const embeddingTrendMock   = vi.fn()
const listCommitsMock      = vi.fn()
const digestMock           = vi.fn()
const timeReportMock       = vi.fn()
const timeRulesMock        = vi.fn()

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    dashboardApi: {
      get:                  (...args: unknown[]) => getMock(...args),
      statsV2:              (...args: unknown[]) => statsV2Mock(...args),
      activity:             (...args: unknown[]) => activityMock(...args),
      issueThroughput:      (...args: unknown[]) => issueThroughputMock(...args),
      embeddingHealthTrend: (...args: unknown[]) => embeddingTrendMock(...args),
    },
    gitApi: { listCommits: (...args: unknown[]) => listCommitsMock(...args) },
    activityApi: { digest: (...args: unknown[]) => digestMock(...args), generateDigest: vi.fn() },
    timeApi: { report: (...args: unknown[]) => timeReportMock(...args), rules: (...args: unknown[]) => timeRulesMock(...args), import: vi.fn(), addRule: vi.fn(), deleteRule: vi.fn() },
  }
})

const dashboardData: DashboardData = {
  stats:            { docs: 4, openIssues: 2, totalIssues: 5, commands: 6, releases: 1, runbooks: 0 },
  openIssues:       [{ id: 'i1', title: 'Login broken', status: 'open', priority: 'high', created_at: '2026-08-01T00:00:00Z', step_count: 0, project_name: null, project_color: null }],
  favoriteCommands: [],
  recentReleases:   [],
  projects:         [],
  activity:         [],
}

function renderDashboard() {
  render(<MemoryRouter><DashboardPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  getMock.mockResolvedValue(dashboardData)
  statsV2Mock.mockResolvedValue({ openByProject: [], avgResolution: [], embeddingHealth: { done: 0, pending: 0, failed: 0, failedIds: [] }, commandsThisWeek: 0, staleIssues: [] })
  activityMock.mockResolvedValue([])
  issueThroughputMock.mockResolvedValue([])
  embeddingTrendMock.mockResolvedValue([])
  listCommitsMock.mockResolvedValue([])
  digestMock.mockResolvedValue([])
  timeReportMock.mockResolvedValue({ from: '', to: '', group: 'day', rows: [], by_source: [] })
  timeRulesMock.mockResolvedValue([])
})

// Smoke coverage backfilled for the tech-debt audit (2026-08-17) — this page
// had zero tests despite being the app's landing view and fanning out to 5
// separate API calls on mount.
describe('DashboardPage', () => {
  it('loads and renders the all-projects dashboard with its stats and open issues', async () => {
    renderDashboard()

    expect(await screen.findByText('All Projects')).toBeInTheDocument()
    expect(getMock).toHaveBeenCalledWith(undefined)
    expect(screen.getByText('Login broken')).toBeInTheDocument()
  })

  it('shows an error state instead of crashing when the primary dashboard fetch fails', async () => {
    getMock.mockRejectedValue(new Error('Failed to reach the server'))
    renderDashboard()

    expect(await screen.findByText('Failed to reach the server')).toBeInTheDocument()
  })
})

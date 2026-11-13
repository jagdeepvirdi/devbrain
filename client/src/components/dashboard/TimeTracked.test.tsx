import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { TimeReport, TimeReportRow } from '../../lib/api'

const reportMock = vi.fn()
const importMock = vi.fn()
const rulesMock  = vi.fn()
const addMock    = vi.fn()
const deleteMock = vi.fn()

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    timeApi: {
      report:     (...a: unknown[]) => reportMock(...a),
      import:     (...a: unknown[]) => importMock(...a),
      rules:      (...a: unknown[]) => rulesMock(...a),
      addRule:    (...a: unknown[]) => addMock(...a),
      deleteRule: (...a: unknown[]) => deleteMock(...a),
    },
  }
})

import { TimeTracked } from './TimeTracked'

const PROJECTS = [{ id: 'p1', name: 'DevBrain' }, { id: 'p2', name: 'PlayCru' }]

const row = (over: Partial<TimeReportRow> = {}): TimeReportRow => ({
  period: '2026-11-12', project_id: 'p1', project_name: 'DevBrain', color: '#6366F1',
  seconds: 5400, sources: ['activitywatch'], ...over,
})
const report = (rows: TimeReportRow[]): TimeReport => ({
  from: '2026-11-07', to: '2026-11-13', group: 'day', rows,
  by_source: [{ source: 'activitywatch', seconds: 5400 }, { source: 'git-estimate', seconds: 7200 }],
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 13, 10, 0))   // local Fri 2026-11-13
  for (const m of [reportMock, importMock, rulesMock, addMock, deleteMock]) m.mockReset()
  reportMock.mockResolvedValue(report([]))
  rulesMock.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('TimeTracked', () => {
  it('requests the last 7 days (inclusive of today) by default', async () => {
    render(<TimeTracked projects={PROJECTS} />)
    await waitFor(() => expect(reportMock).toHaveBeenCalledWith('2026-11-07', '2026-11-13', undefined))
  })

  it('switches to 30 days', async () => {
    render(<TimeTracked projects={PROJECTS} />)
    fireEvent.click(await screen.findByRole('button', { name: '30d' }))
    await waitFor(() => expect(reportMock).toHaveBeenCalledWith('2026-10-15', '2026-11-13', undefined))
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('all-projects view sums each project across days, biggest first, with Unassigned grey', async () => {
    reportMock.mockResolvedValue(report([
      row({ period: '2026-11-12', seconds: 3600 }),
      row({ period: '2026-11-13', seconds: 1800, sources: ['git-estimate'] }),
      row({ period: '2026-11-13', project_id: 'p2', project_name: 'PlayCru', seconds: 600 }),
      row({ period: '2026-11-13', project_id: null, project_name: null, color: null, seconds: 7200 }),
    ]))
    render(<TimeTracked projects={PROJECTS} />)

    expect(await screen.findByText('Unassigned')).toBeInTheDocument()
    expect(screen.getByText('1h 30m')).toBeInTheDocument()        // DevBrain 3600 + 1800
    expect(screen.getByText('2h')).toBeInTheDocument()            // Unassigned 7200
    expect(screen.getByText('3h 40m total')).toBeInTheDocument()   // 3600+1800+600+7200 = 13200s
    const labels = screen.getAllByText(/^(Unassigned|DevBrain|PlayCru)$/).map(e => e.textContent)
    expect(labels).toEqual(['Unassigned', 'DevBrain', 'PlayCru'])
    expect(screen.getByText(/ActivityWatch · Git estimate/)).toBeInTheDocument()
  })

  it('project drill-down shows one bar per day, oldest first, and scopes the request', async () => {
    reportMock.mockResolvedValue(report([
      row({ period: '2026-11-13', seconds: 600 }), row({ period: '2026-11-11', seconds: 1200 }),
    ]))
    render(<TimeTracked projectId="p1" projects={PROJECTS} />)

    expect(await screen.findByText('11-11')).toBeInTheDocument()
    expect(reportMock).toHaveBeenCalledWith('2026-11-07', '2026-11-13', 'p1')
    const labels = screen.getAllByText(/^11-1\d$/).map(e => e.textContent)
    expect(labels).toEqual(['11-11', '11-13'])
  })

  it('shows the raw per-source breakdown', async () => {
    reportMock.mockResolvedValue(report([row()]))
    render(<TimeTracked projects={PROJECTS} />)
    expect(await screen.findByText(/Raw: ActivityWatch 1h 30m · Git estimate 2h/)).toBeInTheDocument()
  })

  it('shows an empty state and a load error without crashing', async () => {
    render(<TimeTracked projects={PROJECTS} />)
    expect(await screen.findByText(/No time recorded yet/)).toBeInTheDocument()
  })

  it('shows the load error', async () => {
    reportMock.mockRejectedValue(new Error('Failed to reach the server'))
    render(<TimeTracked projects={PROJECTS} />)
    expect(await screen.findByText('Failed to reach the server')).toBeInTheDocument()
  })

  it('Import reloads the report and summarizes the result', async () => {
    importMock.mockResolvedValue({
      activitywatch: { days: 2, entries: 3 },
      'claude-session': [{ project: 'DevBrain', hours: 4, days: 2 }],
      'git-estimate':   [{ project: 'DevBrain', hours: 9.5, days: 5 }],
    })
    render(<TimeTracked projects={PROJECTS} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('ActivityWatch: 3 entries · Sessions: 4h · Git estimate: 9.5h')
    await waitFor(() => expect(reportMock).toHaveBeenCalledTimes(2))
  })

  it('Import surfaces "ActivityWatch not reachable" as an error while keeping other sources', async () => {
    importMock.mockResolvedValue({
      activitywatch: { error: 'ActivityWatch not reachable at http://localhost:5600' },
      'git-estimate': [{ project: 'DevBrain', hours: 2 }, { project: 'Gone', error: 'ENOENT' }],
    })
    render(<TimeTracked projects={PROJECTS} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('not reachable')
    expect(status).toHaveTextContent('Gone: ENOENT')
    expect(status).toHaveTextContent('Git estimate: 2h')
    expect(status).toHaveStyle({ color: '#EF4444' })
  })

  it('Import failure shows the server message and re-enables the button', async () => {
    importMock.mockRejectedValue(new Error('Forbidden'))
    render(<TimeTracked projects={PROJECTS} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Import' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Forbidden')
    expect(screen.getByRole('button', { name: 'Import' })).toBeEnabled()
  })

  it('toggles the mapping-rules editor', async () => {
    render(<TimeTracked projects={PROJECTS} />)
    expect(screen.queryByText(/Rules decide which project/)).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Rules' }))
    expect(await screen.findByText(/Rules decide which project/)).toBeInTheDocument()
  })
})

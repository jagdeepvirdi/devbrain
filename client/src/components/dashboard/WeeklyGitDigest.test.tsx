import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import type { ActivityDigest } from '../../lib/api'

const digestMock   = vi.fn()
const generateMock = vi.fn()

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return {
    ...actual,
    activityApi: {
      digest:         (...a: unknown[]) => digestMock(...a),
      generateDigest: (...a: unknown[]) => generateMock(...a),
    },
  }
})

import { WeeklyGitDigest } from './WeeklyGitDigest'
import { mondayOf, shiftWeek, lastCompletedWeek } from '../../lib/weeks'

// Fri 2026-11-13 → last completed week starts Mon 2026-11-02, current week Mon 2026-11-09.
const NOW = new Date('2026-11-13T10:00:00Z')

const digest = (over: Partial<ActivityDigest> = {}): ActivityDigest => ({
  id: 'd1', project_id: 'p1', project_name: 'DevBrain', short_name: 'devbrain', color: '#6366F1',
  week_start: '2026-11-02', week_end: '2026-11-09', commit_count: 12,
  branches: ['main', 'feat/x'],
  stats: { files_changed: 7, insertions: 340, deletions: 80 },
  summary: {
    highlights: ['Hardened notify auth'], features: ['Weekly digest'], fixes: ['Fixed injection'],
    risks: ['Schema change'], summary: 'A security-focused week.',
  },
  model: 'mistral', generated_at: '2026-11-09T01:00:00Z',
  ...over,
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })   // fake only Date so async/RTL timers keep working
  vi.setSystemTime(NOW)
  digestMock.mockReset()
  generateMock.mockReset()
  digestMock.mockResolvedValue([])
})
afterEach(() => { vi.useRealTimers() })

describe('week helpers', () => {
  it('mondayOf / shiftWeek / lastCompletedWeek agree with the server', () => {
    expect(mondayOf('2026-11-13')).toBe('2026-11-09')
    expect(mondayOf('2026-11-15')).toBe('2026-11-09')
    expect(shiftWeek('2026-11-09', -1)).toBe('2026-11-02')
    expect(shiftWeek('2026-12-28', 1)).toBe('2027-01-04')
    expect(lastCompletedWeek(NOW)).toBe('2026-11-02')
  })
})

describe('WeeklyGitDigest', () => {
  it('loads the last completed week by default and renders totals and summaries', async () => {
    digestMock.mockResolvedValue([digest(), digest({ id: 'd2', project_name: 'PlayCru', commit_count: 3, summary: { ...digest().summary, summary: 'Small week.' } })])
    render(<WeeklyGitDigest />)

    expect(await screen.findByText('DevBrain')).toBeInTheDocument()
    expect(digestMock).toHaveBeenCalledWith('2026-11-02', undefined)
    expect(screen.getByText('15 commits across 2 projects')).toBeInTheDocument()
    expect(screen.getByText('A security-focused week.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Regenerate' })).toBeInTheDocument()
  })

  it('expands a project row on click to show highlights, risks and branches', async () => {
    digestMock.mockResolvedValue([digest()])
    render(<WeeklyGitDigest />)
    const row = await screen.findByRole('button', { name: /DevBrain/ })

    expect(screen.queryByText('Schema change')).not.toBeInTheDocument()
    fireEvent.click(row)
    expect(screen.getByText('Schema change')).toBeInTheDocument()
    expect(screen.getByText('Hardened notify auth')).toBeInTheDocument()
    expect(screen.getByText(/branches: main, feat\/x/)).toBeInTheDocument()
    fireEvent.click(row)
    expect(screen.queryByText('Schema change')).not.toBeInTheDocument()
  })

  it('drill-down: with a project selected the row is expanded, scoped, and not collapsible', async () => {
    digestMock.mockResolvedValue([digest()])
    render(<WeeklyGitDigest projectId="p1" />)

    expect(await screen.findByText('Schema change')).toBeInTheDocument()
    expect(digestMock).toHaveBeenCalledWith('2026-11-02', 'p1')
    expect(screen.queryByText(/commits across/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /DevBrain/ })).toBeDisabled()
  })

  it('navigates to the previous week and refetches; cannot go past the current week', async () => {
    render(<WeeklyGitDigest />)
    await waitFor(() => expect(digestMock).toHaveBeenCalledWith('2026-11-02', undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    await waitFor(() => expect(digestMock).toHaveBeenCalledWith('2026-10-26', undefined))

    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))   // → current week (2026-11-09)
    await waitFor(() => expect(digestMock).toHaveBeenCalledWith('2026-11-09', undefined))
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled()
  })

  it('shows an empty state with a Generate button when the week has no digest', async () => {
    render(<WeeklyGitDigest />)
    expect(await screen.findByText(/No digest for this week yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument()
  })

  it('shows the load error instead of crashing', async () => {
    digestMock.mockRejectedValue(new Error('Failed to reach the server'))
    render(<WeeklyGitDigest />)
    expect(await screen.findByText('Failed to reach the server')).toBeInTheDocument()
  })

  it('Generate posts for the shown week/project, then reloads the rows', async () => {
    digestMock.mockResolvedValueOnce([]).mockResolvedValueOnce([digest()])
    generateMock.mockResolvedValue({ digests: [digest()], errors: [] })
    render(<WeeklyGitDigest projectId="p1" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))

    expect(generateMock).toHaveBeenCalledWith('2026-11-02', 'p1')
    expect(await screen.findByText('A security-focused week.')).toBeInTheDocument()
    expect(digestMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces per-project generation errors', async () => {
    generateMock.mockResolvedValue({ digests: [], errors: [{ project_id: 'p1', project: 'QuantCru', error: 'ENOENT' }] })
    render(<WeeklyGitDigest />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('status')).toHaveTextContent('QuantCru: ENOENT')
  })

  it('tells the user to link a folder when nothing could be generated and nothing failed', async () => {
    generateMock.mockResolvedValue({ digests: [], errors: [] })
    render(<WeeklyGitDigest />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Link folder')
  })

  it('shows the server message when generate is rejected (e.g. cloud AI provider)', async () => {
    generateMock.mockRejectedValue(new Error('only runs with AI_PROVIDER=ollama'))
    render(<WeeklyGitDigest />)
    fireEvent.click(await screen.findByRole('button', { name: 'Generate' }))
    expect(await screen.findByRole('status')).toHaveTextContent('AI_PROVIDER=ollama')
    expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
  })
})

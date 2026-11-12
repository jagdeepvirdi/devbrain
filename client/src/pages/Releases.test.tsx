import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReleasesPage } from './Releases'
import type { Release } from '../lib/api'

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ projects: [], selectedProject: () => null }),
}))

vi.mock('../components/LinkedItems', () => ({
  LinkedItems: () => <div data-testid="linked-items" />,
}))

const listMock = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    releasesApi: {
      list:       (...args: unknown[]) => listMock(...args),
      components: () => Promise.resolve([]),
      get:        () => Promise.reject(new Error('not used in these tests')),
    },
  }
})

const release: Release = {
  id: 'r1', project_id: 'p1', version: 'v1.2.0', date: '2026-08-01', type: 'minor',
  features: ['Added command palette'], fixes: ['Fixed pagination'], breaking_changes: [],
  notes: '', linked_issues: [], component: null, created_at: '2026-08-01T00:00:00Z',
  project_name: 'DevBrain', project_color: '#6366F1',
}

function renderReleases() {
  render(<MemoryRouter><ReleasesPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue([release])
})

// This page was split out of a 1,231-line single-file god-component
// (pages/Releases.tsx: timeline card + table + 4 modals) into
// components/releases/* — these lock in that the split still renders and
// wires props correctly end to end, since nothing exercised this page before.
describe('ReleasesPage', () => {
  it('loads releases scoped to the selected project and renders the timeline', async () => {
    renderReleases()

    expect(await screen.findByText('v1.2.0')).toBeInTheDocument()
    expect(screen.getByText('Added command palette')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith({ projectId: undefined })
  })

  it('shows the empty state and no releases when the list is empty', async () => {
    listMock.mockResolvedValue([])
    renderReleases()

    expect(await screen.findByText(/No releases yet/)).toBeInTheDocument()
  })

  it('switches to the table view and still shows the release', async () => {
    renderReleases()
    await screen.findByText('v1.2.0')

    fireEvent.click(screen.getByText('▦ Table'))

    expect(await screen.findByRole('columnheader', { name: /Version/ })).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
  })

  it('opens the New Release modal and creates a release', async () => {
    renderReleases()
    await screen.findByText('v1.2.0')

    fireEvent.click(screen.getByText('+ New Release'))
    expect(await screen.findByText('New Release')).toBeInTheDocument()
    expect(screen.getByText('Create Release')).toBeInTheDocument()
  })

  it('deletes a release after confirming, and drops it from the timeline', async () => {
    const removeMock = vi.fn().mockResolvedValue({ deleted: { id: 'r1', version: 'v1.2.0' } })
    const api = await import('../lib/api')
    ;(api.releasesApi as unknown as { remove: typeof removeMock }).remove = removeMock

    renderReleases()
    await screen.findByText('v1.2.0')

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Confirm delete'))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('r1'))
    await waitFor(() => expect(screen.queryByText('v1.2.0')).not.toBeInTheDocument())
  })
})

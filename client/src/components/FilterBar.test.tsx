import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FilterBar, initialFilterState } from './FilterBar'
import type { FilterState } from './FilterBar'

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ projects: [], selectedId: undefined }),
}))

vi.mock('../lib/api', () => ({
  searchApi:    { getFilters: vi.fn().mockResolvedValue([]), saveFilter: vi.fn(), deleteFilter: vi.fn() },
  documentsApi: { components: vi.fn().mockResolvedValue([]) },
}))

function renderFilterBar(overrides: Partial<FilterState> = {}) {
  const onChange = vi.fn()
  const filters: FilterState = { ...initialFilterState, ...overrides }
  render(<FilterBar entityType="issues" filters={filters} onChange={onChange} />)
  return { onChange, filters }
}

describe('FilterBar', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens the filter panel and adds a status to an empty filter set', async () => {
    const { onChange } = renderFilterBar()

    fireEvent.click(screen.getByText('Filters'))
    fireEvent.click(await screen.findByText('Open'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: ['open'] }))
  })

  it('removes an already-active status instead of duplicating it', async () => {
    const { onChange } = renderFilterBar({ status: ['open', 'resolved'] })

    fireEvent.click(screen.getByText('Filters'))
    fireEvent.click(await screen.findByText('Open'))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: ['resolved'] }))
  })

  it('toggles priority independently of status', async () => {
    const { onChange } = renderFilterBar({ status: ['open'] })

    fireEvent.click(screen.getByText('Filters'))
    fireEvent.click(await screen.findByText('Critical'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ status: ['open'], priority: ['critical'] })
    )
  })

  it('clear all resets every field back to initialFilterState, not just the visible ones', async () => {
    const { onChange } = renderFilterBar({
      status: ['open'], priority: ['high'], tags: ['x'], dateFrom: '2026-01-01',
    })

    fireEvent.click(screen.getByText('Filters'))
    fireEvent.click(await screen.findByText('Clear all'))

    expect(onChange).toHaveBeenCalledWith(initialFilterState)
  })
})

describe('FilterBar — documents entity type', () => {
  beforeEach(() => vi.clearAllMocks())

  it('omits Status and Priority sections, since those only apply to issues', () => {
    const onChange = vi.fn()
    render(<FilterBar entityType="documents" filters={initialFilterState} onChange={onChange} />)

    fireEvent.click(screen.getByText('Filters'))

    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.queryByText('Priority')).not.toBeInTheDocument()
  })
})

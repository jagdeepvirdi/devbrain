import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CommandsPage } from './Commands'
import type { Command } from '../lib/api'

vi.mock('shiki', () => ({
  createHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: vi.fn(() => '<pre><code>highlighted</code></pre>'),
  }),
}))

const toastMock = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ projects: [], selectedProject: () => null }),
}))

const listMock       = vi.fn()
const facetsMock     = vi.fn()
const createMock     = vi.fn()
const updateMock     = vi.fn()
const removeMock     = vi.fn()
const useMock        = vi.fn()
const explainMock    = vi.fn()
const bulkMock       = vi.fn()
const componentsMock = vi.fn()
vi.mock('../lib/api', () => ({
  commandsApi: {
    list:       (...args: unknown[]) => listMock(...args),
    facets:     (...args: unknown[]) => facetsMock(...args),
    create:     (...args: unknown[]) => createMock(...args),
    update:     (...args: unknown[]) => updateMock(...args),
    remove:     (...args: unknown[]) => removeMock(...args),
    use:        (...args: unknown[]) => useMock(...args),
    explain:    (...args: unknown[]) => explainMock(...args),
    bulk:       (...args: unknown[]) => bulkMock(...args),
    components: (...args: unknown[]) => componentsMock(...args),
  },
}))

function makeCmd(overrides: Partial<Command> = {}): Command {
  return {
    id: 'cmd-1', project_id: null, title: 'Start Dev Server', command: 'npm run dev',
    language: 'bash', description: 'Runs the dev server', tags: ['dev'], component: null, is_favorite: false,
    namespace: 'team', created_by: null, last_used: null, explanation: null,
    created_at: '2026-01-01T00:00:00Z', project_name: null, project_color: null,
    ...overrides,
  }
}

function renderPage() {
  render(<MemoryRouter><CommandsPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue({ items: [makeCmd()], total: 1 })
  facetsMock.mockResolvedValue({ languages: [{ value: 'bash', count: 1 }], tags: [{ value: 'dev', count: 1 }] })
  useMock.mockResolvedValue(makeCmd())
  componentsMock.mockResolvedValue([])
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

describe('CommandsPage', () => {
  it('lists commands scoped to the current project', async () => {
    renderPage()
    expect(await screen.findByText('Start Dev Server')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined, limit: 25, offset: 0 }))
  })

  it('shows an empty state and a create shortcut when there are no commands', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    renderPage()
    expect(await screen.findByText('No commands yet')).toBeInTheDocument()
    expect(screen.getByText('+ Create your first command')).toBeInTheDocument()
  })

  it('debounces search input before re-querying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderPage()
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByPlaceholderText('Search…'), { target: { value: 'docker' } })
    expect(listMock).toHaveBeenCalledTimes(1) // not yet — still debouncing

    vi.advanceTimersByTime(300)
    await vi.waitFor(() => expect(listMock).toHaveBeenCalledTimes(2))
    expect(listMock).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'docker' }))
    vi.useRealTimers()
  })

  it('selecting a command shows its detail pane', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Start Dev Server'))
    expect(await screen.findByDisplayValue('Start Dev Server')).toBeInTheDocument()
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })

  it('toggles favorite from the list card without opening the detail pane', async () => {
    updateMock.mockResolvedValue(makeCmd({ is_favorite: true }))
    renderPage()
    await screen.findByText('Start Dev Server')

    fireEvent.click(screen.getByLabelText('Add to favorites'))

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('cmd-1', { is_favorite: true }))
    expect(screen.queryByDisplayValue('Start Dev Server')).not.toBeInTheDocument()
  })

  it('filters to favorites only', async () => {
    renderPage()
    await screen.findByText('Start Dev Server')
    listMock.mockClear()

    fireEvent.click(screen.getByText('★ Favorites'))

    await waitFor(() => expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ favorite: true })))
  })

  it('creates a new command via the modal', async () => {
    const created = makeCmd({ id: 'cmd-2', title: 'Build', command: 'npm run build' })
    createMock.mockResolvedValue(created)
    renderPage()
    await screen.findByText('Start Dev Server')

    fireEvent.click(screen.getByText('+ New'))
    fireEvent.change(screen.getByPlaceholderText('e.g. Start Dev Server'), { target: { value: 'Build' } })
    fireEvent.change(screen.getByPlaceholderText('e.g. npm run dev'), { target: { value: 'npm run build' } })
    fireEvent.click(screen.getByText('Save Command'))

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Build', command: 'npm run build', namespace: 'team',
    })))
    expect(await screen.findByDisplayValue('Build')).toBeInTheDocument()
  })

  it('requires a title and command before creating', async () => {
    renderPage()
    await screen.findByText('Start Dev Server')

    fireEvent.click(screen.getByText('+ New'))
    fireEvent.click(screen.getByText('Save Command'))

    expect(await screen.findByText('Title and command are required.')).toBeInTheDocument()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('edits the command title inline from the detail pane', async () => {
    updateMock.mockResolvedValue(makeCmd({ title: 'Renamed' }))
    renderPage()
    fireEvent.click(await screen.findByText('Start Dev Server'))

    const titleInput = await screen.findByDisplayValue('Start Dev Server')
    fireEvent.change(titleInput, { target: { value: 'Renamed' } })
    fireEvent.blur(titleInput)

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('cmd-1', { title: 'Renamed' }))
  })

  it('deletes a command after confirming', async () => {
    removeMock.mockResolvedValue({ deleted: { id: 'cmd-1', title: 'Start Dev Server' } })
    renderPage()
    fireEvent.click(await screen.findByText('Start Dev Server'))
    await screen.findByDisplayValue('Start Dev Server')

    fireEvent.click(screen.getByLabelText('Delete command'))
    fireEvent.click(screen.getByLabelText('Confirm delete command'))

    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('cmd-1'))
  })

  it('selects all and bulk-deletes commands after confirming', async () => {
    listMock.mockResolvedValue({ items: [makeCmd(), makeCmd({ id: 'cmd-2', title: 'Second' })], total: 2 })
    bulkMock.mockResolvedValue({ success: true })
    renderPage()
    await screen.findByText('Start Dev Server')

    const selectAllCheckbox = screen.getByText('Select all').previousElementSibling as HTMLElement
    fireEvent.click(selectAllCheckbox)
    expect(await screen.findByText('2 selected')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Delete'))
    fireEvent.click(screen.getByText('Confirm'))

    await waitFor(() => expect(bulkMock).toHaveBeenCalledWith(['cmd-1', 'cmd-2'], 'delete'))
    await waitFor(() => expect(screen.queryByText('Second')).not.toBeInTheDocument())
  })

  it('imports commands parsed from an uploaded shell file', async () => {
    createMock.mockResolvedValue(makeCmd({ id: 'cmd-3', title: 'Deploy' }))
    renderPage()
    await screen.findByText('Start Dev Server')

    const file = new File(['#!/bin/bash\n# Deploy\necho deploying\n'], 'commands.sh', { type: 'text/x-sh' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    await fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => expect(createMock).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Deploy', command: 'echo deploying', language: 'bash',
    })))
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith('Imported 1 command', 'success'))
  })

  it('opens the command palette, searches, and copies the selected command', async () => {
    listMock.mockImplementation(() => Promise.resolve({ items: [makeCmd()], total: 1 }))
    renderPage()
    await screen.findByText('Start Dev Server')

    fireEvent.click(screen.getByText('Quick copy'))
    const dialogInput = await screen.findByPlaceholderText('Search commands…')
    fireEvent.change(dialogInput, { target: { value: 'dev' } })

    // "npm run dev" also appears in the background list card (present immediately); the
    // palette's own (debounced, async) result only shows up once its search resolves, so wait
    // for both to exist before assuming the second match is the palette's clickable row.
    await waitFor(() => expect(screen.getAllByText('npm run dev').length).toBeGreaterThanOrEqual(2))
    const matches = screen.getAllByText('npm run dev')
    const paletteRow = matches[matches.length - 1].parentElement?.parentElement as HTMLElement
    fireEvent.click(paletteRow)

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('npm run dev'))
    await waitFor(() => expect(useMock).toHaveBeenCalledWith('cmd-1'))
  })
})

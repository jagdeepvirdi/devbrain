import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FilesTab from './FilesTab'
import type { ProjectFileEntry } from '../../lib/api'

const listMock = vi.fn()
vi.mock('../../lib/api', () => ({
  projectFilesApi: { list: (...args: unknown[]) => listMock(...args) },
}))

// The editor overlay itself is covered by its own test file — stub it out here so
// FilesTab's tests focus on listing/navigation, and expose enough props to assert
// FilesTab opened it for the right file.
vi.mock('./ProjectFileEditorOverlay', () => ({
  ProjectFileEditorOverlay: ({ filePath }: { filePath: string }) => <div data-testid="editor-overlay">{filePath}</div>,
}))

const rootItems: ProjectFileEntry[] = [
  { name: 'src', type: 'dir' },
  { name: 'README.md', type: 'file', size: 512 },
]
const srcItems: ProjectFileEntry[] = [
  { name: 'index.ts', type: 'file', size: 128 },
]

describe('FilesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockImplementation((_projectId: string, dirPath = '') =>
      Promise.resolve(dirPath === 'src' ? { path: 'src', items: srcItems } : { path: '', items: rootItems })
    )
  })

  it('lists the project root on mount', async () => {
    render(<FilesTab projectId="proj-1" />)

    expect(await screen.findByText('README.md')).toBeInTheDocument()
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith('proj-1', '')
  })

  it('clicking a directory descends into it and updates the breadcrumb', async () => {
    render(<FilesTab projectId="proj-1" />)
    await screen.findByText('src')

    fireEvent.click(screen.getByText('src'))

    expect(await screen.findByText('index.ts')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith('proj-1', 'src')
    expect(screen.getByText('root')).toBeInTheDocument()
  })

  it('clicking a file opens the editor overlay for that path', async () => {
    render(<FilesTab projectId="proj-1" />)
    await screen.findByText('README.md')

    fireEvent.click(screen.getByText('README.md'))

    expect(await screen.findByTestId('editor-overlay')).toHaveTextContent('README.md')
  })

  it('shows the server error message when listing fails', async () => {
    listMock.mockRejectedValueOnce(new Error('Project has no linked local path'))
    render(<FilesTab projectId="proj-1" />)

    expect(await screen.findByText('Project has no linked local path')).toBeInTheDocument()
  })

  it('shows an empty-directory message when there are no items', async () => {
    listMock.mockResolvedValueOnce({ path: '', items: [] })
    render(<FilesTab projectId="proj-1" />)

    expect(await screen.findByText('Empty directory.')).toBeInTheDocument()
  })
})

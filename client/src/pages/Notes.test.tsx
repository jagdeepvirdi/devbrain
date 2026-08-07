import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { NotesPage } from './Notes'
import type { DocDetail, DocMeta } from '../lib/api'

const toastMock = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ selectedId: undefined }),
}))

vi.mock('../components/LinkedItems', () => ({
  LinkedItems: () => <div data-testid="linked-items" />,
}))

// Stub the real (CodeMirror-backed, separately tested) editor overlay so these tests focus
// on NotesPage's own list/create logic, and can assert on what props it was opened with.
vi.mock('../components/codes/CodeEditorOverlay', () => ({
  CodeEditorOverlay: ({ doc, startInEditMode, onClose }: { doc: DocDetail; startInEditMode?: boolean; onClose: () => void }) => (
    <div data-testid="editor-overlay" data-start-edit={String(!!startInEditMode)} data-doc-title={doc.title}>
      <button onClick={onClose}>close-editor</button>
    </div>
  ),
}))

const listMock       = vi.fn()
const getMock        = vi.fn()
const createNoteMock = vi.fn()
const removeMock     = vi.fn()
vi.mock('../lib/api', () => ({
  documentsApi: {
    list:       (...args: unknown[]) => listMock(...args),
    get:        (...args: unknown[]) => getMock(...args),
    createNote: (...args: unknown[]) => createNoteMock(...args),
    remove:     (...args: unknown[]) => removeMock(...args),
  },
}))

const noteA: DocMeta = {
  id: 'note-1', project_id: null, title: 'Groceries', file_type: 'note', tags: ['home'], component: null,
  language: 'markdown', source: 'note', content_hash: 'h1', embedding_status: 'done',
  created_at: '2026-01-01T00:00:00Z', content_length: 20, chunk_count: 1,
  explanation_stale: false, diagram_stale: false, project_name: null, project_color: null,
}

function renderNotes() {
  render(<MemoryRouter><NotesPage /></MemoryRouter>)
}

describe('NotesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listMock.mockResolvedValue({ items: [noteA], total: 1 })
    getMock.mockResolvedValue({
      ...noteA, content: 'milk, eggs', explanation: null, diagram: null,
      source_document_id: null, linked_explanation_id: null, linked_explanation_title: null,
    })
  })

  it('lists notes scoped to file_type=note', async () => {
    renderNotes()

    expect(await screen.findByText('Groceries')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ fileType: ['note'] }))
  })

  it('does not allow creating a note with a blank title', async () => {
    renderNotes()
    await screen.findByText('Groceries')

    fireEvent.click(screen.getByText('New note'))
    expect(screen.getByText('Create & write')).toBeDisabled()
    expect(createNoteMock).not.toHaveBeenCalled()
  })

  it('creating a note calls createNote and opens the editor straight into edit mode', async () => {
    const created: DocDetail = {
      ...noteA, id: 'note-2', title: 'New idea', tags: [], content: '', explanation: null, diagram: null,
      source_document_id: null, linked_explanation_id: null, linked_explanation_title: null,
    }
    createNoteMock.mockResolvedValue(created)

    renderNotes()
    await screen.findByText('Groceries')

    fireEvent.click(screen.getByText('New note'))
    fireEvent.change(screen.getByPlaceholderText('Quick note title…'), { target: { value: 'New idea' } })
    fireEvent.click(screen.getByText('Create & write'))

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledWith('New idea', '', undefined, []))

    const overlay = await screen.findByTestId('editor-overlay')
    expect(overlay).toHaveAttribute('data-start-edit', 'true')
    expect(overlay).toHaveAttribute('data-doc-title', 'New idea')
    // The modal closes once creation succeeds.
    expect(screen.queryByText('Create & write')).not.toBeInTheDocument()
  })

  it('parses comma-separated tags on creation', async () => {
    const created: DocDetail = {
      ...noteA, id: 'note-3', title: 'Tagged', content: '', explanation: null, diagram: null,
      source_document_id: null, linked_explanation_id: null, linked_explanation_title: null,
    }
    createNoteMock.mockResolvedValue(created)

    renderNotes()
    await screen.findByText('Groceries')

    fireEvent.click(screen.getByText('New note'))
    fireEvent.change(screen.getByPlaceholderText('Quick note title…'), { target: { value: 'Tagged' } })
    fireEvent.change(screen.getByPlaceholderText('idea, meeting, todo'), { target: { value: ' idea, meeting ,todo ' } })
    fireEvent.click(screen.getByText('Create & write'))

    await waitFor(() => expect(createNoteMock).toHaveBeenCalledWith('Tagged', '', undefined, ['idea', 'meeting', 'todo']))
  })
})

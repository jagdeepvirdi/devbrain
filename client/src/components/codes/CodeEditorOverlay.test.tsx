import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CodeEditorOverlay } from './CodeEditorOverlay'
import type { DocDetail } from '../../lib/api'

const toastMock = vi.fn()
vi.mock('../Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

const updateContentTextMock = vi.fn()
vi.mock('../../lib/api', () => ({
  documentsApi: { updateContentText: (...args: unknown[]) => updateContentTextMock(...args) },
}))

const toggleListPrefixMock = vi.fn()
vi.mock('./listFormatting', () => ({
  toggleListPrefix: (...args: unknown[]) => toggleListPrefixMock(...args),
}))

// Stub the real CodeMirror-backed editor with a plain textarea so these tests exercise
// CodeEditorOverlay's own logic (dirty tracking, save, drafts, keyboard shortcuts, and the
// view/edit mode switch) without mounting CodeMirror/language-data in jsdom. `readOnly` is
// forwarded onto the textarea itself so tests can assert the overlay is actually passing it
// through correctly, and the ref exposes a fake `view.focus()` matching the real component's
// imperative handle shape.
vi.mock('./CodeEditor', () => ({
  CodeEditor: forwardRef(function MockCodeEditor(
    { value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean },
    ref
  ) {
    useImperativeHandle(ref, () => ({ view: { focus: vi.fn() } }))
    return <textarea aria-label="code" value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />
  }),
}))

const baseDoc: DocDetail = {
  id: 'doc-1', project_id: null, title: 'index.ts', file_type: 'code', tags: [], component: null,
  language: 'typescript', source: 'index.ts', content_hash: 'abc', embedding_status: 'done',
  created_at: '2026-01-01T00:00:00Z', content_length: 11, chunk_count: 1,
  explanation_stale: false, diagram_stale: false, project_name: null, project_color: null,
  content: 'const a = 1', explanation: null, diagram: null,
  source_document_id: null, linked_explanation_id: null, linked_explanation_title: null,
}

const noteDoc: DocDetail = {
  ...baseDoc, id: 'note-1', title: 'Scratchpad', file_type: 'note', language: 'markdown', source: 'note',
  content: '- foo',
}

function draftKey(id: string) { return `devbrain:draft:${id}` }

function enterEditMode() {
  fireEvent.click(screen.getByText('Edit'))
}

describe('CodeEditorOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens read-only: shows an Edit button, a read-only badge, and a read-only textarea, with no Save controls', () => {
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByText('index.ts')).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.getByText('Edit')).toBeInTheDocument()
    expect(screen.getByLabelText('code')).toHaveAttribute('readonly')
    expect(screen.queryByText(/^Save/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/autosave/i)).not.toBeInTheDocument()
  })

  it('startInEditMode opens straight into edit mode, skipping the read-only step', () => {
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} startInEditMode />)

    expect(screen.queryByText('read-only')).not.toBeInTheDocument()
    expect(screen.queryByText('Edit')).not.toBeInTheDocument()
    expect(screen.getByLabelText('code')).not.toHaveAttribute('readonly')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText(/autosave/i)).toBeInTheDocument()
  })

  it('clicking Edit switches to edit mode: textarea becomes writable and Save controls appear', () => {
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)

    enterEditMode()

    expect(screen.queryByText('read-only')).not.toBeInTheDocument()
    expect(screen.getByLabelText('code')).not.toHaveAttribute('readonly')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText(/autosave/i)).toBeInTheDocument()
  })

  it('marks dirty and enables Save once the content changes in edit mode', () => {
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    enterEditMode()

    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'const a = 2' } })
    expect(screen.getByText('Save (Ctrl+S)')).toBeInTheDocument()
  })

  it('saves via the Save button and calls onSaved with the updated doc', async () => {
    const updated = { ...baseDoc, content: 'const a = 2', embedding_status: 'processing' as const }
    updateContentTextMock.mockResolvedValue(updated)
    const onSaved = vi.fn()

    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={onSaved} />)
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'const a = 2' } })
    fireEvent.click(screen.getByText('Save (Ctrl+S)'))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(updated))
    expect(updateContentTextMock).toHaveBeenCalledWith('doc-1', 'const a = 2')
    expect(screen.getByText('Saved')).toBeInTheDocument()
  })

  it('saves via Ctrl+S', async () => {
    updateContentTextMock.mockResolvedValue({ ...baseDoc, content: 'const a = 3' })
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'const a = 3' } })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(updateContentTextMock).toHaveBeenCalledWith('doc-1', 'const a = 3'))
  })

  it('closes immediately on Escape while still read-only (nothing to lose)', () => {
    const onClose = vi.fn()
    render(<CodeEditorOverlay doc={baseDoc} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('the ← Codes back button closes immediately while read-only', () => {
    const onClose = vi.fn()
    render(<CodeEditorOverlay doc={baseDoc} onClose={onClose} onSaved={vi.fn()} />)
    fireEvent.click(screen.getByText('← Codes'))
    expect(onClose).toHaveBeenCalled()
  })

  it('the ← Codes back button asks for confirmation when there are unsaved changes', () => {
    const onClose = vi.fn()
    render(<CodeEditorOverlay doc={baseDoc} onClose={onClose} onSaved={vi.fn()} />)
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'dirty' } })

    fireEvent.click(screen.getByText('← Codes'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()
  })

  it('asks for confirmation on Escape when there are unsaved changes, and only closes once confirmed', () => {
    const onClose = vi.fn()
    render(<CodeEditorOverlay doc={baseDoc} onClose={onClose} onSaved={vi.fn()} />)
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'dirty' } })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close without saving'))
    expect(onClose).toHaveBeenCalled()
  })

  it('offers to restore a newer local draft found on open, and restoring loads it and enters edit mode', () => {
    localStorage.setItem(draftKey('doc-1'), JSON.stringify({ content: 'draft content', savedAt: Date.now() }))
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.getByText(/unsaved draft/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Restore'))

    expect(screen.getByLabelText('code')).toHaveValue('draft content')
    expect(screen.getByLabelText('code')).not.toHaveAttribute('readonly')
    expect(screen.getByText('Save (Ctrl+S)')).toBeInTheDocument()
  })

  it('discarding the draft banner clears the stored draft and stays read-only', () => {
    localStorage.setItem(draftKey('doc-1'), JSON.stringify({ content: 'draft content', savedAt: Date.now() }))
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)

    fireEvent.click(screen.getByText('Discard'))

    expect(localStorage.getItem(draftKey('doc-1'))).toBeNull()
    expect(screen.getByText('read-only')).toBeInTheDocument()
  })

  it('does not offer a draft that matches the already-loaded content', () => {
    localStorage.setItem(draftKey('doc-1'), JSON.stringify({ content: baseDoc.content, savedAt: Date.now() }))
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(screen.queryByText(/unsaved draft/i)).not.toBeInTheDocument()
  })

  it('autosaves after the debounce once the toggle is enabled', async () => {
    vi.useFakeTimers()
    updateContentTextMock.mockResolvedValue({ ...baseDoc, content: 'auto' })
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    enterEditMode()

    fireEvent.click(screen.getByLabelText(/autosave/i))
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'auto' } })

    await vi.advanceTimersByTimeAsync(3000)

    expect(updateContentTextMock).toHaveBeenCalledWith('doc-1', 'auto')
  })

  it('does not autosave while the toggle is off', async () => {
    vi.useFakeTimers()
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    enterEditMode()

    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'manual only' } })

    await vi.advanceTimersByTimeAsync(5000)

    expect(updateContentTextMock).not.toHaveBeenCalled()
  })

  it('does not show the list toolbar for non-note docs, even in edit mode', () => {
    render(<CodeEditorOverlay doc={baseDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    enterEditMode()
    expect(screen.queryByTitle('Toggle bullet list')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Toggle numbered list')).not.toBeInTheDocument()
  })

  it('shows the list toolbar for notes only once in edit mode', () => {
    render(<CodeEditorOverlay doc={noteDoc} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.queryByTitle('Toggle bullet list')).not.toBeInTheDocument()

    enterEditMode()
    expect(screen.getByTitle('Toggle bullet list')).toBeInTheDocument()
    expect(screen.getByTitle('Toggle numbered list')).toBeInTheDocument()
  })

  it('the toolbar buttons dispatch the matching list toggle against the live editor view', () => {
    render(<CodeEditorOverlay doc={noteDoc} onClose={vi.fn()} onSaved={vi.fn()} startInEditMode />)

    fireEvent.click(screen.getByTitle('Toggle bullet list'))
    expect(toggleListPrefixMock).toHaveBeenLastCalledWith(expect.anything(), 'bullet')

    fireEvent.click(screen.getByTitle('Toggle numbered list'))
    expect(toggleListPrefixMock).toHaveBeenLastCalledWith(expect.anything(), 'numbered')
  })
})

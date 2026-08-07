import { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ProjectFileEditorOverlay } from './ProjectFileEditorOverlay'

const toastMock = vi.fn()
vi.mock('../Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

const getContentMock   = vi.fn()
const writeContentMock = vi.fn()
vi.mock('../../lib/api', () => ({
  projectFilesApi: {
    getContent:   (...args: unknown[]) => getContentMock(...args),
    writeContent: (...args: unknown[]) => writeContentMock(...args),
  },
}))

// Same stub strategy as CodeEditorOverlay.test.tsx — a plain textarea standing in for
// the real CodeMirror-backed editor, so these tests exercise this overlay's own
// fetch/save/dirty/draft logic without mounting CodeMirror in jsdom.
vi.mock('../codes/CodeEditor', () => ({
  CodeEditor: forwardRef(function MockCodeEditor(
    { value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly?: boolean },
    ref
  ) {
    useImperativeHandle(ref, () => ({ view: { focus: vi.fn() } }))
    return <textarea aria-label="code" value={value} readOnly={readOnly} onChange={e => onChange(e.target.value)} />
  }),
}))

function draftKey(projectId: string, filePath: string) { return `devbrain:pf-draft:${projectId}:${filePath}` }

function enterEditMode() {
  fireEvent.click(screen.getByText('Edit'))
}

describe('ProjectFileEditorOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getContentMock.mockResolvedValue({ path: 'src/index.ts', content: 'const a = 1', size: 11 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches content on open and renders read-only by default', async () => {
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)

    expect(await screen.findByText('src/index.ts')).toBeInTheDocument()
    expect(getContentMock).toHaveBeenCalledWith('proj-1', 'src/index.ts')
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.getByLabelText('code')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('code')).toHaveValue('const a = 1')
  })

  it('shows the server error with a Close button when the file fails to load', async () => {
    getContentMock.mockRejectedValue(new Error('This looks like a binary file — cannot open as text'))
    const onClose = vi.fn()
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="image.png" onClose={onClose} />)

    expect(await screen.findByText(/binary file/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalled()
  })

  it('clicking Edit switches to edit mode and reveals Save controls', async () => {
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await screen.findByText('src/index.ts')

    enterEditMode()

    expect(screen.queryByText('read-only')).not.toBeInTheDocument()
    expect(screen.getByLabelText('code')).not.toHaveAttribute('readonly')
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText(/autosave/i)).toBeInTheDocument()
  })

  it('saves via the Save button, writing to disk through projectFilesApi', async () => {
    writeContentMock.mockResolvedValue({ path: 'src/index.ts', size: 20 })
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await screen.findByText('src/index.ts')
    enterEditMode()

    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'const a = 2' } })
    fireEvent.click(screen.getByText('Save to disk (Ctrl+S)'))

    await waitFor(() => expect(writeContentMock).toHaveBeenCalledWith('proj-1', 'src/index.ts', 'const a = 2'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('saves via Ctrl+S', async () => {
    writeContentMock.mockResolvedValue({ path: 'src/index.ts', size: 20 })
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await screen.findByText('src/index.ts')
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'const a = 3' } })

    fireEvent.keyDown(window, { key: 's', ctrlKey: true })

    await waitFor(() => expect(writeContentMock).toHaveBeenCalledWith('proj-1', 'src/index.ts', 'const a = 3'))
  })

  it('asks for confirmation on Escape / the back link when there are unsaved changes, and only closes once confirmed', async () => {
    const onClose = vi.fn()
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={onClose} />)
    await screen.findByText('src/index.ts')
    enterEditMode()
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'dirty' } })

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard unsaved changes?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Close without saving'))
    expect(onClose).toHaveBeenCalled()
  })

  it('the ← Files back link closes immediately while read-only', async () => {
    const onClose = vi.fn()
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={onClose} />)
    await screen.findByText('src/index.ts')

    fireEvent.click(screen.getByText('← Files'))
    expect(onClose).toHaveBeenCalled()
  })

  it('offers to restore a local draft left over from a previous session, and restoring enters edit mode', async () => {
    localStorage.setItem(draftKey('proj-1', 'src/index.ts'), JSON.stringify({ content: 'draft content', savedAt: Date.now() }))
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await screen.findByText('src/index.ts')

    expect(screen.getByText(/unsaved draft/i)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Restore'))

    expect(screen.getByLabelText('code')).toHaveValue('draft content')
    expect(screen.getByLabelText('code')).not.toHaveAttribute('readonly')
  })

  it('does not offer a draft that matches the freshly-loaded content', async () => {
    localStorage.setItem(draftKey('proj-1', 'src/index.ts'), JSON.stringify({ content: 'const a = 1', savedAt: Date.now() }))
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await screen.findByText('src/index.ts')

    expect(screen.queryByText(/unsaved draft/i)).not.toBeInTheDocument()
  })

  it('autosaves after the debounce once the toggle is enabled', async () => {
    vi.useFakeTimers()
    writeContentMock.mockResolvedValue({ path: 'src/index.ts', size: 4 })
    render(<ProjectFileEditorOverlay projectId="proj-1" filePath="src/index.ts" onClose={vi.fn()} />)
    await vi.waitFor(() => expect(screen.getByText('src/index.ts')).toBeInTheDocument())
    enterEditMode()

    fireEvent.click(screen.getByLabelText(/autosave/i))
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'auto' } })

    await vi.advanceTimersByTimeAsync(3000)

    expect(writeContentMock).toHaveBeenCalledWith('proj-1', 'src/index.ts', 'auto')
  })
})

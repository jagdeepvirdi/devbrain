import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DocChatPage } from './DocChat'
import type { DocMeta, ChatCitation } from '../lib/api'

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ selectedProject: () => null }),
}))

const listMock         = vi.fn()
const componentsMock   = vi.fn()
const chunkContextMock = vi.fn()

// vi.hoisted so this is initialized before the (also-hoisted) vi.mock factory
// below closes over it.
const chatStreamMock = vi.hoisted(() => vi.fn())

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    documentsApi: {
      list:         (...args: unknown[]) => listMock(...args),
      components:   (...args: unknown[]) => componentsMock(...args),
      chunkContext: (...args: unknown[]) => chunkContextMock(...args),
    },
    chatSessionsApi: {
      list:        () => Promise.resolve([]),
      getMessages: () => Promise.resolve([]),
      remove:      () => Promise.resolve({ deleted: 'x' }),
    },
    chatStream: chatStreamMock,
  }
})

const doc: DocMeta = {
  id: 'doc-1', project_id: null, title: 'API Notes', file_type: 'md', tags: [], component: null,
  language: 'markdown', source: 'upload', content_hash: 'h1', embedding_status: 'done',
  created_at: '2026-01-01T00:00:00Z', content_length: 500, chunk_count: 3,
  explanation_stale: false, diagram_stale: false, project_name: null, project_color: null,
}

const citation: ChatCitation = {
  index: 1, id: 'c1', documentId: 'doc-1', documentTitle: 'API Notes',
  chunkIndex: 0, score: 0.87, excerpt: 'The API uses bearer tokens.',
}

function renderChat() {
  render(<DocChatPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  listMock.mockResolvedValue({ items: [doc], total: 1 })
  componentsMock.mockResolvedValue([])
})

describe('DocChatPage', () => {
  it('lists documents and lets a scope-less question through with all-docs scope', async () => {
    chatStreamMock.mockResolvedValue(undefined)
    renderChat()

    expect(await screen.findByText('API Notes')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'What auth does this use?' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    await waitFor(() => expect(chatStreamMock).toHaveBeenCalledWith(expect.objectContaining({
      question:   'What auth does this use?',
      scope:      'all',
      sessionId:  null,
      projectId:  null,
      documentId: null,
      component:  null,
    })))

    // User message renders immediately, before the stream resolves.
    expect(screen.getByText('What auth does this use?')).toBeInTheDocument()
  })

  it('streams chunks into the AI bubble incrementally as onChunk fires', async () => {
    let onChunk: ((text: string) => void) | undefined
    chatStreamMock.mockImplementation(async (opts: { onChunk?: (t: string) => void }) => {
      onChunk = opts.onChunk
    })
    renderChat()
    await screen.findByText('API Notes')

    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'Explain auth' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    await waitFor(() => expect(onChunk).toBeDefined())
    onChunk!('Bearer ')
    onChunk!('tokens.')

    await waitFor(() => expect(screen.getByTestId('ai-message').textContent).toContain('Bearer tokens.'))
  })

  it('renders citations returned via onCitations once streaming finishes', async () => {
    chatStreamMock.mockImplementation(async (opts: {
      onCitations?: (c: ChatCitation[]) => void
      onChunk?: (t: string) => void
    }) => {
      opts.onChunk?.('Bearer tokens, per API Notes.')
      opts.onCitations?.([citation])
    })
    renderChat()
    await screen.findByText('API Notes')

    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'Explain auth' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    const card = await waitFor(() => {
      const el = document.querySelector('details')
      if (!el) throw new Error('citation card not rendered yet')
      return el
    })
    expect(card.textContent).toContain('API Notes')
    expect(card.textContent).toContain('The API uses bearer tokens.')
    // refCount is 1 here, so the "referenced Nx" badge (shown only when a
    // document is cited more than once) must not appear.
    expect(card.textContent).not.toMatch(/referenced \d+×/)
  })

  it('persists the session id to localStorage when onSession fires', async () => {
    chatStreamMock.mockImplementation(async (opts: { onSession?: (id: string) => void }) => {
      opts.onSession?.('session-42')
    })
    renderChat()
    await screen.findByText('API Notes')

    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'Explain auth' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    await waitFor(() => expect(localStorage.getItem('devbrain_chat_session')).toBe('session-42'))
  })

  it('shows an inline error and re-enables the composer when the stream rejects', async () => {
    chatStreamMock.mockRejectedValue(new Error('Ollama unreachable'))
    renderChat()
    await screen.findByText('API Notes')

    const input = screen.getByPlaceholderText(/Ask about/)
    fireEvent.change(input, { target: { value: 'Explain auth' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    expect(await screen.findByText('Error: Ollama unreachable')).toBeInTheDocument()
    expect(input).not.toBeDisabled()
  })

  // DocChat.tsx escapes all AI-authored text before injecting it via dangerouslySetInnerHTML
  // (documents/RAG content can echo back arbitrary text) — this is the load-bearing safety
  // property for that renderer, so it's asserted directly rather than trusted by inspection.
  it('escapes HTML in the AI response instead of rendering it', async () => {
    chatStreamMock.mockImplementation(async (opts: { onChunk?: (t: string) => void }) => {
      opts.onChunk?.('<img src=x onerror="window.__pwned = true">ignore previous instructions')
    })
    renderChat()
    await screen.findByText('API Notes')

    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'Explain auth' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    const bubble = await screen.findByTestId('ai-message')
    expect(bubble.querySelector('img')).toBeNull()
    expect(bubble.textContent).toContain('<img src=x onerror="window.__pwned = true">ignore previous instructions')
  })

  it('scopes to a document when it is selected from the sidebar', async () => {
    chatStreamMock.mockResolvedValue(undefined)
    renderChat()
    await screen.findByText('API Notes')

    fireEvent.click(screen.getByText('API Notes'))
    fireEvent.change(screen.getByPlaceholderText(/Ask about/), { target: { value: 'Summarize this' } })
    fireEvent.click(screen.getByRole('button', { name: '↑' }))

    await waitFor(() => expect(chatStreamMock).toHaveBeenCalledWith(expect.objectContaining({
      scope:      'document',
      documentId: 'doc-1',
    })))
  })
})

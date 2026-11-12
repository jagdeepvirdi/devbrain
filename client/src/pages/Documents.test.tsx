import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DocumentsPage } from './Documents'
import type { DocMeta } from '../lib/api'

const toastMock = vi.fn()
vi.mock('../components/Toast', () => ({ useToast: () => ({ toast: toastMock }) }))

vi.mock('../store/projectStore', () => ({
  useProjectStore: () => ({ selectedId: undefined }),
}))

const listMock       = vi.fn()
const componentsMock = vi.fn()
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    documentsApi: {
      list:       (...args: unknown[]) => listMock(...args),
      components: (...args: unknown[]) => componentsMock(...args),
    },
  }
})

const doc: DocMeta = {
  id: 'doc-1', project_id: null, title: 'API Notes', file_type: 'md', tags: [], component: null,
  language: 'markdown', source: 'upload', content_hash: 'h1', embedding_status: 'done',
  created_at: '2026-08-01T00:00:00Z', content_length: 500, chunk_count: 3,
  explanation_stale: false, diagram_stale: false, project_name: null, project_color: null,
}

function renderDocuments() {
  render(<MemoryRouter><DocumentsPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue({ items: [doc], total: 1 })
  componentsMock.mockResolvedValue([])
})

// Smoke coverage backfilled for the tech-debt audit (2026-08-17) — this page
// (upload/import, filterable table, bulk actions) had zero tests before.
describe('DocumentsPage', () => {
  it('loads and lists documents in the table', async () => {
    renderDocuments()

    expect(await screen.findByText('API Notes')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ projectId: undefined }))
  })

  it('shows the empty state when there are no documents', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    renderDocuments()

    expect(await screen.findByText('No documents yet.')).toBeInTheDocument()
  })
})

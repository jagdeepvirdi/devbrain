import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { CodesPage } from './Codes'
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

const codeDoc: DocMeta = {
  id: 'doc-1', project_id: null, title: 'auth.service.ts', file_type: 'code', tags: [], component: null,
  language: 'typescript', source: 'upload', content_hash: 'h1', embedding_status: 'done',
  created_at: '2026-08-01T00:00:00Z', content_length: 800, chunk_count: 2,
  explanation_stale: false, diagram_stale: false, project_name: null, project_color: null,
}

function renderCodes() {
  render(<MemoryRouter><CodesPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  listMock.mockResolvedValue({ items: [codeDoc], total: 1 })
  componentsMock.mockResolvedValue([])
})

// Smoke coverage backfilled for the tech-debt audit (2026-08-17) — this page
// (code file browser, scoped to file_type='code') had zero tests before.
describe('CodesPage', () => {
  it('loads and lists code files scoped to file_type=code', async () => {
    renderCodes()

    expect(await screen.findByText('auth.service.ts')).toBeInTheDocument()
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ fileType: ['code'] }))
  })

  it('shows the empty state when no code files are tracked', async () => {
    listMock.mockResolvedValue({ items: [], total: 0 })
    renderCodes()

    expect(await screen.findByText('No code files tracked yet.')).toBeInTheDocument()
  })
})

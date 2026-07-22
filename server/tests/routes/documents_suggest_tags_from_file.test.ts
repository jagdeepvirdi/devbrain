import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../db/pool.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}))

vi.mock('../../services/parser.js', () => ({
  parseFile: vi.fn(),
  parseUrl:  vi.fn(),
}))

vi.mock('../../services/embedder.js', () => ({
  embedDocument: vi.fn(),
  searchChunks:  vi.fn(),
}))

vi.mock('../../services/ai.js', () => ({
  aiChat:  vi.fn(),
  aiEmbed: vi.fn(),
}))

import documentsRouter from '../../routes/documents.js'
import { parseFile } from '../../services/parser.js'
import { aiChat } from '../../services/ai.js'

const mockParseFile = vi.mocked(parseFile)
const mockAiChat    = vi.mocked(aiChat)

function getHandler(routePath: string) {
  const layer = (documentsRouter as any).stack.find(
    (s: any) => s.route?.path === routePath && s.route.methods.post
  )
  return layer.route.stack[layer.route.stack.length - 1].handle
}

function fakeRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis() } as any
}

describe('POST /api/documents/suggest-tags-from-file', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses the real file content and returns AI-suggested tags, without inserting a document', async () => {
    mockParseFile.mockResolvedValue({ text: 'SAP invoice interface design document', fileType: 'docx', title: 'sap-doc' })
    mockAiChat.mockResolvedValue('["sap","invoice","billing"]')

    const req: any = { file: { path: '/tmp/fake', originalname: 'sap-doc.docx' } }
    const res = fakeRes()

    await getHandler('/suggest-tags-from-file')(req, res, () => {})

    expect(mockParseFile).toHaveBeenCalledWith('/tmp/fake', 'sap-doc.docx')
    expect(mockAiChat).toHaveBeenCalledWith(
      expect.stringContaining('SAP invoice interface design document'),
      expect.any(String)
    )
    expect(res.json).toHaveBeenCalledWith({ data: { tags: ['sap', 'invoice', 'billing'] } })
  })

  it('returns 400 when no file is uploaded', async () => {
    const req: any = { file: undefined }
    const res = fakeRes()

    await getHandler('/suggest-tags-from-file')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(400)
    expect(mockParseFile).not.toHaveBeenCalled()
  })

  it('returns 422 when the file has no extractable text', async () => {
    mockParseFile.mockResolvedValue({ text: '', fileType: 'txt', title: 'empty' })

    const req: any = { file: { path: '/tmp/fake', originalname: 'empty.txt' } }
    const res = fakeRes()

    await getHandler('/suggest-tags-from-file')(req, res, () => {})

    expect(res.status).toHaveBeenCalledWith(422)
    expect(mockAiChat).not.toHaveBeenCalled()
  })

  it('returns an empty tags array when the AI response has no parseable JSON array', async () => {
    mockParseFile.mockResolvedValue({ text: 'some content', fileType: 'txt', title: 'doc' })
    mockAiChat.mockResolvedValue('sorry, I cannot help with that')

    const req: any = { file: { path: '/tmp/fake', originalname: 'doc.txt' } }
    const res = fakeRes()

    await getHandler('/suggest-tags-from-file')(req, res, () => {})

    expect(res.json).toHaveBeenCalledWith({ data: { tags: [] } })
  })

  it('responds 500 on a failure', async () => {
    mockParseFile.mockRejectedValueOnce(new Error('parse boom'))
    const req: any = { file: { path: '/tmp/fake', originalname: 'doc.txt' } }
    const res = fakeRes()
    await getHandler('/suggest-tags-from-file')(req, res, () => {})
    expect(res.status).toHaveBeenCalledWith(500)
  })
})

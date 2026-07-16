import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockTokenizer = vi.fn((_query: string, _opts: unknown) => ({ mocked: true }))
const mockModel     = vi.fn()

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: vi.fn().mockResolvedValue(mockTokenizer) },
  AutoModelForSequenceClassification: { from_pretrained: vi.fn().mockResolvedValue(mockModel) },
  env: { cacheDir: '' },
}))

const { rerank } = await import('../../services/reranker.js')

describe('rerank', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTokenizer.mockImplementation((_query: string, _opts: unknown) => ({ mocked: true }))
  })

  it('skips loading the model entirely when items already fit within topN', async () => {
    const items = [{ chunk: 'a' }, { chunk: 'b' }]
    const result = await rerank('query', items, i => i.chunk, 5)

    expect(result).toBe(items)
    expect(mockModel).not.toHaveBeenCalled()
  })

  it('sorts candidates by cross-encoder score descending and cuts to topN', async () => {
    const items = [{ chunk: 'irrelevant' }, { chunk: 'relevant' }, { chunk: 'somewhat relevant' }]
    mockModel
      .mockResolvedValueOnce({ logits: { data: [-5] } })   // irrelevant
      .mockResolvedValueOnce({ logits: { data: [9] } })    // relevant
      .mockResolvedValueOnce({ logits: { data: [2] } })    // somewhat relevant

    const result = await rerank('query', items, i => i.chunk, 2)

    expect(result).toEqual([{ chunk: 'relevant' }, { chunk: 'somewhat relevant' }])
  })

  it('passes query and item text as a text_pair to the tokenizer', async () => {
    const items = [{ chunk: 'a' }, { chunk: 'b' }, { chunk: 'c' }]
    mockModel.mockResolvedValue({ logits: { data: [1] } })

    await rerank('what is SAP?', items, i => i.chunk, 1)

    expect(mockTokenizer).toHaveBeenCalledWith('what is SAP?', expect.objectContaining({ text_pair: 'a' }))
  })

  it('falls back to the original order (truncated) if the model throws', async () => {
    const items = [{ chunk: 'a' }, { chunk: 'b' }, { chunk: 'c' }]
    mockModel.mockRejectedValue(new Error('ONNX runtime error'))

    const result = await rerank('query', items, i => i.chunk, 2)

    expect(result).toEqual([{ chunk: 'a' }, { chunk: 'b' }])
  })
})

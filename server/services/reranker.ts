import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// CPU-only cross-encoder reranker via ONNX Runtime (transformers.js). Never
// requests a GPU/CUDA backend, so it doesn't compete with Ollama for the
// RTX 2060's 6GB VRAM budget — confirmed empirically (`model.device` reports
// 'cpu' with no device option passed to from_pretrained()).
const MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

// Cache downloaded model weights outside node_modules so `npm ci` doesn't
// force a re-download.
const CACHE_DIR = path.resolve(__dirname, '../.cache/transformers')

type Tokenizer = { (text: string, opts: { text_pair: string; padding: boolean; truncation: boolean }): unknown }
type CrossEncoder = { (inputs: unknown): Promise<{ logits: { data: Float32Array | number[] } }> }

let tokenizerPromise: Promise<Tokenizer> | null = null
let modelPromise:     Promise<CrossEncoder> | null = null

async function getTokenizer(): Promise<Tokenizer> {
  if (!tokenizerPromise) {
    tokenizerPromise = import('@huggingface/transformers').then(({ AutoTokenizer, env }) => {
      env.cacheDir = CACHE_DIR
      return AutoTokenizer.from_pretrained(MODEL_ID) as unknown as Promise<Tokenizer>
    })
  }
  return tokenizerPromise
}

async function getModel(): Promise<CrossEncoder> {
  if (!modelPromise) {
    modelPromise = import('@huggingface/transformers').then(({ AutoModelForSequenceClassification, env }) => {
      env.cacheDir = CACHE_DIR
      return AutoModelForSequenceClassification.from_pretrained(MODEL_ID, { dtype: 'fp32' }) as unknown as Promise<CrossEncoder>
    })
  }
  return modelPromise
}

/**
 * Reranks `items` by relevance to `query` using a small CPU cross-encoder,
 * returning the top `topN`. Falls back to the original order (first `topN`)
 * if the reranker fails to load or run — retrieval quality degrades to
 * pre-rerank ordering rather than the request failing outright.
 */
export async function rerank<T>(
  query:   string,
  items:   T[],
  getText: (item: T) => string,
  topN:    number
): Promise<T[]> {
  if (items.length <= topN) return items

  try {
    const tokenizer = await getTokenizer()
    const model     = await getModel()

    const scored: { item: T; score: number }[] = []
    for (const item of items) {
      const inputs = tokenizer(query, { text_pair: getText(item), padding: true, truncation: true })
      const { logits } = await model(inputs)
      scored.push({ item, score: logits.data[0] as number })
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map(s => s.item)
  } catch (err) {
    console.warn('Reranker failed, falling back to pre-rerank order:', (err as Error).message)
    return items.slice(0, topN)
  }
}

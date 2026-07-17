// Unified AI client — Ollama (default, local, zero-cost), Claude API, or Gemini API.
// All AI calls in the codebase go through this module. Never import provider
// clients directly from routes or other services.

import { env } from '../lib/env.js'

const OLLAMA_BASE = env.OLLAMA_URL
const CHAT_MODEL  = env.OLLAMA_CHAT_MODEL
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

// ── Types ─────────────────────────────────────────────────────────────────

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

// Gemini uses "model" for assistant role and a separate system_instruction field.
function toGeminiContents(messages: Message[]) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role:  m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))
}

// ── aiChat ────────────────────────────────────────────────────────────────

/**
 * Single-turn AI completion. Routes to Claude API when USE_CLAUDE=true,
 * otherwise calls local Ollama. System prompt is passed separately so
 * callers don't need to know the provider's message format.
 */
export async function aiChat(prompt: string, system: string): Promise<string> {
  if (env.AI_PROVIDER === 'claude') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Claude API error ${res.status}: ${body}`)
    }

    const data = await res.json() as { content: Array<{ text: string }> }
    return data.content[0].text
  }

  if (env.AI_PROVIDER === 'gemini') {
    const model = env.GEMINI_CHAT_MODEL
    const url   = `${GEMINI_BASE}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`
    const res   = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(30_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents:           [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini API error ${res.status}: ${body}`)
    }

    const data = await res.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>
    }
    return data.candidates[0].content.parts[0].text
  }

  // Default: Ollama (local, free)
  // 120s, not 30s — non-streaming generation time scales with prompt size
  // (e.g. component-overview combines several files' outlines into one
  // prompt) and this is a 7B model on a 6GB laptop GPU; 30s was tight even
  // for single-file prompts and was observed timing out in practice on a
  // multi-file one. Matches the streaming path's existing 120s below.
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({
      model:    CHAT_MODEL,
      stream:   false,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: prompt },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Ollama chat error ${res.status}: ${body}`)
  }

  const data = await res.json() as { message: { content: string } }
  return data.message.content
}

// ── aiEmbed ───────────────────────────────────────────────────────────────
// Embeddings always use Ollama (nomic-embed-text) — never routed through
// Claude API, which has no embedding endpoint.

/**
 * Generate a vector embedding for `text` using nomic-embed-text on Ollama.
 * Always local — embeddings are never routed through the Claude API.
 * Returns a 768-dimension float array suitable for pgvector storage.
 */
export async function aiEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      model:  'nomic-embed-text',
      prompt: text,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Ollama embed error ${res.status}: ${body}`)
  }

  const data = await res.json() as { embedding: number[] }
  return data.embedding
}

// ── aiChatStream ──────────────────────────────────────────────────────────
// Used by the DocChat SSE route. Calls onChunk for each partial token,
// which the route pipes to the client as `data: <token>\n\n`.

/**
 * Streaming AI completion — calls `onChunk` for each partial token as it
 * arrives. Used by the DocChat SSE route to push tokens to the browser.
 * Handles both Ollama's NDJSON stream and Claude's SSE stream formats.
 */
export async function aiChatStream(
  messages: Message[],
  onChunk: (chunk: string) => void
): Promise<void> {
  if (env.AI_PROVIDER === 'claude') {
    const system      = messages.find(m => m.role === 'system')?.content ?? ''
    const userMessages = messages.filter(m => m.role !== 'system')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
        'Content-Type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 2048,
        stream:     true,
        system,
        messages:   userMessages,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Claude stream error ${res.status}: ${body}`)
    }

    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value, { stream: true }).split('\n')
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const json = JSON.parse(line.slice(5)) as {
            type: string
            delta?: { text?: string }
          }
          if (json.type === 'content_block_delta' && json.delta?.text) {
            onChunk(json.delta.text)
          }
        } catch {
          // incomplete JSON line — skip
        }
      }
    }
    return
  }

  if (env.AI_PROVIDER === 'gemini') {
    const system = messages.find(m => m.role === 'system')?.content ?? ''
    const model  = env.GEMINI_CHAT_MODEL
    const url    = `${GEMINI_BASE}/models/${model}:streamGenerateContent?key=${env.GEMINI_API_KEY}&alt=sse`

    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  AbortSignal.timeout(120_000),
      body: JSON.stringify({
        system_instruction: system ? { parts: [{ text: system }] } : undefined,
        contents:           toGeminiContents(messages),
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gemini stream error ${res.status}: ${body}`)
    }

    const reader  = res.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const lines = decoder.decode(value, { stream: true }).split('\n')
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        try {
          const json = JSON.parse(line.slice(5)) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
          }
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) onChunk(text)
        } catch {
          // incomplete JSON line — skip
        }
      }
    }
    return
  }

  // Default: Ollama streaming
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(120_000),  // streaming can legitimately take longer
    body: JSON.stringify({
      model:    CHAT_MODEL,
      stream:   true,
      messages,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Ollama stream error ${res.status}: ${body}`)
  }

  const reader  = res.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const json = JSON.parse(line) as { message?: { content?: string }; done?: boolean }
        if (json.message?.content) {
          onChunk(json.message.content)
        }
      } catch {
        // incomplete JSON line — skip
      }
    }
  }
}

// ── ollamaReady ───────────────────────────────────────────────────────────
// Returns true when Ollama's HTTP API responds. Used in the health endpoint.

/** Probe Ollama's /api/tags endpoint. Returns false on any network error. */
export async function ollamaReady(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

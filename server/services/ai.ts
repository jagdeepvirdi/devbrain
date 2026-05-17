// Unified AI client — Ollama (default, local, zero-cost) or Claude API (opt-in).
// All AI calls in the codebase go through this module. Never import Ollama or
// Anthropic directly from routes or other services.

import { env } from '../lib/env.js'

const OLLAMA_BASE = env.OLLAMA_URL
const CHAT_MODEL  = env.OLLAMA_CHAT_MODEL

// ── Types ─────────────────────────────────────────────────────────────────

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

// ── aiChat ────────────────────────────────────────────────────────────────

export async function aiChat(prompt: string, system: string): Promise<string> {
  if (env.USE_CLAUDE) {
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

  // Default: Ollama (local, free)
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function aiEmbed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function aiChatStream(
  messages: Message[],
  onChunk: (chunk: string) => void
): Promise<void> {
  if (env.USE_CLAUDE) {
    const system = messages.find(m => m.role === 'system')?.content ?? ''
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

  // Default: Ollama streaming
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function ollamaReady(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

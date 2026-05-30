import { Router }        from 'express'
import { z }             from 'zod'
import { aiEmbed, aiChatStream } from '../services/ai.js'
import { searchChunks }          from '../services/embedder.js'
import { requireRole } from '../middleware/auth.js'

const router = Router()

const ChatBody = z.object({
  question:   z.string().min(1).max(4000),
  projectId:  z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
})

// ── POST /api/chat ────────────────────────────────────────────────────────
// SSE stream: citations first, then text chunks, then [DONE]

router.post('/', requireRole('viewer'), async (req, res) => {
  const parsed = ChatBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const { question, projectId, documentId } = parsed.data

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const IDLE_MS = 5 * 60 * 1000
  let idleTimer = setTimeout(onIdle, IDLE_MS)
  function resetIdle() { clearTimeout(idleTimer); idleTimer = setTimeout(onIdle, IDLE_MS) }
  function onIdle() { res.write('data: {"type":"timeout"}\n\n'); res.end() }
  req.on('close', () => clearTimeout(idleTimer))

  function send(obj: unknown) {
    resetIdle()
    res.write(`data: ${JSON.stringify(obj)}\n\n`)
  }

  function done() {
    clearTimeout(idleTimer)
    res.write('data: [DONE]\n\n')
    res.end()
  }

  function sendError(msg: string) {
    send({ type: 'error', message: msg })
    done()
  }

  try {
    // 1. Embed the question
    const queryEmbedding = await aiEmbed(question)

    // 2. Retrieve top-k chunks
    const results = await searchChunks(queryEmbedding, {
      projectId:  projectId  ?? null,
      documentId: documentId ?? null,
      limit: 5,
    })

    if (results.length === 0) {
      // No relevant docs — still answer but note it
      send({ type: 'citations', citations: [] })

      const system = `You are a helpful technical assistant.
The user's knowledge base has no documents relevant to their question.
Tell them politely that no relevant documents were found, and suggest they upload documents or broaden their scope.`

      await aiChatStream(
        [
          { role: 'system',  content: system },
          { role: 'user',    content: question },
        ],
        (chunk) => send({ type: 'chunk', text: chunk })
      )

      done()
      return
    }

    // 3. Send citations to client immediately
    const citations = results.map((r, i) => ({
      index:         i + 1,
      documentId:    r.documentId,
      documentTitle: r.documentTitle,
      chunkIndex:    r.chunkIndex,
      score:         Math.round(r.score * 1000) / 1000,
      excerpt:       r.chunk.slice(0, 300) + (r.chunk.length > 300 ? '…' : ''),
    }))

    send({ type: 'citations', citations })

    // 4. Build RAG prompt
    const excerpts = results
      .map((r, i) =>
        `[${i + 1}] From "${r.documentTitle}" (chunk ${r.chunkIndex}):\n${r.chunk}`
      )
      .join('\n\n---\n\n')

    const system = `You are a technical assistant for a developer's private knowledge base.
Answer using ONLY the provided document excerpts below.
If the answer isn't in the excerpts, say "I don't see this in the provided documents."
Cite the document by its number [N] for each fact you use.
Format your answer in Markdown.

Document excerpts:
${excerpts}`

    // 5. Stream the answer
    await aiChatStream(
      [
        { role: 'system', content: system },
        { role: 'user',   content: question },
      ],
      (chunk) => send({ type: 'chunk', text: chunk })
    )

    done()
  } catch (err) {
    console.error('chat route error:', err)
    sendError((err as Error).message ?? 'Unknown error')
  }
})

export default router

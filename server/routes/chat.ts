import { Router }        from 'express'
import { z }             from 'zod'
import { aiEmbed, aiChat, aiChatStream } from '../services/ai.js'
import { searchChunks, countTokens }     from '../services/embedder.js'
import { requireRole } from '../middleware/auth.js'
import { pool }        from '../db/pool.js'
import { serverError } from '../lib/errors.js'

const router = Router()

const HISTORY_LIMIT = 10
// How many of the most recent assistant turns' citations to consider for backfill.
const BACKFILL_HISTORY_TURNS = 2
// How many recent turns to include when asking the model to rewrite a
// follow-up question into a standalone search query.
const REWRITE_HISTORY_TURNS = 4

// Full Context Mode (Phase 32.6): when chatting with a single document short
// enough to fit the model's context window, skip chunk retrieval/reranking
// entirely and hand over the whole document — avoids losing information to
// arbitrary chunk boundaries. Conservative budget: no `num_ctx` is
// configured anywhere in this codebase, so Ollama falls back to its default
// context window (commonly 2048 tokens); this leaves generous room for the
// system prompt wrapper, conversation history, and the model's response.
const FULL_CONTEXT_MAX_DOC_TOKENS = 1200
// Citation chunkIndex sentinel for a Full Context Mode answer — distinct
// from real content chunks (>= 0) and from the summary-chunk sentinel (-1,
// see SUMMARY_CHUNK_INDEX in embedder.ts). Never stored in document_chunks,
// only used in the citation object sent to the client.
const FULL_DOCUMENT_CITATION_INDEX = -2

async function tryFullContextMode(documentId: string): Promise<{ title: string; content: string } | null> {
  const { rows } = await pool.query<{ title: string; content: string }>(
    'SELECT title, content FROM documents WHERE id = $1',
    [documentId]
  )
  if (!rows.length) return null
  return countTokens(rows[0].content) <= FULL_CONTEXT_MAX_DOC_TOKENS ? rows[0] : null
}

type ChatMessageRow = {
  id:         string
  role:       'user' | 'assistant'
  content:    string
  citations:  unknown
  created_at: string
}

async function loadHistory(sessionId: string): Promise<ChatMessageRow[]> {
  const { rows } = await pool.query<ChatMessageRow>(
    `SELECT id, role, content, citations, created_at
       FROM chat_messages
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [sessionId, HISTORY_LIMIT]
  )
  return rows.reverse() // chronological order for the prompt
}

// Chunk ids cited in the last few assistant turns — used to backfill retrieval
// for follow-ups ("what about the second one?") whose raw text alone carries
// no retrievable meaning.
function getRecentCitedChunkIds(priorTurns: ChatMessageRow[]): string[] {
  const recentAssistant = priorTurns.filter(m => m.role === 'assistant').slice(-BACKFILL_HISTORY_TURNS)
  const ids = new Set<string>()
  for (const msg of recentAssistant) {
    const citations = (msg.citations ?? []) as Array<{ id?: string }>
    for (const c of citations) if (c.id) ids.add(c.id)
  }
  return [...ids]
}

// Rewrites a follow-up question into a standalone search query using recent
// conversation history — only called when both the current turn's retrieval
// AND citation backfill come up empty. Uses the same model as the main
// answer (no separate "fast model" is actually wired up anywhere in this
// codebase despite the docs mentioning gemma3:4b — see CLAUDE.md vs. the
// auto-tag route, which also just calls the generic aiChat()).
async function rewriteQuery(question: string, priorTurns: ChatMessageRow[]): Promise<string | null> {
  if (priorTurns.length === 0) return null

  const historyText = priorTurns
    .slice(-REWRITE_HISTORY_TURNS)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n')

  try {
    const raw = await aiChat(
      `Conversation so far:\n${historyText}\n\nFollow-up question: "${question}"\n\nRewrite the follow-up question as a single standalone search query that captures what's actually being asked, using the conversation for context. Return ONLY the rewritten query text — no explanation, no quotes.`,
      'You rewrite follow-up questions into standalone search queries for a document search engine. Output only the rewritten query, nothing else.'
    )
    const rewritten = raw.trim().replace(/^["']|["']$/g, '')
    return rewritten && rewritten.toLowerCase() !== question.trim().toLowerCase() ? rewritten : null
  } catch {
    return null
  }
}

async function saveMessage(
  sessionId: string,
  role:      'user' | 'assistant',
  content:   string,
  citations?: unknown
): Promise<void> {
  await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1, $2, $3, $4)`,
    [sessionId, role, content, citations ? JSON.stringify(citations) : null]
  )
  await pool.query(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sessionId])
}

// ── POST /api/chat ────────────────────────────────────────────────────────
// SSE stream: session id first, then citations, then text chunks, then [DONE]

const ChatBody = z.object({
  question:   z.string().min(1).max(4000),
  sessionId:  z.string().nullable().optional(),
  projectId:  z.string().nullable().optional(),
  documentId: z.string().nullable().optional(),
  component:  z.string().nullable().optional(),
})

router.post('/', requireRole('viewer'), async (req, res) => {
  const parsed = ChatBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const { question, sessionId, projectId, documentId, component } = parsed.data
  const userId = req.user!.id

  // Resolve the session before opening the SSE stream so a bad sessionId
  // can return a normal 404 instead of an SSE error event.
  let resolvedSessionId: string
  try {
    if (sessionId) {
      const { rows } = await pool.query('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [sessionId, userId])
      if (!rows.length) return res.status(404).json({ error: 'Chat session not found' })
      resolvedSessionId = rows[0].id
    } else {
      const title = question.length > 60 ? question.slice(0, 60) + '…' : question
      const { rows } = await pool.query(
        `INSERT INTO chat_sessions (user_id, project_id, component, title) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, projectId ?? null, component ?? null, title]
      )
      resolvedSessionId = rows[0].id
    }
  } catch (err) {
    serverError(res, err)
    return
  }

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

  send({ type: 'session', sessionId: resolvedSessionId })

  try {
    await saveMessage(resolvedSessionId, 'user', question)
    const history = await loadHistory(resolvedSessionId)
    // Drop the just-saved user turn — it's added explicitly as the final
    // message below, after the RAG system prompt.
    const priorTurns = history.slice(0, -1)

    // 0. Full Context Mode: single-document scope, document short enough to
    // skip chunk retrieval entirely and just hand over the whole thing.
    if (documentId) {
      const fullDoc = await tryFullContextMode(documentId)
      if (fullDoc) {
        const citation = {
          index: 1, id: '', documentId, documentTitle: fullDoc.title,
          chunkIndex: FULL_DOCUMENT_CITATION_INDEX, score: 1, excerpt: 'Full document used as context',
        }
        send({ type: 'citations', citations: [citation] })

        const system = `You are a technical assistant for a developer's private knowledge base.
Answer using ONLY the following document content. If the answer isn't in the document, say "I don't see this in the provided document."
Format your answer in Markdown.

Document: "${fullDoc.title}"
${fullDoc.content}`

        let answer = ''
        await aiChatStream(
          [
            { role: 'system', content: system },
            ...priorTurns.map(m => ({ role: m.role, content: m.content })),
            { role: 'user',   content: question },
          ],
          (chunk) => { answer += chunk; send({ type: 'chunk', text: chunk }) }
        )

        await saveMessage(resolvedSessionId, 'assistant', answer, [citation])
        done()
        return
      }
    }

    // 1. Embed the question
    const queryEmbedding = await aiEmbed(question)

    // 2. Retrieve top-k chunks — hybrid vector + full-text search, backfilled
    //    with recently-cited chunks if this turn's retrieval alone is thin.
    const backfillChunkIds = getRecentCitedChunkIds(priorTurns)
    let results = await searchChunks(queryEmbedding, question, {
      projectId:  projectId  ?? null,
      documentId: documentId ?? null,
      component:  component  ?? null,
      limit: 5,
      backfillChunkIds,
    })

    // 2b. Still nothing? Rewrite into a standalone search query using
    // conversation history and retry once — for follow-ups whose raw text
    // carries no retrievable meaning and weren't covered by backfill either
    // (e.g. an oblique reference to a new sub-topic).
    if (results.length === 0 && priorTurns.length > 0) {
      const rewritten = await rewriteQuery(question, priorTurns)
      if (rewritten) {
        const rewrittenEmbedding = await aiEmbed(rewritten)
        results = await searchChunks(rewrittenEmbedding, rewritten, {
          projectId:  projectId  ?? null,
          documentId: documentId ?? null,
          component:  component  ?? null,
          limit: 5,
          backfillChunkIds,
        })
      }
    }

    if (results.length === 0) {
      // Nothing cleared the relevance threshold even after backfill/rewrite —
      // skip the LLM call entirely (saves a ~3-5s mistral:7b round trip) and
      // guarantees no fabricated citations on empty retrieval.
      send({ type: 'citations', citations: [] })

      const answer = "I don't see anything in your knowledge base relevant to this question. Try uploading related documents, or broaden your scope (project, document, or component)."
      send({ type: 'chunk', text: answer })

      await saveMessage(resolvedSessionId, 'assistant', answer, [])
      done()
      return
    }

    // 3. Send citations to client immediately
    const citations = results.map((r, i) => ({
      index:         i + 1,
      id:            r.id,
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

    const validCitations = results.map((_, i) => `[${i + 1}]`).join(', ')

    const system = `You are a technical assistant for a developer's private knowledge base.
Answer using ONLY the provided document excerpts below. If the answer isn't in the excerpts, say "I don't see this in the provided documents."

CITATION RULES:
- You may cite ONLY these excerpt numbers: ${validCitations}
- Cite inline immediately after the fact it supports, e.g. "The GL Feed Extractor pulls billing data from Infinys [1]."
- Never invent a citation number that isn't in the list above, and never cite a number for a fact that excerpt doesn't actually support.
- If a fact isn't covered by any excerpt, state it without a citation rather than guessing one.

Format your answer in Markdown.

Document excerpts:
${excerpts}`

    // 5. Stream the answer, with prior conversation turns for follow-up context
    let answer = ''
    await aiChatStream(
      [
        { role: 'system', content: system },
        ...priorTurns.map(m => ({ role: m.role, content: m.content })),
        { role: 'user',   content: question },
      ],
      (chunk) => { answer += chunk; send({ type: 'chunk', text: chunk }) }
    )

    await saveMessage(resolvedSessionId, 'assistant', answer, citations)
    done()
  } catch (err) {
    console.error('chat route error:', err)
    sendError((err as Error).message ?? 'Unknown error')
  }
})

// ── GET /api/chat/sessions ────────────────────────────────────────────────

router.get('/sessions', async (req, res) => {
  const projectId = req.query.projectId as string | undefined
  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.project_id, s.component, s.title, s.created_at, s.updated_at,
              (SELECT COUNT(*)::int FROM chat_messages m WHERE m.session_id = s.id) AS message_count
         FROM chat_sessions s
        WHERE s.user_id = $1 ${projectId ? 'AND s.project_id = $2' : ''}
        ORDER BY s.updated_at DESC`,
      projectId ? [req.user!.id, projectId] : [req.user!.id]
    )
    res.json({ data: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// ── GET /api/chat/sessions/:id/messages ───────────────────────────────────

router.get('/sessions/:id/messages', async (req, res) => {
  try {
    const owned = await pool.query('SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id])
    if (!owned.rows.length) return res.status(404).json({ error: 'Chat session not found' })

    const { rows } = await pool.query(
      `SELECT id, role, content, citations, created_at
         FROM chat_messages
        WHERE session_id = $1
        ORDER BY created_at ASC`,
      [req.params.id]
    )
    res.json({ data: rows })
  } catch (err) {
    serverError(res, err)
  }
})

// ── DELETE /api/chat/sessions/:id ─────────────────────────────────────────

router.delete('/sessions/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user!.id]
    )
    if (!rows.length) return res.status(404).json({ error: 'Chat session not found' })
    res.json({ data: { deleted: rows[0].id } })
  } catch (err) {
    serverError(res, err)
  }
})

export default router

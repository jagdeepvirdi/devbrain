import { Router } from 'express'
import { z } from 'zod'
import { aiChat, aiChatStream } from '../services/ai.js'
import { requireRole } from '../middleware/auth.js'
import { pool } from '../db/pool.js'
import { createNotification } from '../services/notifications.js'

const router = Router()

// Output format → system prompt suffix
const FORMAT_PROMPTS: Record<string, string> = {
  markdown:  'Format your response as well-structured Markdown with headers, bold, and code blocks where appropriate.',
  json:      'Respond ONLY with valid JSON. No explanation, no prose — just the JSON object or array.',
  bullets:   'Format your response as a concise bullet list. Use • for top-level items and  – for sub-items.',
  table:     'Format your response as a Markdown table. Include a header row and align columns.',
  code:      'Respond with only code. Include the language identifier in the code fence. Add a one-line comment at the top explaining what the code does.',
  summary:   'Respond with a concise summary in 3–5 sentences. Plain prose, no lists or headers.',
  plaintext: 'Respond in plain text. No Markdown formatting.',
}

const TaskBody = z.object({
  task:   z.string().min(1).max(4000).trim(),
  format: z.enum(['markdown', 'json', 'bullets', 'table', 'code', 'summary', 'plaintext'])
           .default('markdown'),
  stream: z.boolean().default(false),
})

const SYSTEM = `You are a senior developer assistant embedded in DevBrain, a private knowledge base tool.
Answer precisely and concisely. Do not add unnecessary caveats or disclaimers.
Focus on practical, actionable output.`

async function handleAiTaskDoneNotification(userId: string, task: string) {
  try {
    const { rows: settingsRows } = await pool.query(`SELECT value FROM app_settings WHERE key = 'notification_rules'`)
    const rules = settingsRows[0]?.value ?? {}
    if (rules.ai_task_alerts_enabled !== false) {
      await createNotification(userId, {
        type: 'ai_task_done',
        title: 'AI Task Complete',
        body: `AI finished processing: "${task.length > 60 ? task.substring(0, 60) + '...' : task}"`,
      })
    }
  } catch (err) {
    console.error('Failed to create AI task completion notification:', err)
  }
}

// ── POST /api/aitask  (non-streaming) ────────────────────────────────────

router.post('/', requireRole('member'), async (req, res) => {
  const parsed = TaskBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ error: 'Validation error', issues: parsed.error.issues })
  }

  const { task, format, stream } = parsed.data
  const formatInstruction = FORMAT_PROMPTS[format]
  const system = `${SYSTEM}\n\n${formatInstruction}`

  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    try {
      await aiChatStream(
        [
          { role: 'system',  content: system },
          { role: 'user',    content: task },
        ],
        (chunk) => {
          res.write(`data: ${JSON.stringify({ chunk })}\n\n`)
        }
      )
      res.write('data: [DONE]\n\n')
      handleAiTaskDoneNotification(req.user!.id, task).catch(() => {})
    } catch (err) {
      res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`)
    }

    res.end()
    return
  }

  try {
    const result = await aiChat(task, system)
    handleAiTaskDoneNotification(req.user!.id, task).catch(() => {})
    res.json({ data: { result, format } })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

export default router


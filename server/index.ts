import 'dotenv/config'
import { env } from './lib/env.js'

import express      from 'express'
import cors         from 'cors'
import cookieParser from 'cookie-parser'
import rateLimit    from 'express-rate-limit'
import path         from 'path'
import { fileURLToPath } from 'url'
import swaggerUi from 'swagger-ui-express'
import { openApiSpec } from './docs/openapi.js'

import { pool, dbReady } from './db/pool.js'
import { runSeed } from './db/seed.js'
import { ollamaReady } from './services/ai.js'
import { initTasksWatcher } from './services/tasks-watcher.js'
import { startBackupScheduler } from './services/backup.js'
import { startNotificationScheduler, startDigestScheduler } from './services/notifications.js'

const app = express()

// HTTPS enforcement (set FORCE_HTTPS=true behind a reverse proxy)
if (env.FORCE_HTTPS) {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(301, `https://${req.header('host') ?? ''}${req.url}`)
    } else {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
      next()
    }
  })
}

app.use(cors())
app.use(cookieParser())
app.use(express.json({ limit: '50mb' }))

// ── Health check ──────────────────────────────────────────────────────────

app.get('/api/health', async (_req, res) => {
  const [db, ollama] = await Promise.all([dbReady(), ollamaReady()])

  const status = db ? (ollama ? 'ok' : 'degraded') : 'error'

  res.status(db ? 200 : 503).json({
    status,
    ts:     new Date().toISOString(),
    checks: {
      db:     db     ? 'ok' : 'unreachable',
      ollama: ollama ? 'ok' : 'unreachable',
    },
    config: {
      ai_backend:  env.USE_CLAUDE ? 'claude' : 'ollama',
      chat_model:  env.USE_CLAUDE ? 'claude-sonnet-4-6' : env.OLLAMA_CHAT_MODEL,
      embed_model: 'nomic-embed-text',
    },
  })
})

// ── API Docs (public — no auth) ───────────────────────────────────────────

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec))

// ── Auth routes (unprotected) ─────────────────────────────────────────────

import authRouter from './routes/auth.js'
app.use('/api/auth', authRouter)

import notifyRouter from './routes/notify.js'
app.use('/api/notify', notifyRouter)

// ── Auth middleware (protects all routes below) ───────────────────────────

import { requireAuth } from './middleware/auth.js'
app.use('/api', requireAuth)

// ── Rate limiting for AI / mutation-heavy endpoints ───────────────────────

const mutationLimiter = rateLimit({
  windowMs:        60 * 1000,  // 1 minute
  max:             60,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many requests — slow down' })
  },
})

app.post('/api/documents',                mutationLimiter)
app.post('/api/chat',                     mutationLimiter)
app.post('/api/issues/:id/summarize',     mutationLimiter)
app.post('/api/commands/:id/explain',     mutationLimiter)

// ── Routes ────────────────────────────────────────────────────────────────

import projectsRouter  from './routes/projects.js'
import aitaskRouter    from './routes/aitask.js'
import documentsRouter from './routes/documents.js'

app.use('/api/projects',  projectsRouter)
app.use('/api/aitask',    aitaskRouter)
app.use('/api/documents', documentsRouter)
import issuesRouter from './routes/issues.js'
app.use('/api/issues',    issuesRouter)
import tasksRouter from './routes/tasks.js'
app.use('/api/tasks',     tasksRouter)
import commandsRouter from './routes/commands.js'
app.use('/api/commands',  commandsRouter)
import releasesRouter from './routes/releases.js'
app.use('/api/releases',  releasesRouter)
import runbooksRouter from './routes/runbooks.js'
app.use('/api/runbooks',  runbooksRouter)
import searchRouter    from './routes/search.js'
app.use('/api/search',    searchRouter)
import dashboardRouter from './routes/dashboard.js'
app.use('/api/dashboard', dashboardRouter)
import chatRouter from './routes/chat.js'
app.use('/api/chat',      chatRouter)
import settingsRouter from './routes/settings.js'
app.use('/api/settings',  settingsRouter)
import usersRouter from './routes/users.js'
app.use('/api/users',     usersRouter)
import auditRouter from './routes/audit.js'
app.use('/api/audit',     auditRouter)
import gitRouter          from './routes/git.js'
app.use('/api/git',           gitRouter)
import integrationsRouter from './routes/integrations.js'
app.use('/api/integrations',  integrationsRouter)
import notificationsRouter from './routes/notifications.js'
app.use('/api/notifications', notificationsRouter)
import claudeProjectsRouter from './routes/claude-projects.js'
app.use('/api/claude-projects', claudeProjectsRouter)
import antigravityProjectsRouter from './routes/antigravity-projects.js'
app.use('/api/antigravity-projects', antigravityProjectsRouter)
import exportRouter from './routes/export.js'
app.use('/api/export', exportRouter)
import templatesRouter from './routes/templates.js'
app.use('/api/templates', templatesRouter)

// ── Static client (production) ────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(__dirname, 'public')

if (env.NODE_ENV === 'production') {
  app.use(express.static(publicDir))
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

// ── Central error handler ─────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express'
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[unhandled error]', err)
  res.status(500).json({
    error: env.NODE_ENV === 'production' ? 'Internal server error' : msg,
  })
})

// ── Startup ───────────────────────────────────────────────────────────────

async function start() {
  console.log('DevBrain starting…')

  // Wait for DB (retry up to 10 × 2 s during Docker cold start)
  for (let i = 0; i < 10; i++) {
    const ready = await dbReady()
    if (ready) break
    if (i === 9) {
      console.error('  db: could not connect after 10 attempts — exiting')
      process.exit(1)
    }
    console.log(`  db: not ready (attempt ${i + 1}/10) — waiting 2 s…`)
    await new Promise(r => setTimeout(r, 2000))
  }
  console.log('  db: connected ✓')

  // Seed on first launch
  try {
    await runSeed()
  } catch (err) {
    console.error('  seed: failed:', (err as Error).message)
  }

  // Ollama check (non-fatal — local dev may start server before Ollama)
  const ollama = await ollamaReady()
  console.log(`  ollama: ${ollama ? 'reachable ✓' : 'unreachable (AI features will fail)'}`)

  // Start TASKS.md watchers for linked projects
  await initTasksWatcher()

  // Start scheduled backup (non-fatal)
  startBackupScheduler()

  // Start notification scheduler
  startNotificationScheduler()

  // Start daily digest scheduler
  startDigestScheduler()

  app.listen(env.PORT, () => {
    console.log(`  server: http://localhost:${env.PORT} ✓`)
  })
}

start().catch(err => {
  console.error('startup error:', err)
  process.exit(1)
})

// Graceful shutdown
process.on('SIGTERM', async () => {
  await pool.end()
  process.exit(0)
})

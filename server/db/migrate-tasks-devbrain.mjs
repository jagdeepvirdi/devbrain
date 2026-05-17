/**
 * Migration: add tasks table + seed DevBrain commands/issues/tasks
 * Safe to re-run — all inserts use ON CONFLICT DO NOTHING
 */
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  user: 'devbrain', host: 'localhost', port: 5433,
  database: 'devbrain', password: 'devbrain',
  connectionTimeoutMillis: 5000,
})

const c = await pool.connect()

// ── 1. Tasks table ─────────────────────────────────────────────────────────

await c.query(`
  CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    project_id  TEXT        REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    status      TEXT        NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
    priority    TEXT        NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    due_date    DATE,
    tags        TEXT[]      NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    done_at     TIMESTAMPTZ
  )
`)
await c.query(`CREATE INDEX IF NOT EXISTS tasks_project_idx  ON tasks (project_id)`)
await c.query(`CREATE INDEX IF NOT EXISTS tasks_status_idx   ON tasks (status)`)
await c.query(`CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks (priority)`)
console.log('✓  tasks table ready')

// ── 2. Get DevBrain project id ─────────────────────────────────────────────

const { rows: [devbrain] } = await c.query(
  `SELECT id FROM projects WHERE short_name = 'devbrain'`
)
if (!devbrain) { console.error('DevBrain project not found — run server first to seed projects'); process.exit(1) }
const dbId = devbrain.id
console.log('✓  DevBrain project id:', dbId)

// ── 3. DevBrain commands ───────────────────────────────────────────────────

const DEVBRAIN_COMMANDS = [
  {
    title: 'Start Dev Server (backend)',
    command: 'cd server && npm run dev',
    language: 'bash',
    description: 'Start the Express backend with tsx watch on port 3001.',
    tags: ['dev', 'server', 'backend'],
    is_favorite: true,
  },
  {
    title: 'Start Dev Client (frontend)',
    command: 'cd client && npm run dev',
    language: 'bash',
    description: 'Start the Vite React frontend (auto-assigns port 5173+).',
    tags: ['dev', 'client', 'frontend', 'vite'],
    is_favorite: true,
  },
  {
    title: 'Start Docker Postgres (pgvector)',
    command: 'docker compose up postgres -d',
    language: 'bash',
    description: 'Start the pgvector/pgvector:pg16 container on port 5433.',
    tags: ['docker', 'postgres', 'pgvector', 'db'],
    is_favorite: true,
  },
  {
    title: 'Run DB Migration / Setup',
    command: 'cd server && node db/migrate-tasks-devbrain.mjs',
    language: 'bash',
    description: 'Apply schema migrations and seed DevBrain data. Safe to re-run.',
    tags: ['db', 'migration', 'schema'],
    is_favorite: false,
  },
  {
    title: 'TypeScript Check (server)',
    command: 'cd server && npx tsc --noEmit',
    language: 'bash',
    description: 'Run TypeScript type checking on the server without emitting files.',
    tags: ['ts', 'typecheck', 'server'],
    is_favorite: false,
  },
  {
    title: 'TypeScript Check (client)',
    command: 'cd client && npx tsc --noEmit',
    language: 'bash',
    description: 'Run TypeScript type checking on the React client without emitting files.',
    tags: ['ts', 'typecheck', 'client'],
    is_favorite: false,
  },
  {
    title: 'Pull Ollama Models',
    command: 'ollama pull mistral && ollama pull nomic-embed-text && ollama pull gemma3:4b',
    language: 'bash',
    description: 'Pull all required Ollama models: chat (mistral), embeddings (nomic), summarize (gemma3:4b).',
    tags: ['ollama', 'models', 'setup'],
    is_favorite: false,
  },
  {
    title: 'Check Ollama GPU Usage',
    command: 'ollama ps',
    language: 'bash',
    description: 'List running Ollama models and their VRAM usage. RTX 2060 has 6GB.',
    tags: ['ollama', 'gpu', 'vram'],
    is_favorite: false,
  },
  {
    title: 'Connect to DevBrain DB (psql)',
    command: 'docker exec -it devbrain-postgres-1 psql -U devbrain -d devbrain',
    language: 'bash',
    description: 'Open a psql shell inside the Docker postgres container.',
    tags: ['psql', 'docker', 'db', 'debug'],
    is_favorite: false,
  },
  {
    title: 'Build for Production',
    command: 'cd client && npm run build && cd ../server && npm run build',
    language: 'bash',
    description: 'Build client (Vite → server/public) then compile server TypeScript.',
    tags: ['build', 'production', 'deploy'],
    is_favorite: false,
  },
]

for (const cmd of DEVBRAIN_COMMANDS) {
  await c.query(
    `INSERT INTO commands (project_id, title, command, language, description, tags, is_favorite)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING`,
    [dbId, cmd.title, cmd.command, cmd.language, cmd.description, cmd.tags, cmd.is_favorite]
  )
}
console.log(`✓  ${DEVBRAIN_COMMANDS.length} DevBrain commands seeded`)

// ── 4. DevBrain issues ─────────────────────────────────────────────────────

const DEVBRAIN_ISSUES = [
  {
    title: 'pgvector not available on Windows PostgreSQL 14',
    description: 'Local PostgreSQL 14 (EDB install) does not have the pgvector extension. Needed for document chunk embeddings and semantic search.',
    status: 'resolved',
    priority: 'high',
    investigation_steps: JSON.stringify([
      { id: '1', order: 0, instruction: 'Check if vector extension exists in pg_available_extensions', done: true },
      { id: '2', order: 1, instruction: 'Try downloading pgvector Windows binary from GitHub releases', done: true },
      { id: '3', order: 2, instruction: 'Check Chocolatey for pgvector package', done: true },
      { id: '4', order: 3, instruction: 'Switch to Docker pgvector/pgvector:pg16 image on port 5433', done: true },
    ]),
    resolution: 'Switched to Docker pgvector/pgvector:pg16 container on port 5433. Updated DATABASE_URL in .env and docker-compose.yml host port. Local PostgreSQL 14 still runs on 5432 for other projects.',
    tags: ['postgres', 'pgvector', 'windows', 'docker'],
  },
  {
    title: 'Ollama cold-start timeout on first RAG query',
    description: 'First request to /api/chat times out because mistral:7b takes ~30s to load into VRAM from disk. Subsequent requests are fast (~3.5s).',
    status: 'resolved',
    priority: 'medium',
    investigation_steps: JSON.stringify([
      { id: '1', order: 0, instruction: 'Benchmark warm vs cold Ollama response times', done: true },
      { id: '2', order: 1, instruction: 'Check if model is fully loaded in VRAM with `ollama ps`', done: true },
      { id: '3', order: 2, instruction: 'Consider adding a warmup ping on server startup', done: false },
    ]),
    resolution: 'Confirmed: cold start ~30s (model loading from disk), warm ~3.5s at 47.3 t/s. RTX 2060 holds entire mistral:7b (4.66GB) in VRAM. Acceptable for personal use — just open the app and let it warm up.',
    tags: ['ollama', 'performance', 'vram', 'mistral'],
  },
  {
    title: 'Add Tasks / Todo system to DevBrain',
    description: 'DevBrain lacks a task/todo tracker. Need to add tasks table, API routes, and a Tasks page in the frontend. Tasks should link to projects and support priorities, due dates, and status.',
    status: 'resolved',
    priority: 'medium',
    investigation_steps: JSON.stringify([
      { id: '1', order: 0, instruction: 'Design tasks table schema (status, priority, due_date, project_id)', done: true },
      { id: '2', order: 1, instruction: 'Add tasks table migration script', done: true },
      { id: '3', order: 2, instruction: 'Build server/routes/tasks.ts with full CRUD', done: true },
      { id: '4', order: 3, instruction: 'Add tasksApi client in api.ts', done: true },
      { id: '5', order: 4, instruction: 'Build client/src/pages/Tasks.tsx', done: true },
      { id: '6', order: 5, instruction: 'Wire into sidebar nav and App.tsx routes', done: true },
    ]),
    resolution: 'Implemented as part of the current session. Tasks page added to sidebar under Issues.',
    tags: ['feature', 'tasks', 'frontend', 'backend'],
  },
]

for (const issue of DEVBRAIN_ISSUES) {
  await c.query(
    `INSERT INTO issues (project_id, title, description, status, priority, investigation_steps, resolution, tags)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT DO NOTHING`,
    [dbId, issue.title, issue.description, issue.status, issue.priority, issue.investigation_steps, issue.resolution, issue.tags]
  )
}
console.log(`✓  ${DEVBRAIN_ISSUES.length} DevBrain issues seeded`)

// ── 5. DevBrain tasks ──────────────────────────────────────────────────────

const DEVBRAIN_TASKS = [
  { title: 'Implement Commands library page (Phase 5)', priority: 'high',   status: 'todo',        description: 'Full CRUD for commands/snippets with Shiki syntax highlighting and copy-to-clipboard. Include ⌘K palette.' },
  { title: 'Implement Release notes timeline (Phase 6)', priority: 'medium', status: 'todo',        description: 'Semver timeline, AI formatting from commit messages, linked issues.' },
  { title: 'Implement Runbooks page (Phase 7)',          priority: 'medium', status: 'todo',        description: 'Step editor with drag-and-drop reorder using dnd-kit.' },
  { title: 'Global search (⌘K) across all projects',    priority: 'high',   status: 'todo',        description: 'Hybrid pgvector + tsvector search with results grouped by project and type.' },
  { title: 'Dashboard page with activity feed',          priority: 'low',    status: 'todo',        description: 'Show recent docs, open issues, last used commands. Cross-project view.' },
  { title: 'Set up nomic-embed-text model',              priority: 'high',   status: 'done',        description: 'Required for document embedding. Run: ollama pull nomic-embed-text' },
  { title: 'Set up Docker pgvector database',            priority: 'high',   status: 'done',        description: 'pgvector/pgvector:pg16 on port 5433. Run migration with setup-db.mjs.' },
  { title: 'Build Phase 3 RAG chat',                     priority: 'high',   status: 'done',        description: 'SSE streaming chat with pgvector retrieval, citation cards, scope selector.' },
  { title: 'Build Phase 4 Issues tracker',               priority: 'high',   status: 'done',        description: 'Investigation steps with drag reorder, notes feed, AI summarize.' },
  { title: 'Add JWT auth for single-user login',         priority: 'low',    status: 'in_progress', description: 'bcrypt + JWT. Single user v1. Protect all API routes.' },
]

for (const task of DEVBRAIN_TASKS) {
  await c.query(
    `INSERT INTO tasks (project_id, title, description, status, priority, done_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [dbId, task.title, task.description, task.status, task.priority,
     task.status === 'done' ? new Date() : null]
  )
}
console.log(`✓  ${DEVBRAIN_TASKS.length} DevBrain tasks seeded`)

c.release()
await pool.end()

console.log('\n✅  Migration complete.')

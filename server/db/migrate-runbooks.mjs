/**
 * Migration: seed sample runbooks
 * Safe to re-run — all titles are checked before insert
 */
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  user: 'devbrain', host: 'localhost', port: 5433,
  database: 'devbrain', password: 'devbrain',
  connectionTimeoutMillis: 5000,
})

const c = await pool.connect()

const { rows: projects } = await c.query(`SELECT id, short_name FROM projects`)
const bySlug = Object.fromEntries(projects.map(p => [p.short_name, p.id]))

const RUNBOOKS = [
  {
    project: 'devbrain',
    title: 'DevBrain Local Dev Setup',
    tags: ['setup', 'devbrain'],
    steps: [
      { id: '1', order: 0, instruction: 'Start Docker Desktop and verify it is running', command: 'docker info', note: 'Must be running before postgres can start' },
      { id: '2', order: 1, instruction: 'Start the pgvector postgres container', command: 'docker compose up postgres -d', note: 'Mapped to port 5435 (5432/5433/5434 used by FlowForge)' },
      { id: '3', order: 2, instruction: 'Verify the database is reachable', command: 'docker exec devbrain-postgres-1 pg_isready -U devbrain' },
      { id: '4', order: 3, instruction: 'Start the backend server (tsx watch)', command: 'cd server && npm run dev', note: 'Server starts on port 3001. Watch for "server: http://localhost:3001 ✓"' },
      { id: '5', order: 4, instruction: 'Start the Vite frontend dev server', command: 'cd client && npm run dev', note: 'Starts on port 5174 (or next available). Open the URL shown.' },
      { id: '6', order: 5, instruction: 'Confirm health endpoint returns OK', command: 'curl http://localhost:3001/api/health', note: 'Both db and ollama should be "ok". Ollama can be "unreachable" if not needed.' },
    ],
  },
  {
    project: 'devbrain',
    title: 'Debug Ollama / AI Not Responding',
    tags: ['debug', 'ollama', 'ai'],
    steps: [
      { id: '1', order: 0, instruction: 'Check Ollama process is running', command: 'ollama list', note: 'If no output or error, start Ollama from the system tray or run `ollama serve`' },
      { id: '2', order: 1, instruction: 'Check which models are loaded in VRAM', command: 'ollama ps', note: 'RTX 2060 has 6GB. mistral (4.66GB) + nomic-embed-text (~300MB) should fit together.' },
      { id: '3', order: 2, instruction: 'Test the Ollama API directly', command: 'curl http://localhost:11434/api/tags', note: 'Should return a JSON list of available models' },
      { id: '4', order: 3, instruction: 'If mistral is missing, pull it', command: 'ollama pull mistral' },
      { id: '5', order: 4, instruction: 'If nomic-embed-text is missing, pull it', command: 'ollama pull nomic-embed-text' },
      { id: '6', order: 5, instruction: 'Send a test chat message to confirm responses', command: 'curl -s http://localhost:11434/api/chat -d \'{"model":"mistral","messages":[{"role":"user","content":"hi"}],"stream":false}\'', note: 'Should return a JSON response within ~30s on cold start, ~3s warm.' },
      { id: '7', order: 6, instruction: 'Check DevBrain health endpoint — ollama should now be "ok"', command: 'curl http://localhost:3001/api/health' },
    ],
  },
  {
    project: null,
    title: 'Investigate Node.js Memory Leak',
    tags: ['debug', 'nodejs', 'memory'],
    steps: [
      { id: '1', order: 0, instruction: 'Check current memory usage of the Node process', command: 'node -e "const m = process.memoryUsage(); console.log(JSON.stringify(m, null, 2))"', note: 'heapUsed climbing over time is the key signal' },
      { id: '2', order: 1, instruction: 'Enable --inspect and connect Chrome DevTools', command: 'node --inspect index.js', note: 'Open chrome://inspect in Chrome, click "Open dedicated DevTools for Node"' },
      { id: '3', order: 2, instruction: 'Take a heap snapshot baseline in DevTools Memory tab' },
      { id: '4', order: 3, instruction: 'Reproduce the leak by sending requests or waiting', note: 'Watch the Allocation Timeline for objects not being GCd' },
      { id: '5', order: 4, instruction: 'Take a second heap snapshot and compare with first', note: 'Look for objects with high retained size that grew between snapshots' },
      { id: '6', order: 5, instruction: 'Check for common leak patterns: event listeners, closures in setInterval, unclosed DB connections', note: 'pool.connect() without client.release() is a frequent pg culprit' },
      { id: '7', order: 6, instruction: 'Check DB connection pool size', command: 'SELECT count(*) FROM pg_stat_activity WHERE application_name = \'node-postgres\';', note: 'Run in psql. Should not climb unbounded.' },
    ],
  },
  {
    project: 'playcru',
    title: 'Debug Firebase Cloud Function Error',
    tags: ['debug', 'firebase', 'cloud-functions'],
    steps: [
      { id: '1', order: 0, instruction: 'Check Cloud Functions logs for the error', command: 'firebase functions:log --project playcru-dev', note: 'Add --only=functionName to filter to a specific function' },
      { id: '2', order: 1, instruction: 'Identify the error type — cold start, timeout, or exception' },
      { id: '3', order: 2, instruction: 'Reproduce locally with emulator', command: 'firebase emulators:start --only firestore,functions --project playcru-dev' },
      { id: '4', order: 3, instruction: 'Check region — all PlayCru functions must be asia-southeast1', note: 'Wrong region causes latency and billing issues. Confirm in function definition: region("asia-southeast1")' },
      { id: '5', order: 4, instruction: 'Check for Firestore security rule rejections in logs', note: 'Look for "Missing or insufficient permissions" in function logs' },
      { id: '6', order: 5, instruction: 'Deploy the fix to staging', command: 'firebase deploy --only functions --project playcru-dev' },
      { id: '7', order: 6, instruction: 'Monitor logs for 5 minutes after deploy to confirm resolution', command: 'firebase functions:log --project playcru-dev' },
    ],
  },
]

let seeded = 0
for (const rb of RUNBOOKS) {
  const projectId = rb.project ? bySlug[rb.project] : null
  const { rowCount } = await c.query(
    `INSERT INTO runbooks (project_id, title, tags, steps)
     SELECT $1, $2, $3, $4::jsonb
     WHERE NOT EXISTS (SELECT 1 FROM runbooks WHERE title = $2)`,
    [projectId, rb.title, rb.tags, JSON.stringify(rb.steps)]
  )
  if ((rowCount ?? 0) > 0) seeded++
}
console.log(`✓  ${seeded}/${RUNBOOKS.length} runbooks seeded`)

c.release()
await pool.end()
console.log('\n✅  Migration complete.')

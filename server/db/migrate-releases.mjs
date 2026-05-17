/**
 * Migration: seed DevBrain release history
 * Safe to re-run — inserts use ON CONFLICT DO NOTHING
 */
import pg from 'pg'
const { Pool } = pg

const pool = new Pool({
  user: 'devbrain', host: 'localhost', port: 5433,
  database: 'devbrain', password: 'devbrain',
  connectionTimeoutMillis: 5000,
})

const c = await pool.connect()

const { rows: [devbrain] } = await c.query(
  `SELECT id FROM projects WHERE short_name = 'devbrain'`
)
if (!devbrain) { console.error('DevBrain project not found — run server first'); process.exit(1) }
const dbId = devbrain.id
console.log('✓  DevBrain project id:', dbId)

const RELEASES = [
  {
    version: 'v0.1.0',
    date: '2026-05-10',
    type: 'major',
    features: [
      'Initial project scaffold with React + Vite + TypeScript frontend',
      'Express + TypeScript backend with PostgreSQL (pgvector:pg16 on Docker)',
      'Projects CRUD with color-coded project cards and status badges',
      'Document upload: PDF, DOCX, MD, TXT, XLSX, URL ingestion',
      'Document chunking and nomic-embed-text embedding via Ollama',
      'Full-text search with PostgreSQL tsvector',
    ],
    fixes: [],
    breaking_changes: [],
    notes: 'First working build of DevBrain. Core infrastructure: multi-project support, document ingestion pipeline, and pgvector semantic search foundation.',
  },
  {
    version: 'v0.2.0',
    date: '2026-05-12',
    type: 'minor',
    features: [
      'RAG chat page with streaming SSE responses (Phase 3)',
      'Citation cards showing source document, chunk index, and similarity score',
      'Scope selector: query all docs, project docs, or a single document',
      'Streaming typewriter render with animated cursor',
    ],
    fixes: [
      'Fixed Ollama cold-start timeout — first request after boot no longer fails',
      'Fixed port 5432 conflict by moving Docker postgres to port 5433',
      'Fixed tsx watch not finding entry point (was pointing to src/index.ts)',
    ],
    breaking_changes: [
      'DATABASE_URL now requires port 5433 (Docker pgvector) instead of 5432',
    ],
    notes: 'RAG chat is now live. Ask questions against your documents with full citation support. Mistral 7B on RTX 2060 answers in ~3-5 seconds.',
  },
  {
    version: 'v0.3.0',
    date: '2026-05-13',
    type: 'minor',
    features: [
      'Issues tracker with status/priority workflow (Phase 4)',
      'Investigation steps with drag-and-drop reorder and checkbox completion',
      'Time-stamped notes feed per issue',
      'AI Summarize button — generates resolution summary from steps + notes',
      'New project modal fix: submit button now correctly submits the form',
    ],
    fixes: [
      'Fixed globalThis.crypto.randomUUID usage in browser (was using Node crypto module)',
      'Fixed TypeScript TS2367 narrowing error in issues route PUT handler',
      'Fixed Zod .trim().default() chain order in server validation',
    ],
    breaking_changes: [],
    notes: 'Full investigation workflow for tracking and resolving bugs. AI summarization uses Ollama to generate resolution notes from investigation history.',
  },
  {
    version: 'v0.4.0',
    date: '2026-05-14',
    type: 'minor',
    features: [
      'Tasks board with 4-column Kanban layout: In Progress / To Do / Done / Cancelled (Phase 4)',
      'Quick-add bar with priority selection per column',
      'Task detail panel: status, priority, project, due date, description',
      'Auto-stamps done_at timestamp when task moved to Done',
      'Commands library with Shiki syntax highlighting (Phase 5)',
      'Copy-to-clipboard with 2-second confirmation overlay',
      'Ctrl+K quick-copy palette with arrow-key navigation',
      'AI Explain button — generates per-command explanation via Ollama',
      'Favorite commands with ★ toggle and filter chip',
      'DevBrain project seeded with 10 commands, 3 issues, 10 tasks',
    ],
    fixes: [
      'Fixed TypeScript TS2367 in tasks route PUT handler (same narrowing issue as issues)',
    ],
    breaking_changes: [],
    notes: 'Two major features: Kanban task board for tracking work items, and a full commands library with Shiki-powered syntax highlighting and AI explanations.',
  },
  {
    version: 'v0.5.0',
    date: '2026-05-15',
    type: 'minor',
    features: [
      'Release notes timeline with semver ordering (Phase 6)',
      'AI generation from raw git commit messages — auto-categorizes into features/fixes/breaking changes',
      'Color-coded release type badges: major (red), minor (indigo), patch (green), hotfix (amber)',
      'Inline edit modal for all release fields',
      'Collapsible release cards on the vertical timeline',
    ],
    fixes: [],
    breaking_changes: [],
    notes: 'Release notes are now tracked in DevBrain itself. Paste your git log and let Ollama categorize the changes automatically.',
  },
]

for (const r of RELEASES) {
  await c.query(
    `INSERT INTO releases
       (project_id, version, date, type, features, fixes, breaking_changes, notes, linked_issues)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, version) DO NOTHING`,
    [dbId, r.version, r.date, r.type, r.features, r.fixes, r.breaking_changes, r.notes, []]
  )
}
console.log(`✓  ${RELEASES.length} DevBrain releases seeded`)

c.release()
await pool.end()
console.log('\n✅  Migration complete.')

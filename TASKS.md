# TASKS.md — DevBrain (Work Knowledge Base)

## Phase 1 — Foundation & Project System ✅ COMPLETE

### Environment Setup
- [x] Scaffold Vite + React + TypeScript project
- [x] Apply design tokens from Claude Design file into Tailwind config
- [x] Set up Docker Compose: PostgreSQL (pgvector:pg16 on port 5433), Ollama, app server
- [x] Configure NVIDIA GPU passthrough in docker-compose.yml for RTX 2060 Max-Q
- [x] Pull Ollama models: `mistral:7b`, `nomic-embed-text` (gemma3:4b optional)
- [x] Verify GPU is used — mistral at ~47 t/s, full model in VRAM (4.66 GB / 6 GB)
- [x] Set up Express + TypeScript server with tsx watch
- [x] Set up environment config with dotenv + Zod validation (lib/env.ts)
- [ ] Implement local JWT auth (bcrypt + jsonwebtoken) — in progress, tracked as task

### Database Schema
- [x] Create `projects` table with all fields including `color`, `status`, `tech_stack[]`, `type`
- [x] Create `documents` table + `document_chunks` table with pgvector `embedding VECTOR(768)` column
- [x] Create `issues` table with `investigation_steps` (JSONB) + `notes` (JSONB)
- [x] Create `commands` table with `tsv` full-text index and `is_favorite`, `last_used`
- [x] Create `releases` table with `features/fixes/breaking_changes TEXT[]`
- [x] Create `runbooks` table with `steps` (JSONB) — schema ready, route in Phase 7
- [x] Enable pgvector extension: `CREATE EXTENSION IF NOT EXISTS vector`
- [x] Create HNSW index on `document_chunks.embedding` (m=16, ef_construction=64)
- [x] Write migration scripts (setup-db.mjs, migrate-tasks-devbrain.mjs, migrate-releases.mjs)

### Project Seeding (runs on first launch)
- [x] Build `server/db/seed.ts` — checks if projects table empty, inserts SEED_PROJECTS
- [x] Seed all 5 projects: PlayCru, WealthView Pro, Memex, DevBrain, Music Player with correct colors + stack
- [x] Seed starter commands for all projects via migrate-tasks-devbrain.mjs (10 DevBrain commands)
- [x] Seed DevBrain issues (3 resolved issues documenting the build process)
- [x] Seed DevBrain tasks (10 tasks — mix of done / todo / in_progress)
- [x] Call seed on server start if DB is fresh
- [x] Add `POST /api/projects/seed/reset` endpoint for dev reset

### Unified AI Client
- [x] Build `server/services/ai.ts` — single export for `aiChat()`, `aiEmbed()`, `aiChatStream()`
- [x] Implement Ollama path (default): chat, embed, streaming
- [x] Implement Claude API path (USE_CLAUDE=true): chat, streaming with claude-sonnet-4-6
- [x] Toggle works via env: `USE_CLAUDE=true` in `.env` → routes through Claude API
- [x] All routes go through `services/ai.ts` — no direct Ollama/Claude calls from routes

### Project API + UI
- [x] Project CRUD API (`/api/projects` — GET, POST, PUT, DELETE)
- [x] Projects list page — cards with color dot, name, tech stack chips, status badge, doc/issue/command counts
- [x] Create/edit project modal — name, description, color picker, tech stack input, type, repo URL
- [x] **Project switcher** in top nav — dropdown with colored dots, currently selected project highlighted
- [x] "All Projects" option in switcher — shows global views
- [x] Persist selected project in Zustand store + localStorage

---

## Phase 2 — Document System ✅ COMPLETE

### Parsing & Ingestion
- [x] Build `server/services/parser.ts`:
  - [x] PDF: `pdf-parse` → plain text
  - [x] DOCX: `mammoth` → markdown
  - [x] MD/TXT: read directly
  - [x] XLSX: `xlsx` package → stringify tables
  - [x] URL: fetch via `https://r.jina.ai/{url}` (free, no key)
- [x] Build `server/services/embedder.ts`:
  - [x] Chunk text: 512 tokens, 64-token overlap
  - [x] Embed each chunk via `aiEmbed()` (nomic-embed-text, ~50ms/chunk on RTX 2060)
  - [x] Store chunks + embeddings in `document_chunks`
- [x] `POST /api/documents` — upload file, parse, embed, store (multipart/form-data)
- [x] `POST /api/documents/url` — URL input, fetch, parse, embed, store
- [x] `GET /api/documents` — list with project filter + full-text search
- [x] `PATCH /api/documents/:id` — update title, tags, project assignment
- [x] `DELETE /api/documents/:id` — delete doc + all its chunks

### Document UI
- [x] Documents list page — table: title, type badge (color-coded), project dot, chunk count, date
- [x] Upload area — drag-and-drop multi-file + URL input field in same panel
- [x] Duplicate detection via SHA-256 content hash — prompts to re-assign project
- [x] Document detail panel — full text, tags, project, metadata
- [x] Tag management on document
- [x] Link document to project (or leave global)

---

## Phase 3 — Document Q&A / Ask AI ✅ COMPLETE

### RAG Backend
- [x] Build `server/services/rag.ts` / `embedder.ts`:
  - [x] Embed query via `aiEmbed()` (nomic-embed-text)
  - [x] pgvector cosine similarity: `embedding <=> $1 LIMIT 5`
  - [x] Support scope: all docs / by project / by single document
  - [x] Return top chunks with source document title, chunk index, similarity score
- [x] `POST /api/chat` — SSE streaming: sends `citations` event, then `chunk` events, then `[DONE]`
- [x] Citation info from chunks — document title, chunk index, score, excerpt

### Chat UI (DocChat page)
- [x] Split layout: left panel = document list, right = chat
- [x] Scope selector: "All Docs" / "This Project" / "This Document"
- [x] Streaming response rendering — typewriter effect via SSE with animated cursor
- [x] Source citation cards below each answer — collapsible `<details>`, doc title, score, excerpt
- [x] Markdown rendering (headings, lists, code blocks, bold/italic, inline citations)
- [x] Clear chat button + Enter to send / Shift+Enter for newline

---

## Phase 4 — Issue Tracker ✅ COMPLETE

### Issue Backend
- [x] Issue CRUD API (`/api/issues` — GET, POST, PUT, DELETE)
- [x] `GET /api/issues` — filter by project, status, priority, full-text search (tsvector)
- [x] `POST /api/issues/:id/notes` — add timestamped note (JSONB append)
- [x] `DELETE /api/issues/:id/notes/:noteId` — remove note
- [x] `PUT /api/issues/:id` — update steps (reorder, check/uncheck), resolution, status
- [x] Auto-stamps `resolved_at` when status set to `resolved`
- [x] `POST /api/issues/:id/summarize` — AI generates summary from steps + notes + resolution

### Issue UI
- [x] Issues list — rows with project dot, title, priority badge, step progress X/Y, status badge, date
- [x] Priority badges: Critical=red, High=orange, Medium=amber, Low=blue
- [x] Status chips: Open, Investigating, Resolved, Won't Fix
- [x] Filter bar: search, status, priority
- [x] Issue detail panel:
  - [x] Title (editable), priority dropdown, status dropdown
  - [x] Investigation steps — ordered checklist with HTML5 drag-to-reorder, add/delete steps
  - [x] Notes feed — reversed chronological, add/delete notes
  - [x] Resolution textarea (auto-save on blur)
  - [x] AI Summarize button — calls `aiChat()`, renders result inline
- [x] Create issue modal — title, description, priority, project selector
- [x] 3 DevBrain issues pre-seeded (pgvector setup, Ollama cold-start, Tasks feature)

---

## Phase 5 — Commands Library ✅ COMPLETE

### Commands Backend
- [x] Commands CRUD API (`/api/commands` — GET, POST, PUT, DELETE)
- [x] `GET /api/commands` — filter by project, language, isFavorite, full-text search (tsvector)
- [x] `POST /api/commands/:id/use` — update `last_used` timestamp
- [x] `POST /api/commands/:id/explain` — AI explains command using `aiChat()`
- [x] Full-text search on title + description + command text (pg tsvector, GENERATED ALWAYS)

### Commands UI
- [x] Two-panel layout: 300px filterable list + full-width detail panel
- [x] Language badge color coding: bash=green, python=blue, dart=cyan, sql=amber, ts=indigo, ps=purple, yaml=pink
- [x] Shiki syntax highlighting (`github-dark` theme, 8 languages, async singleton, plain-text fallback)
- [x] Copy-to-clipboard with 2-second ✓ confirmation overlay on code block
- [x] "Explain with AI" button — calls explain endpoint, renders result inline, re-explain supported
- [x] Favorite toggle — ★ per card and in detail panel; favorite filter chip
- [x] Command editor modal — title, language, project, command textarea (mono), description, tags, favorite
- [x] **Ctrl+K command palette** — spotlight overlay with arrow-key nav, Enter to copy, auto-closes after copy
- [x] Language filter chips dynamically generated from loaded data
- [x] Debounced search (250ms), list count footer
- [x] 27 commands seeded across all projects (DevBrain + PlayCru + WealthView Pro + Music Player)

---

## Phase 6 — Release Notes ✅ COMPLETE

### Releases Backend
- [x] Releases CRUD API (`/api/releases` — GET, POST, PUT, DELETE)
- [x] `POST /api/releases/ai-generate` — paste commit messages → Ollama categorizes into features/fixes/breaking_changes/notes JSON
- [x] Unique constraint on `(project_id, version)` — returns 409 on duplicate version
- [x] project_id immutable after creation (can update version, date, type, sections)
- [x] `GET /api/releases` — filter by projectId, sorted by date DESC

### Releases UI
- [x] Vertical timeline: colored dot marker per release type, continuous line between releases
- [x] Type badges: major=red, minor=indigo, patch=green, hotfix=amber
- [x] Collapsible release cards — click header to expand/collapse; collapsed shows item counts
- [x] Three content sections: ⚠ Breaking Changes (red, first), ✦ Features (green), ○ Fixes (gray)
- [x] Stats header: type count badges + footer showing total releases / features shipped / fixes
- [x] New Release modal with shared Edit modal — version, date, type, project (when global view)
- [x] **AI Generate panel** inside modal — paste git log → auto-fills all sections via Ollama
- [x] ItemList editor — inline add/remove per bullet per section
- [x] Empty state with create prompt
- [x] 5 DevBrain releases pre-seeded (v0.1.0–v0.5.0) documenting the actual build history

---

## Phase 7 — Runbooks ✅ COMPLETE

### Runbooks Backend
- [x] Runbooks CRUD API (`/api/runbooks`)
- [x] Steps stored as JSONB with order, instruction, optional command reference
- [x] `POST /api/runbooks/:id/use` — update lastUsedAt

### Runbooks UI
- [x] Runbooks list page — grouped by project, show step count, last used date
- [x] Runbook detail — numbered step list, command blocks with copy button per step
- [x] Create/edit runbook — title, tags, project, add/reorder steps (drag handles), link command to step
- [x] "Start from Runbook" on new issue — pick runbook → pre-populate investigation steps
- [x] "Mark as used" — updates lastUsedAt, floats to top of recent

### Markdown Task Import
- [x] `POST /api/tasks/import-md` — parse uploaded `.md` file, extract `- [ ]` / `- [x]` checkboxes, group by nearest `##` heading, bulk-insert into tasks table
- [x] Map `- [ ]` → status `todo`, `- [x]` → status `done`
- [x] Use `##` section heading as tag on each imported task (e.g. "Phase 7 — Runbooks")
- [x] Skip non-checkbox lines (headings, prose, tables)
- [x] Return summary: `{ created: N, skipped: N }` — skip exact title duplicates (ON CONFLICT DO NOTHING)
- [x] "Import from Markdown" button in Tasks page header → file picker (`.md` only) → calls endpoint → shows result toast

---

## Phase 8 — Search & Dashboard ✅ COMPLETE

### Global Search (⌘K)
- [x] Upgrade Ctrl+K palette (currently commands-only) to search across all types
- [x] Search simultaneously across: docs, issues, commands, releases, runbooks
- [x] ILIKE full-text search across all types (pgvector semantic search deferred to backlog)
- [x] Results grouped by type with project color dot
- [x] Keyboard navigation (↑↓ arrows, Enter to open)
- [x] Filter to specific project via chip above results

### Global Dashboard
- [x] Summary cards: total docs, open issues, total commands, releases, runbooks
- [x] Open issues widget — top 5 by priority with project color dot
- [x] Pinned commands widget — favorites from all projects
- [x] Recent releases widget
- [x] Per-project mini cards (global view only)

### Per-Project Dashboard
- [x] Project header: name, color bar, tech stack chips, description
- [x] Stats row: doc count, issue count (open/total), command count, release count, runbook count
- [x] Recent open issues, recent releases, favorite commands

---

## Phase 9 — Polish ✅ COMPLETE

### UX
- [ ] Loading skeletons for all async states — skipped (app is fast enough on local)
- [x] Toast notification system (success, error, info) — `ToastProvider` + `useToast()` hook, 3.5s auto-dismiss
- [x] Keyboard shortcuts cheatsheet modal (`?` key)
- [ ] Drag-and-drop for investigation steps and runbook steps (dnd-kit) — skipped (HTML5 DnD already works)
- [x] Confirm dialog for destructive actions — delete confirm modal on projects; cascade warning text included

### Settings Page
- [x] Export all data as JSON (full backup) — `GET /api/settings/backup`, browser download via blob URL
- [ ] Import data from JSON backup — skipped (complex, risky for v1)
- [x] Re-seed projects (with confirmation) — via Settings page + existing Projects page button
- [x] AI config — shows backend (ollama/claude), chat model, embed model, Ollama URL

### Auth
- [x] Implement local JWT auth (jsonwebtoken) — single user v1, 30-day token in localStorage
- [x] Protect all API routes behind `requireAuth` middleware — unprotected: `/api/health`, `/api/auth/*`
- [x] Login page with password — centered branded form, error state, auto-redirect on success
- [x] `AUTH_PASSWORD` env var optional — when unset, dev mode (no auth gate, auto-issue token)

### Data Integrity
- [x] Cascade delete warnings: delete confirm modal warns all project data will be deleted
- [x] Content hash deduplication already live for documents ✓

---

## Phase 10 — Search & AI Upgrades ✅ COMPLETE

### Hybrid Search (⌘K upgrade)
- [x] Docs: pgvector cosine similarity on `document_chunks.embedding` → DISTINCT ON doc, re-sort by distance
- [x] Issues: `tsvector @@ plainto_tsquery` with `ts_rank`, fallback to ILIKE when no FTS match
- [x] Commands: same tsvector + fallback pattern
- [x] Releases / Runbooks: keep ILIKE (no tsv column)
- [x] Empty query: show recent items per type instead of nothing
- [x] Graceful Ollama fallback: if embedding fails, fall back to tsvector/ILIKE for docs

### Activity Feed (Dashboard)
- [x] `GET /api/dashboard` — add `activity` array: UNION ALL across docs/issues/commands/releases/runbooks
- [x] Return type, id, label, project_name, project_color, created_at — last 15 items ordered by created_at DESC
- [x] Dashboard UI: new "Recent Activity" section — icon per type, relative timestamp, project dot

### Pagination
- [x] `GET /api/documents` — accept `limit` (default 25, max 100) + `offset`; return `{ items, total }` 
- [x] `GET /api/issues` — same pagination shape
- [x] `GET /api/commands` — same pagination shape
- [x] Documents page: "Load more" button, appends next page; reset on filter/project change
- [x] Issues list: same "Load more" pattern
- [x] Commands list: same "Load more" pattern

### AI: Related Issues
- [x] `GET /api/issues/related?q=text` — tsvector `plainto_tsquery` with `ts_rank`, top 3 results
- [x] New Issue modal: debounced (400ms) title lookup after ≥3 chars, show "Similar issues" inline

### Loading Skeletons
- [x] `Skeleton.tsx` component — animated gray shimmer bar, configurable width/height
- [x] Documents page: skeleton rows while loading
- [x] Issues list: skeleton rows while loading
- [x] Commands list: skeleton rows while loading

---

## Phase 11 — AI Power Features, Integrations & UX Completion

### AI: Issue Intelligence
- [x] Auto-generate runbook from resolved issue — "Save as Runbook" button on a resolved issue; maps `investigation_steps` → runbook steps, pre-fills title + tags, opens in Runbooks page
- [x] Smart command suggestions on issue detail — sidebar panel shows top 5 semantically related commands (pgvector on issue title + description vs command title + description embeddings)
- [x] Issue embeddings — store `nomic-embed-text` embedding on each issue (create/update); needed for command suggestion similarity

### AI: Release Intelligence
- [x] `POST /api/releases/:id/qa` — Q&A over a single release's features/fixes/breaking-changes/notes via Ollama
- [x] `POST /api/releases/compare` — "What changed between v1.x and v2.x?" across two releases; generates a diff summary via Ollama
- [x] Releases page UI — "Ask about this release" input field per release card; "Compare releases" picker in header

### Integrations
- [x] GitHub commit import — `POST /api/releases/import-git` accepts raw `git log --oneline` text (already partially supported); add structured `git log --pretty=format:"%h %s"` parser and optional GitHub API fetch by repo + tag range
- [x] JSON backup import — `POST /api/settings/import` accepts a backup JSON file; dry-run mode shows what would be created; skips duplicates (ON CONFLICT DO NOTHING); returns `{ created, skipped }` summary
- [x] Import UI in Settings page — file picker for `.json` backup files, progress indicator, result toast

### UX Completion
- [x] Document tags on upload — tag input in DropZone; chips rendered before upload; cleared on submit; passed to both file upload and URL import
- [x] Release → Issue navigation — linked_issues rendered as accent chips in ReleaseCard; click dispatches `devbrain:navigate` + `devbrain:open-issue` events; App.tsx routes to Issues; IssuesPage opens the issue
- [x] Issues bulk actions — checkbox per row + select-all header; bulk toolbar (Mark Resolved, Won't Fix, Delete with confirm); clears on filter/load
- [x] Commands bulk import — "↑ Import" button in header; accepts `.sh`/`.bash`/`.zshrc`; parses `# comment\ncommand` blocks; creates one command per block; success toast with count
- [x] Runbooks page — "✓" Mark as Used button added to each list card; calls API and updates last_used_at inline without navigating to detail

### Org Mode (v2 foundation)
- [ ] Multi-user auth — role-based: viewer / editor / admin per project; extend `JWT_SECRET` + add `users` table
- [ ] LDAP/SSO integration — optional, configured via env vars
- [ ] Shared command library — personal namespace + team namespace per project
- [ ] Audit log — `audit_events` table; log create/update/delete actions with user + timestamp

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically; nomic is tiny (~300MB) so co-exists fine |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |

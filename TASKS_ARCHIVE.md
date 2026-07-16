# TASKS_ARCHIVE.md — DevBrain Completed Phases

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
- [x] Implement local JWT auth (bcrypt + jsonwebtoken) — multi-user RBAC, LDAP optional, audit log

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

## Phase 11 — AI Power Features, Integrations & UX Completion ✅ COMPLETE

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
- [x] Multi-user auth — role-based: viewer / editor / admin per project; `users` + `project_members` tables; backward-compatible JWT migration; first-run auto-creates admin from AUTH_PASSWORD
- [x] LDAP/SSO integration — optional, env-var driven (`LDAP_URL` etc.); dynamic import of ldapjs (graceful no-op if not installed); binds as user to verify password
- [x] Shared command library — personal namespace + team namespace per command; filter chips (👥 Team / 🔒 Personal) in sidebar; namespace field in create modal; personal badge on card; server filters by namespace + user
- [x] Audit log — `audit_events` table; `logAudit()` non-fatal service; all user/project mutations logged; `GET /api/audit` (admin only) with filters; AuditLog component in Settings (admin only, paginated)

---

## Phase 12 — Integrations & Platform Expansion ✅ COMPLETE

### Git Integration
- [x] `POST /api/git/:id/repo` — store repo URL + optional GitHub PAT (AES-256-GCM encrypted in DB)
- [x] `GET /api/git/:id/commits` — fetch recent commits via GitHub API
- [x] `GET /api/git/:id/compare` — commits between two refs (for release auto-populate)
- [x] Commit list widget on per-project dashboard — SHA, message, author, date; link to GitHub
- [x] "Link commit" action on issue detail — attach a commit SHA to an issue (`linked_commits TEXT[]`)
- [x] `POST /api/issues/:id/commits` + `DELETE` — append/remove SHA; chips in issue detail
- [x] PR link support — store PR URL on issue (`pr_url TEXT`); open in browser on click

### Jira / Linear Sync
- [x] Settings: Jira config section — base URL, email, API token (AES-256-GCM, stored in `app_settings`)
- [x] Settings: Linear config section — API key (encrypted)
- [x] `POST /api/integrations/jira/preview` + `/import` — JQL query, maps priority/status
- [x] `POST /api/integrations/linear/preview` + `/import` — GraphQL team query
- [x] Import modal in Issues page — source (Jira / Linear), JQL/team key, max results, import

### Progressive Web App (PWA / Offline)
- [x] `vite-plugin-pwa` — generates service worker + web manifest
- [x] Workbox NetworkFirst caching for key API routes (projects, commands, releases, runbooks)
- [x] Offline banner — yellow strip when `navigator.onLine === false`
- [x] App manifest — name, icons, theme `#0A0A0F`, display standalone

### Cloud / Multi-Device Hosting
- [x] `docker-compose.prod.yml` — Caddy + app + postgres; required secrets validated at start
- [x] `Caddyfile` — reverse proxy to app, gzip, security headers, static asset caching
- [x] `scripts/deploy.sh` — build client + docker compose up --build
- [x] `scripts/backup.sh` — pg_dump to timestamped .sql.gz, prune to 30 backups
- [x] `scripts/restore.sh` — gunzip | psql with confirmation prompt

---

<!-- archived_on: 2026-05-20 -->

## Phase 13 — Security Hardening ✅ COMPLETE

### Authentication & Token Security
- [x] Rate-limit `/api/auth/login` — `express-rate-limit`: max 10 attempts per 15 min per IP; return 429 with `Retry-After` header
- [x] Remove legacy token admin fallback — tokens missing `userId` must return 401, not grant admin; force re-login
- [x] Add `iss` and `aud` claims to JWT signing and verification — prevents tokens from other services being accepted
- [x] Move JWT from localStorage to HttpOnly cookie — eliminates XSS token theft; update `requireAuth` to read from cookie; keep `Authorization` header as fallback for API clients
- [x] Fix timing attack on login — run `bcrypt.compare` even when user is not found (compare against a dummy hash) so response time doesn't leak username existence

### Authorization & Audit
- [x] Audit log: add `logAudit()` to `POST /api/auth/change-password` — password changes must be visible in audit trail
- [x] Admin password reset confirmation — require admin to re-enter their own password before resetting another user's; add `logAudit()` with `action: 'update'` on the affected user
- [x] Add HTTPS enforcement option — env var `FORCE_HTTPS=true` adds HSTS header + HTTP→HTTPS redirect middleware; document in `.env.example`

### Input & SQL Safety
- [x] Replace `Object.keys(updates)` with explicit column allowlists in all dynamic `PUT`/`PATCH` handlers — `commands.ts`, `documents.ts`, `issues.ts`, `users.ts`; use a `const UPDATABLE_COLS = new Set([...])` guard before building the `SET` clause
- [x] Fix manual SQL parameter index counting — replaced with `buildSetClause(cols, vals)` helper in `server/lib/db.ts`; used across commands, documents, issues, users
- [x] SSRF protection on URL document import — validate that the resolved host is not a private/loopback IP (`10.x`, `192.168.x`, `172.16–31.x`, `127.x`, `::1`) before fetching; return 422 with clear error

### Infrastructure Secrets
- [x] Move Docker Compose credentials to env file — replaced hardcoded `POSTGRES_PASSWORD`/`POSTGRES_USER`/`DATABASE_URL` with `${VAR:-default}` references; `JWT_SECRET` now required (no default); documented in `.env.example`
- [x] Add resource limits to Docker Compose — postgres capped at 512 MB / 1 CPU; app at 1 GB / 2 CPU

---

## Phase 14 — Architecture & Code Quality ✅ COMPLETE
> Baseline review scores: Architecture **5/10**, Code **5/10**. Structural debt that compounds with every feature added.

### Routing — Replace Custom Event System with React Router
- [x] Install `react-router-dom` v6 — wrap `App` in `<BrowserRouter>`
- [x] Map all current routes to URL paths: `/`, `/projects`, `/documents`, `/chat`, `/issues`, `/commands`, `/releases`, `/runbooks`, `/tasks`, `/settings`
- [x] Add project scoping to URLs — dropped in favour of `?project=:id` which achieves the same UX goal (refresh/history) without a full router restructure
- [x] Replace `window.dispatchEvent('devbrain:navigate')` with `useNavigate()` — remove all custom event listeners from `App.tsx`
- [x] Replace `window.dispatchEvent('devbrain:open-issue')` with URL param: `/issues?open=:id` — `IssuesPage` uses `useSearchParams`; `Releases.tsx` now calls `navigate('/issues?open=' + id)`
- [x] Persist selected project in URL (`?project=:id`) — `App.tsx` reads on mount; `ProjectSwitcher` updates URL on pick; `setRoute` preserves param across navigation
- [x] Add `<Link>` on all clickable cards — `IssueRow` and `CommandCard` use `<a href>` with Ctrl+click passthrough; `Commands.tsx` adds `?open=:id` URL param support

### Schema — Single Source of Truth
- [x] Consolidate all migrations into `schema.sql` — folds org-v2, phase12, tasks, FlowForge/NTBilling, embedding additions into one idempotent file; `npx tsx db/setup.ts` produces a complete DB on fresh install
- [x] Add `updated_at TIMESTAMPTZ` column to all tables (`projects`, `documents`, `issues`, `commands`, `releases`, `runbooks`, `tasks`, `users`) with `set_updated_at()` trigger; migration in `db/migrations/add_updated_at_and_embedding_status.ts`
- [x] Write `db/setup.ts` — single idempotent setup script that runs `schema.sql` then calls `runSeed()`; replaces the multi-script setup dance

### Data Integrity — Fix JSONB Race Conditions
- [x] Normalize `investigation_steps` into `issue_steps` table — schema added; migration script `db/migrations/normalize_issue_jsonb.ts`; all routes use new table
- [x] Normalize `notes` into `issue_notes` table — same; `POST /notes` is now a plain INSERT; `DELETE /notes/:id` is a row DELETE; no more JSONB race condition
- [x] Update `server/routes/issues.ts` to use new tables; GET list+detail join `issue_steps`/`issue_notes` with `json_agg`; client types unchanged (same response shape)

### Reliability — Embeddings & AI
- [x] Add `AbortController` with 30s timeout to all Ollama `fetch()` calls in `services/ai.ts` — prevents connection pool starvation on hung Ollama process
- [x] Replace fire-and-forget embed calls with tracked async — `embedding_status: 'pending'|'processing'|'done'|'failed'` column on `documents` and `issues`; `embedIssueAsync` updates status; status dot indicator in Documents list and preview panel
- [x] Add embedding retry endpoint `POST /api/documents/:id/reembed` and `POST /api/issues/:id/reembed` — allows manual repair of failed embeddings; "Re-embed" button shown in document preview panel when status is failed/pending

### Code Quality
- [x] Split `Issues.tsx` (1,318 lines) into: `IssuesList.tsx`, `IssueDetail.tsx`, `NewIssueModal.tsx`, `IssueRow.tsx`, `StepText.tsx`, `issueConstants.ts` — `Issues.tsx` root is now 63 lines
- [~] Replace manual SQL parameter index counting with `buildWhereClause` — utility exists in `server/lib/db.ts` but list routes use custom SQL (table aliases, tsv @@, IS NULL, namespace logic) that the simple equality utility can't replace without making code less readable; left as-is
- [x] Add `useCallback` + `useMemo` to `IssuesList` and `CommandsPage` — `toggleSelect`, `toggleSelectAll`, open count memoized; `selected`, `availableLangs`, update/delete/fav handlers wrapped
- [x] Add `AbortController` to debounced search inputs — `IssuesList` and `CommandsPage` cancel in-flight load on new search; `AbortError` silently swallowed
- [x] Add drag-and-drop bounds validation in `IssueDetail` — `onDrop` guards `splice(fromIdx,1)` with full bounds check
- [x] Add `<ErrorBoundary>` around each route in `App.tsx` — catches component crashes; shows "Something went wrong" with a reload button instead of blank white screen

### Search & Pagination
- [x] Make search result limit configurable — backend `?limit=N` (default 10, max 50); `GlobalSearch.tsx` passes limit, starts at 10, "Show more" button increments by 10 up to 50
- [x] Add request deduplication in `client/src/lib/api.ts` — in-flight map keyed by URL path; GET requests without a signal share the same promise; requests with signal (search/AbortController) bypass the cache

---

## Phase 15 — Design, Accessibility & Usability ✅ COMPLETE
> Baseline review scores: Design **6/10**, UI **4/10**, Usability **6/10**.

### Accessibility (A11y)
- [x] Add `aria-label` to all icon-only buttons (star/favorite toggle, delete, close ✕, mark-used ✓) — IssueDetail, IssueRow, CommandCard, CommandDetail, RunbookCard, NewIssueModal, ProjectModal, NewCommandModal, NewRunbookModal, GlobalSearch
- [x] Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to all modals — NewIssueModal, ProjectModal, NewCommandModal, NewRunbookModal, GlobalSearch, shortcuts modal; `aria-pressed` on toggle buttons
- [x] Fix `cursor: 'default'` on all `<button>` elements — global `cursor: pointer` in index.css; removed inline `cursor: 'default'` overrides
- [x] Add `tabIndex` and `onKeyDown` to all interactive card rows — IssueRow (`<a>` gets keyboard nav free), CommandCard (`<a>`), RunbookCard (div → `tabIndex={0}` + `onKeyDown` Enter/Space)
- [x] Add visible focus ring — `outline: 2px solid var(--accent)` on `:focus-visible` in index.css

### Responsive Layout
- [~] Make sidebar panels resizable — too complex for v1; deferred to Phase 22
- [x] Add responsive breakpoint at 900px — `@media (max-width: 900px)` in index.css; sidebar collapses to 56px, min touch targets 44px
- [x] Add mobile viewport meta tag and basic touch targets — already in `client/index.html`; 44px touch targets added

### URL-Driven State & Deep Links
- [~] Canonical URL per entity — uses `?open=:id` param which achieves same UX goal as path params
- [x] Add "Copy link" button on issue detail and command detail — copies `window.location.origin + /issues?open=:id` / `/commands?open=:id` to clipboard
- [x] Restore last-visited route and project from URL — already handled by React Router + `?project=` param (Phase 14)

### Design System Migration
- [x] Extract design tokens to `client/src/styles/tokens.css` — `:root {}` block + density/tint variants moved out of index.css; `@import './styles/tokens.css'` at top of index.css
- [~] Shared style constants `shared.ts` — too large a refactor for v1; deferred
- [x] Add enter/exit animations to modals — `modal-in` + `overlay-in` keyframes in index.css; `.modal-panel` / `.modal-overlay` classes applied to all dialogs

### Usability Improvements
- [x] Add runbook print/export view — `?print=1` URL param on RunbooksPage renders clean white print view; "⎙ Print" button opens in new tab from RunbookDetail
- [x] Increase ⌘K search to show 10 results by default + "show more" — done in Phase 14; verified
- [x] Add onboarding empty states — Issues (icon + CTA button), Commands (icon + CTA button), Documents (icon + helper text) all show helpful empty states
- [x] Add "recently viewed" trail — `useRecentlyViewed` hook in `client/src/hooks/`; tracked on IssueDetail + CommandDetail open; shown in Dashboard (section) and GlobalSearch (empty-query results)
- [x] Add keyboard shortcuts for primary actions — `N` opens new item on Issues, Commands, Runbooks pages; `G D/I/C/R` navigate to sections; shown in ? shortcuts modal

---

## Phase 16 — Testing & Reliability ✅ COMPLETE

### Testing Infrastructure
- [x] Set up **Vitest** for server-side and client-side unit/integration tests <!-- done: 2026-05-19 -->
- [~] Set up **Playwright** or **Cypress** for E2E testing — deferred to Phase 22
- [x] Configure `package.json` with `test` and `test:coverage` scripts <!-- done: 2026-05-19 -->
- [x] Implement CI check — `.github/workflows/ci.yml` runs typecheck + server tests on push/PR; `scripts/validate.ps1` for local use <!-- done: 2026-05-19 -->

### Unit & Integration Tests
- [x] Test `server/services/ai.ts`: Mock fetch; covers aiChat, aiEmbed, aiChatStream (Ollama path), ollamaReady <!-- done: 2026-05-19 -->
- [x] Test `server/services/parser.ts`: .md, .txt parsing; title extraction; unsupported extension error <!-- done: 2026-05-19 -->
- [x] Test `server/services/embedder.ts` (RAG core): Mock pool + aiEmbed; chunk count, DELETE+INSERT calls, onProgress callback <!-- done: 2026-05-19 -->
- [x] Test `server/lib/db.ts`: buildSetClause and buildWhereClause — all edge cases including null/undefined filter skip <!-- done: 2026-05-19 -->

### Reliability
- [x] Health check endpoint — `/api/health` already wired in `server/index.ts`; returns `{ db, ollama, status }` <!-- done: 2026-05-19 -->
- [x] Add retry logic for embedding operations — `embedWithRetry()` in `embedder.ts`; 3 attempts, 500ms×attempt backoff <!-- done: 2026-05-19 -->

---

## Phase 17 — Documentation & Developer Experience ✅ COMPLETE

### Documentation
- [x] Integrate **Swagger/OpenAPI** for the Express server to document all endpoints <!-- done: 2026-05-19 -->
- [x] Create a `CONTRIBUTING.md` with setup instructions and coding standards (referencing `GEMINI.md`) <!-- done: 2026-05-19 -->
- [x] Add inline JSDoc/TSDoc to complex service functions <!-- done: 2026-05-19 -->

### Developer Experience
- [x] Set up **ESLint** and **Prettier** with strict rules to match `GEMINI.md` mandates <!-- done: 2026-05-19 -->
- [x] Update `scripts/validate.ps1` to run lint, typecheck, and tests in one go <!-- done: 2026-05-19 -->

---

## Phase 18 — Claude Integration V2 ✅ COMPLETE

> Builds the DevBrain UI layer on top of the existing `integrations/claude-code/` hook foundation.
> Feature 3 (Sharing) scrapped. Build order: Curation schema → Discovery → Task Sync → Session Viewer.

### Design decisions
- Curation state stored in PostgreSQL (`claude_projects` table), not `~/.devbrain/projects.json`
- Scan root stored in `app_settings` (key: `claude_scan_root`), configurable from Settings UI
- No separate "Claude Projects" sidebar — discovered projects link to existing DevBrain projects via `fs_path` field
- Linked projects gain **Tasks** and **Sessions** tabs in project detail view
- File watcher covers all active + pinned projects simultaneously

### Step 1 — Curation Schema & API <!-- done: 2026-05-19 -->
- [x] Add `fs_path TEXT` column to `projects` table in `schema.sql` (nullable — not all projects have a linked path)
- [x] Add `claude_scan_root` key to `app_settings` defaults in `schema.sql`
- [x] Add `GET /api/settings/claude` and `PUT /api/settings/claude` endpoints in `settings.ts` — expose/update `claude_scan_root`
- [x] Add `PUT /api/projects/:id/link` endpoint — set/clear `fs_path` on a project; validate path exists on disk
- [x] Expose `fs_path` in `GET /api/projects` and `GET /api/projects/:id` responses

### Step 2 — Project Discovery <!-- done: 2026-05-19 -->
- [x] Add `gray-matter` to server deps (YAML frontmatter parser)
- [x] Write `server/services/claude-discovery.ts` — recursive scan up to 3 levels; qualify by CLAUDE.md / SESSION.md / TASKS.md; parse task completion %; auto-suggest project match by name similarity; cancellable via AbortController
- [x] Add `POST /api/claude-projects/scan` endpoint — runs discovery, returns candidates array
- [x] Update `integrations/claude-code/src/hooks/session-start.ps1` — per-phase summary in context block; 7-day archive sweep of completed tasks
- [x] Update `integrations/claude-code/src/skills/devbrain/SKILL.md` — append `<!-- done: YYYY-MM-DD -->` stamp when marking tasks complete
- [x] Define `TASKS_ARCHIVE.md` format: YAML frontmatter, sections grouped by phase, `archived_on` note per batch; append-only

### Step 3 — TASKS.md Sync <!-- done: 2026-05-19 -->
- [x] Add `chokidar` to server deps (file watcher)
- [x] Write `server/services/tasks-watcher.ts` — watch TASKS.md for all linked projects; parse on change; emit via SSE; debounce 300ms
- [x] Add `GET /api/claude-projects/:id/tasks` endpoint — return parsed task tree (phases + items + stats)
- [x] Add `GET /api/claude-projects/:id/tasks/watch` SSE endpoint — stream `task_update` events on file change
- [x] Client: `TasksTab.tsx` — phase accordion with completion bars; item rows with status markers; live SSE updates
- [x] Add Tasks tab to project detail view (only when `fs_path` is set)

### Step 4 — Session Viewer <!-- done: 2026-05-19 -->
- [x] Write `server/services/session-reader.ts` — scan SESSION.md files; parse frontmatter + sections; return structured summary + raw markdown
- [x] Add `GET /api/claude-projects/:id/sessions` — paginated, newest-first, `?status=` filter, `?q=` search
- [x] Add `GET /api/claude-projects/:id/sessions/:sessionId` — full session detail
- [x] Client: `SessionsTab.tsx` — timeline grouped by week; expandable session cards; filter bar; client-side search
- [x] Add Sessions tab to project detail view (only when `fs_path` is set)

### Step 5 — Discovery UI in Settings <!-- done: 2026-05-19 -->
- [x] Settings: "Claude Integration" section — scan root input + Save; "Scan Now" → results table with Link / Create / Ignore actions
- [x] Projects page: "Claude" chip badge on projects with `fs_path` set
- [x] Project detail: Tasks/Sessions tabs gated on `fs_path`; prompt to link folder when unset

---

## Phase 19 — Hardening & Quick Wins ✅ COMPLETE

> Ten concrete gaps found in the post-Phase-18 review. No new features — fix what's already broken or insecure.

### Security
- [x] **Complete localStorage → HttpOnly cookie migration on the client** (`client/src/lib/api.ts`) — removed `getToken`/`setToken`/`clearToken`; all fetches now use `credentials: 'include'`; `/me` and `/register` server routes updated to read/set cookie.
- [x] **Sanitize 500 error responses in production** — added `server/lib/errors.ts` `serverError()` helper + central Express error handler in `index.ts`; `auth.ts` and `documents.ts` updated to use helper.
- [x] **Add Zod to `change-password` route** (`server/routes/auth.ts`) — `ChangePasswordBody` schema added; raw cast removed.
- [x] **Rate-limit mutation and AI endpoints** — `mutationLimiter` (60 req/min) applied in `index.ts` on `POST /api/documents`, `/api/chat`, `/api/issues/:id/summarize`, `/api/commands/:id/explain`.

### Reliability
- [x] **Wrap `res.json()` in try/catch in client `api.ts`** — `_fetch` now catches `SyntaxError` and throws `'Unexpected server response'`.
- [x] **Add idle timeout to SSE streams** — 5-minute inactivity timeout added to `POST /api/chat` (resets on each write) and `GET /api/claude-projects/:id/tasks/watch`.
- [x] **Fix Multer temp directory for cross-platform dev** (`server/routes/documents.ts`) — replaced `/tmp/devbrain-uploads` with `path.join(os.tmpdir(), 'devbrain-uploads')`.

### Database
- [x] **Add indexes on `embedding_status` columns** — already present in `schema.sql` (`documents_emb_status_idx`, `issues_emb_status_idx`) as partial indexes.

### Code Quality
- [x] **Audit request deduplication cache key** (`client/src/lib/api.ts`) — verified: all list/get call sites build the full URL with query string before passing to `request()`; cache keys are correct.
- [x] **Parameterize LIMIT/OFFSET in `search.ts`** — all 13 `LIMIT ${PAGE}` occurrences replaced with `LIMIT $N` across both empty-query and non-empty-query branches.

---

## Phase 20 — E2E Testing & Quality ✅ COMPLETE

> Playwright E2E suite covering critical user paths. Safety net before new features land. Includes the resizable sidebar deferred from Phase 15.

### Setup
- [x] Add `@playwright/test` to `client/devDependencies` (`^1.49.0`)
- [x] Add `playwright.config.ts` — baseURL `http://localhost:5173`, Chromium only, screenshots + traces on failure, `webServer` block auto-starts Vite dev server
- [x] Add `test:e2e` script to `client/package.json`; E2E job added to `.github/workflows/ci.yml` with PostgreSQL service, trace upload on failure

### Test Suites
- [x] **Auth flow** — `e2e/auth.spec.ts`: unauthenticated visit, valid login → Dashboard, wrong password, logout → login; gracefully skips in dev mode
- [x] **Issue lifecycle** — `e2e/issues.spec.ts`: create → list, open detail → add note, change status to resolved
- [x] **Document upload** — `e2e/documents.spec.ts`: upload `.md` → appears in list, DocChat loads, SSE response streams in
- [x] **Command CRUD** — `e2e/commands.spec.ts`: create → star favorite → search by title → delete → verify gone
- [x] **Global search** — `e2e/search.spec.ts`: ⌘K opens modal, empty state shows recents, query returns results, Escape closes

### Deferred UX (resizable sidebar from Phase 15)
- [x] Resizable sidebar — drag handle on right edge of sidebar (`App.tsx`); width persisted to `localStorage` (`devbrain_sidebar_w`); clamped 180–420px; double-click resets to 220px

---

## Phase 21 — Export & Backup ✅ COMPLETE

> Protect existing data before building more on top. Full knowledge-base export to portable markdown zip, scheduled auto-backup, and import from backup.

### Export
- [x] `GET /api/export/project/:id` — stream a `.zip` containing one `.md` per document (YAML frontmatter + content), `issues.md` (all issues + steps + notes as sections), `commands.md`, `releases.md`, `runbooks.md`
- [x] `GET /api/export/all` — same but all projects; one subfolder per project inside the zip
- [x] Settings: Export section — project dropdown + "Export project" button; "Export all" button; file downloads as `devbrain-export-YYYY-MM-DD.zip`

### Scheduled Backup
- [x] Add `backup_path TEXT` and `backup_schedule TEXT` (`'daily' | 'weekly' | 'off'`) keys to `app_settings`
- [x] Server: 24-hour `setInterval` on startup — if schedule enabled and `backup_path` exists, run export and write zip to path; log result; update `last_backup_at` in `app_settings`
- [x] Settings: backup path input + schedule dropdown + "Backup now" button + last backup timestamp display

### Import
- [x] `POST /api/import` — accept zip upload; parse markdown frontmatter to reconstruct issues / documents / commands; skip duplicates by matching title + project
- [x] Settings: Import section — zip file upload input + "Dry run" toggle (returns diff of what would be created without writing); confirmation step before live import

---

## Phase 22 — Dashboard & Analytics ✅ COMPLETE

> Insight widgets that surface value from all the data already in the DB. CSS-only bar/grid charts — no chart library dependency.

### New API Endpoints
- [x] `GET /api/dashboard/stats` — open issue count per project, avg resolution time (days) per project, doc count, embedding failure count, commands added this week
- [x] `GET /api/dashboard/activity` — daily event counts (issues opened, issues resolved, docs added, commands added) for last 35 days; keyed by date string

### Widgets
- [x] **Open Issues by Project** — horizontal bar chart; one bar per project, colored with project color, value label on right
- [x] **Avg Resolution Time** — bar chart; days per project for last 30 days; "No data" state when no resolved issues
- [x] **Activity Heatmap** — 5-week × 7-day grid (GitHub contribution style); cells shaded by total event count; tooltip on hover shows date + count
- [x] **Embedding Health** — three labeled counts (done / pending / failed) with colored dots; "Retry all failed" button calls existing `POST /api/documents/:id/reembed` for each failed doc
- [x] **Stale Issues** — issues open > 14 days with no note in that period; listed with priority badge + one-click "Mark investigating" action

### layout
- [x] Dashboard: responsive widget grid on screens ≥ 420px per column; single column below
- [x] Each widget: header with title; analytics data fetched on mount alongside main dashboard data

---

## Phase 22.5 — Enhanced Ingestion (MarkItDown) ✅ COMPLETE

> Improve RAG quality by converting all ingested files to structured Markdown.

- [x] Create Python bridge `server/scripts/markitdown_bridge.py` to interface with Microsoft MarkItDown
- [x] Update `server/services/parser.ts` to prefer MarkItDown for PDF, DOCX, XLSX, PPTX
- [x] Implement JS fallbacks for all formats to ensure system works without Python environment
- [x] Add PPTX/PPT support via MarkItDown

---

## Phase 23 — AI Enhancements ✅ COMPLETE

### Auto-tagging
- [x] On document upload: call `gemma3:4b` with title + first 500 chars → suggest up to 5 tags; show as dismissable "Suggested" chips in the upload form before save
- [x] On issue create: same pattern — suggest tags from title + description; chips appear below the tags input

### Command Explanation
- [x] Add `explanation TEXT` column to `commands` table in `schema.sql`
- [x] Add `POST /api/commands/:id/explain` — send command text to `gemma3:4b`; store + return explanation
- [x] Command detail panel: "✦ Explain" button; explanation rendered below the code block; "Regenerate" icon to refresh

### Issue Summarization
- [x] Add `summary TEXT` column to `issues` table in `schema.sql`
- [x] Add `POST /api/issues/:id/summarize` — run `mistral:7b` over steps + notes → produce 3-bullet TL;DR; store in `summary` column
- [x] Issue detail: "✦ Summarize" button; summary card rendered above steps accordion; "Regenerate" icon

### Release Note Drafting
- [x] Add `POST /api/releases/draft` — accepts `{ projectId, from: ISO, to: ISO, issueIds?: string[] }`; fetches resolved issues in range; runs `mistral:7b` to draft Features / Fixes / Breaking Changes sections; returns a pre-filled `Release` object
- [x] Releases page: "✦ Draft with AI" button → modal with date range picker + resolved issue multi-select → inserts draft into the new release form

### Smart Search Suggestions
- [x] On empty ⌘K query: `GET /api/search/suggestions` returns up to 5 suggestions ranked by `updated_at` from recent issue titles and document names
- [x] GlobalSearch: show suggestions list when query is empty instead of blank state

---

## Phase 24 — Git Integration (Local & GH) ✅ COMPLETE

### Server
- [x] Add `issue_commits` join table to `schema.sql`: `(issue_id UUID, sha TEXT, project_id UUID, linked_at TIMESTAMPTZ)`
- [x] Add `POST /api/git/:id/link` — link a sha to an issue (`{ sha, issueId }`)
- [x] Add `DELETE /api/git/:id/link/:sha` — unlink a commit from an issue
- [x] Support local git `log`, `show`, `branch` in `server/routes/git.ts`

### Client
- [x] Add **Git** tab to project detail panel (shows when project has `fs_path`)
- [x] `GitTab` component — commit history, link to issue dropdown
- [x] Issue detail: linked commits shown as sha chips
- [x] Add `GitCommit`, `GitBranch`, `IssueCommit` types and `gitApi.*` methods to `client/src/lib/api.ts`

---

## Phase 25 — External Issue Sync (GitHub / Linear / Jira) ✅ COMPLETE

### Infrastructure
- [x] `server/services/crypto.ts` — implement AES-256-GCM `encrypt(text)` / `decrypt(ciphertext)` using `JWT_SECRET`; used for all stored OAuth tokens
- [x] Add `integrations` table to `schema.sql`: `(id UUID, provider TEXT, project_id UUID, external_project_id TEXT, token_enc TEXT, last_synced_at TIMESTAMPTZ, config JSONB)`
- [x] `server/routes/integrations.ts` — implement sync handlers for GH, Linear, Jira

### Integrations
- [x] GitHub: Fetch issues via REST API; upsert with `source: 'github'`
- [x] Linear: Fetch via Linear GraphQL API; upsert with `source: 'linear'`
- [x] Jira: Basic auth + JQL search; upsert with `source: 'jira'`

### Client
- [x] Issue list: source badge chip (`github` / `linear` / `jira`) on imported issues
- [x] Issue detail: source badge + external ID display
- [x] Settings > Integrations: Manage project-specific integrations; "Sync Now" trigger

---

## Phase 26 — Multi-user & Org Sharing ✅ COMPLETE

> Expand from single-user to small team use. LDAP service already in `server/services/ldap.ts`. Biggest lift in the roadmap — only tackle once the app is stable and being shared with others.

### Users & Roles
- [x] Add `role TEXT` column (`'admin' | 'member' | 'viewer'`) to `users` table
- [x] Enforce role in `requireAuth` middleware: viewers — GET only; members — create/edit; admins — full access including user management
- [x] Settings: User Management section — list users with role badge; invite by email (one-time token); deactivate / reactivate; admin password reset

### LDAP Configuration
- [x] Settings: LDAP section — host, port, base DN, bind DN, bind password (stored encrypted); "Test connection" button
- [x] On login: if LDAP configured, try LDAP bind first; fall back to local bcrypt; auto-provision LDAP user on first successful bind

### Per-project Access Control
- [x] Add `project_members` table: `(project_id UUID, user_id UUID, role TEXT)`
- [x] `GET /api/projects`: admins see all; members see assigned projects only
- [x] Project settings panel: **Members** tab — add member by username, set role, remove member

### Audit Log UI
- [x] Settings: **Audit Log** page — paginated `audit_events` table (backend already writes these); filter by entity type; "Export CSV" button

---

## Phase 27 — Testing & Hardening (Missing Coverage) ✅ COMPLETE

> Fill the testing gaps for Phase 26 features to ensure enterprise reliability.

### Backend Unit Tests (Vitest)
- [x] **LDAP Service**: Mock `ldapjs` to verify bind and search logic; test error handling for connection timeouts
- [x] **Audit Service**: Verify entity-based filtering and CSV generation formatting in `audit.test.ts`
- [x] **Project Access**: Unit test membership-based visibility logic in `projects.test.ts`
- [x] **User Invitations**: Test token generation, hashing, and consumption during registration in `auth_tokens.test.ts`

### E2E Tests (Playwright)
- [x] **Audit UI**: Verify the filter dropdown correctly updates the event list
- [x] **Invitation Flow**: Full flow from generating an invite link to registering a new user via token
- [x] **Permissions**: Verify that a 'viewer' cannot see "Create Project" or "Delete" buttons
- [x] **Project Privacy**: Log in as two different users and verify User A cannot see User B's private project
- [x] **Account Status**: Verify that deactivating a user prevents login

---

# Phase 28 — Build Order & Priority

| Priority | Sub-phase | Why this order |
|---|---|---|
| 1 | **28.1** Notifications & Alerts | Creates the `notifications` table — required by 28.5; high daily value on its own |
| 2 | **28.5** Notification Hub (Apprise) | Depends on 28.1 schema; highest-value feature — Telegram + Claude Code session hooks |
| 3 | **28.2** Advanced Search & Filtering | Independent of others; search is a core daily workflow |
| 4 | **28.4** Bulk Operations & Triage | Builds on list UI refactoring introduced in 28.2; triage view uses stale logic from 28.1 |
| 5 | **28.3** Templates System | No dependencies; quality-of-life improvement, nothing else blocks on it |

---

## Phase 28.1 — Notifications & Alerts ✅ COMPLETE

> Surface stale issues, integration sync events, and AI task completions without the user having to check manually.
> Creates the shared `notifications` table — prerequisite for Phase 28.5.

### Schema
- [x] `notifications` table: `(id UUID, user_id UUID, type TEXT, title TEXT, body TEXT, entity_type TEXT, entity_id UUID, read BOOL, channel TEXT DEFAULT 'in_app', delivery_status TEXT DEFAULT 'delivered', created_at TIMESTAMPTZ)` — `channel` and `delivery_status` shared with Phase 28.5 external delivery
- [x] `notification_rules` stored in `app_settings`: stale threshold per project (days), sync alert toggle, AI task alert toggle

### Backend
- [x] `GET /api/notifications` — paginated list; include `unread_count` in response envelope
- [x] `PATCH /api/notifications/:id/read` — mark single notification read
- [x] `PATCH /api/notifications/read-all` — mark all read for current user
- [x] Background job (server interval): scan issues open > threshold with no note in that period → insert `stale_issue` notification (deduplicated — one per issue per day)
- [x] Hook into `integrations.ts` sync handlers → insert `sync_complete` notification with count of newly imported issues
- [x] Hook into `aitask.ts` completion → insert `ai_task_done` notification with task title

### Frontend
- [x] Bell icon in top bar with red unread count badge (hidden when zero)
- [x] Click bell → slide-in panel, notifications grouped by Today / Earlier
- [x] Each item: type icon + title + entity link + relative timestamp + mark-read dot; click navigates to entity
- [x] Settings: Notification Rules section — stale threshold slider (default 14 days), per-alert-type toggles (stale issues, sync events, AI tasks)
- [x] Browser `Notification` API opt-in prompt on first panel open; respect browser permission state

---

## Phase 28.5 — Notification Hub (External Delivery via Apprise) ✅ COMPLETE

> DevBrain becomes the central notification backbone for all personal projects.
> Uses Apprise (Python) as the delivery engine with Telegram as the primary channel.
> Extends the `notifications` table from Phase 28.1 — same rows, `channel='telegram'` instead of `'in_app'`.
> **Depends on Phase 28.1** (table must exist first).

### Schema (extends Phase 28.1)
- [x] Add `notification_channels` table: `(id UUID, user_id UUID, name TEXT, apprise_url TEXT ENCRYPTED, enabled BOOL, created_at TIMESTAMPTZ)` — stores any Apprise-compatible URL (Telegram, Slack, Discord, etc.)
- [x] Add `project_notification_prefs` table: `(project_id UUID, channel_id UUID, enabled BOOL)` — per-project opt-in/out per channel

### Python Apprise Client
- [x] `pip install apprise apscheduler` — add to `server/scripts/requirements.txt`
- [x] Create `server/scripts/apprise_client.py` — wrapper: accepts `{ title, body, level, apprise_urls[] }`, sends via Apprise, exits with JSON result `{ sent: bool, error?: string }`
- [x] `level` maps to Apprise notify type: `info → NotifyType.INFO`, `success → NotifyType.SUCCESS`, `warning → NotifyType.WARNING`, `error → NotifyType.FAILURE`
- [x] Load `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from `.env` as default Apprise URL if no channel configured in DB

### Backend — Delivery Service
- [x] `server/services/notifier.ts` — Node service that spawns `apprise_client.py` (same bridge pattern as `markitdown_bridge.py`); writes result back to `notifications` table (`delivery_status = 'sent' | 'failed'`, `channel = 'telegram'`)
- [x] `POST /api/notify` — public endpoint accepting `{ title, body, project, level }` — validates project short name, looks up enabled channels, calls `notifier.ts`; intended for external callers (Claude Code hooks, other projects)
- [x] `GET /api/notify/log` — paginated notification log; filterable by `project`, `level`, `channel`, `status`, `dateFrom`, `dateTo`
- [x] `POST /api/notify/test` — sends a test notification through all enabled channels for the current user; used by Settings page

### Scheduled Digests
- [x] `server/scripts/digest_scheduler.py` using APScheduler — daily job at configured time (default 09:00 local)
- [x] Digest query: open issue count per project, last session date per project, projects with no activity in > 7 days (stale flag)
- [x] Format as clean Telegram message: project color emoji indicator, counts, stale callout
- [x] Digest schedule (time + enabled toggle) stored in `app_settings`; scheduler reads on startup and after settings save

### Claude Code Hook Integration
- [x] Update `integrations/claude-code/session-end.ps1` — POST to `http://localhost:3001/api/notify` on session complete; payload: `{ project, title: "Session complete — <project>", body: "Duration: Xm, Files changed: N", level: "info" }`
- [x] Update `integrations/claude-code/session-end.sh` — same for macOS/Linux/WSL
- [x] Hook call is fire-and-forget with 3s timeout — if DevBrain is not running, fail silently (no error thrown)

### Frontend — Notification Log Page
- [x] New page `client/src/pages/NotificationLog.tsx` — table of all sent notifications (title, project badge, level chip, channel, status dot, timestamp)
- [x] Filter bar: project multi-select, level chips, channel chips, status chips, date range
- [x] Row expand: shows full `body` text
- [x] Failed rows: "Retry" button → calls delivery service again

### Frontend — Settings: Notification Hub Section
- [x] **Channels** sub-section: list configured Apprise channels (name + masked URL + enabled toggle + delete); "Add channel" → name + Apprise URL field (with link to Apprise URL docs)
- [x] Telegram quick-add form: Bot Token + Chat ID fields → auto-constructs `tgram://` Apprise URL on save
- [x] **Per-project toggles**: table of projects × channels with checkbox grid
- [x] **Daily Digest**: enabled toggle + time picker (hour selector)
- [x] "Send Test Notification" button → calls `POST /api/notify/test` → shows inline success/fail result

---

## Phase 28.2 — Advanced Search & Filtering ✅ COMPLETE

> Make it fast to drill into exactly the issues, docs, and commands you need with composable filters and saved presets.
> Independent of other Phase 28 work — can be built in parallel with 28.5.

### Schema
- [x] `saved_filters` table: `(id UUID, user_id UUID, name TEXT, entity_type TEXT, filter_json JSONB, created_at TIMESTAMPTZ)`
- [x] `search_history` table: `(id UUID, user_id UUID, query TEXT, created_at TIMESTAMPTZ)` — keep last 50 per user (delete oldest on insert)

### Backend
- [x] Enhance `GET /api/issues` — accept query params: `tags[]`, `status[]`, `priority[]`, `dateFrom`, `dateTo`, `projectIds[]`, `q`
- [x] Enhance `GET /api/documents` — same pattern plus `fileType[]`
- [x] `GET /api/search/filters` — list saved filters for current user
- [x] `POST /api/search/filters` — create saved filter
- [x] `DELETE /api/search/filters/:id` — delete saved filter
- [x] `GET /api/search/history` — last 20 queries for current user
- [x] Write to `search_history` on every non-empty ⌘K search submission

### Frontend
- [x] Issues page: collapsible filter bar — status chips, priority chips, tag multi-select, date range picker, project multi-select
- [x] Documents page: same filter bar pattern + file type chips
- [x] Active filters rendered as dismissable chips above the list; "Clear all" link when any filter is active
- [x] "Save filter" button → name modal → saved preset appears as a chip above the filter bar
- [x] ⌘K GlobalSearch: show search history entries below smart suggestions when query is empty

---

## Phase 28.4 — Bulk Operations & Triage ✅ COMPLETE

> Select multiple items at once and act on them together; a dedicated triage view for working through open issues.
> Build after 28.2 — the list UI refactoring in 28.2 makes checkbox integration cleaner.
> Triage stale logic reuses the threshold set in 28.1.

### Backend
- [x] `PATCH /api/issues/bulk` — body `{ ids: string[], action: 'tag'|'status'|'delete', value?: string }`
- [x] `PATCH /api/documents/bulk` — body `{ ids: string[], action: 're-embed'|'tag'|'delete' }`
- [x] `PATCH /api/commands/bulk` — body `{ ids: string[], action: 'tag'|'favorite'|'delete' }`
- [x] `GET /api/issues/triage` — open issues sorted by (priority desc, last_activity asc); include `is_stale` boolean flag

### Frontend
- [x] Issues, Documents, Commands lists: checkbox column (visible on row hover or once first item checked)
- [x] "Select all" checkbox in column header; indeterminate state when partially selected
- [x] When ≥1 item selected: floating action bar appears at bottom of list — context-aware buttons (Tag / Change Status / Re-embed / Favorite / Delete) + "X selected" count + Deselect all
- [x] Issues page: **Triage** tab alongside All / Open / Resolved — shows stale + high-priority open issues sorted by urgency; bulk action bar always visible in this view

---

## Phase 28.3 — Templates System ✅ COMPLETE

> Reduce repetition when creating issues and runbooks with built-in and custom templates.
> Independent — no dependencies on other Phase 28 sub-phases. Build last.

### Schema
- [x] `templates` table: `(id UUID, project_id UUID NULLABLE, type TEXT — 'issue'|'runbook'|'document', name TEXT, description TEXT, body JSONB, is_builtin BOOL, created_at TIMESTAMPTZ)`

### Backend
- [x] `GET /api/templates?type=&projectId=` — return built-ins + project-scoped templates
- [x] `POST /api/templates` — create custom template
- [x] `PUT /api/templates/:id` — update (built-ins return 403)
- [x] `DELETE /api/templates/:id` — delete (built-ins return 403)
- [x] Seed built-in templates on first run: **Bug Report** (issue), **Investigation** (issue), **Deployment Runbook** (runbook), **Incident Postmortem** (runbook)

### Frontend
- [x] Issue create modal: "Use template ▾" dropdown → selecting a template pre-fills title, description, tags, and investigation steps
- [x] Runbook create modal: same pattern → pre-fills steps list
- [x] Settings > Templates page: list all templates with type badge and project scope; create / edit / delete custom templates; built-ins are read-only but show a "Duplicate" action
- [x] Template editor: name, type selector, project scope dropdown, body — step-builder UI for runbooks, freeform markdown textarea for issues/docs

---

## Phase 29 — Antigravity / Gemini CLI Integration ✅ COMPLETE

> Mirrors the Claude Code integration pattern for the Gemini CLI / Antigravity AI assistant.
> Same TASKS.md + SESSION.md session-tracking model, with one addition: automatic archival of stale completed tasks.

### Hooks (`integrations/antigravity/`)
- [x] `src/hooks/session-start.ps1` — Windows native PowerShell hook: scaffold `TASKS.md`, archive `[x]` tasks stamped `<!-- done: YYYY-MM-DD -->` older than 7 days into `TASKS_ARCHIVE.md`, create timestamped session folder + `SESSION.md`, print per-phase task progress + last session summary to stdout for model context injection
- [x] `src/hooks/session-start.sh` — macOS/Linux/WSL bash equivalent
- [x] `src/hooks/session-end.ps1` — write completion timestamp, append row to `sessions/index.md`
- [x] `src/hooks/session-end.sh` — bash equivalent
- [x] `src/skills/devbrain/SKILL.md` — `/devbrain` slash command: triggers mid-session task update + session summary
- [x] `src/templates/TASKS.md` + `src/templates/SESSION.md` — scaffold templates with YAML frontmatter
- [x] `src/config/hooks.reference.json` — reference hooks.json block for manual installation
- [x] `install.ps1` — Windows installer: copies hooks to `~\.gemini\config\scripts\`, registers in `~\.gemini\config\hooks.json`, copies skill
- [x] `install.sh` — macOS/Linux/WSL installer: copies hooks, makes executable, merges into `~/.gemini/config/hooks.json`, backs up existing config; `--uninstall` flag for clean removal

### Server-side (`server/`)
- [x] `server/services/antigravity-discovery.ts` — walks a configured `scan_root`, detects Antigravity-tracked projects by `TASKS.md` presence, parses frontmatter + per-phase task progress + session history
- [x] `server/routes/antigravity-projects.ts` — REST + SSE endpoints: `POST /scan`, `GET /:id/tasks`, `GET /:id/sessions`, `GET /:id/sessions/:sid`, `GET /:id/tasks/watch` (SSE live updates)
- [x] `server/routes/settings.ts` — `GET/PUT /api/settings/antigravity` — stores `antigravity_scan_root` in `app_settings`
- [x] `server/index.ts` — register `antigravityProjectsRouter` at `/api/antigravity-projects`
- [x] `server/db/schema.sql` — seed `antigravity_scan_root` default row into `app_settings`

### Client-side (`client/`)
- [x] `client/src/lib/api.ts` — add `antigravityProjectsApi` (scan, getTasks, getSessions, getSession, watchTasks SSE) + `settingsApi.getAntigravitySettings` / `saveAntigravitySettings`
- [x] `client/src/pages/Settings.tsx` — add `AntigravityIntegrationSection`: scan root config, scan trigger, candidate list with link actions
- [x] `client/src/pages/Projects.tsx` — rename project badge from "CLAUDE" → "AI SYNC"; update link modal to accept `ANTIGRAVITY.md` alongside `TASKS.md` / `CLAUDE.md` as marker file; update tooltip copy to be integration-agnostic

### Documentation
- [x] `integrations/antigravity/README.md` — full install guide (Windows / macOS / Linux / WSL / Git Bash options), file format specs, DevBrain viewer setup, how hooks work
- [x] `CLAUDE.md` — updated project structure tree + Antigravity Integration section
- [x] `GEMINI.md` — added Antigravity Integration section with session-end responsibilities
- [x] `README.md` — expanded "Claude Code Integration" into "AI Assistant Integrations" section; added Antigravity subsection; added Documentation section linking Feature Guide, Changelog, Startup Guide, Contributing
- [x] `CHANGELOG.md` — added `[Unreleased]` section documenting all Antigravity changes
- [x] `docs/FEATURE_GUIDE.md` — new 747-line feature guide covering all 22 feature areas with step-by-step test instructions for new users

---

## Phase 30 — Gemini API Integration ✅ COMPLETE

> Add Google Gemini as a third AI provider option alongside Ollama (default) and Claude API.
> Free tier (`gemini-2.0-flash`) gives 1500 RPD / 1M TPM at zero cost — useful when Ollama is unavailable or GPU is busy.

### Core
- [x] Replace binary `USE_CLAUDE` toggle with `AI_PROVIDER` enum (`'ollama' | 'claude' | 'gemini'`, default `'ollama'`) in `server/lib/env.ts`
- [x] Add `GEMINI_API_KEY` and `GEMINI_CHAT_MODEL` (default `gemini-2.0-flash`) to env schema with Zod validation
- [x] Add `toGeminiContents()` helper in `server/services/ai.ts` — maps internal `Message[]` to Gemini's format (role `'assistant'` → `'model'`, system message → `system_instruction` field)
- [x] Add Gemini branch to `aiChat` — `POST /v1beta/models/{model}:generateContent?key=...`
- [x] Add Gemini branch to `aiChatStream` — `POST /v1beta/models/{model}:streamGenerateContent?key=...&alt=sse` with SSE chunk parsing
- [x] Embeddings (`aiEmbed`) remain on local Ollama — Gemini embedding API is not on the free tier

### Config & Infrastructure
- [x] `server/.env` — replace `USE_CLAUDE=false` with `AI_PROVIDER=ollama`, add `GEMINI_API_KEY=` and `GEMINI_CHAT_MODEL=gemini-2.0-flash`
- [x] `server/index.ts` — health endpoint `config.ai_backend` and `config.chat_model` updated to reflect `AI_PROVIDER`
- [x] `server/routes/settings.ts` — `GET /api/settings` AI section reflects active provider and model
- [x] `docker-compose.yml` + `docker-compose.prod.yml` — pass `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_CHAT_MODEL` env vars

### Tests
- [x] `server/vitest.config.ts` — replace `USE_CLAUDE: 'false'` with `AI_PROVIDER: 'ollama'`
- [x] `server/tests/services/ai.test.ts` — update env mock: `AI_PROVIDER: 'ollama'`, add `GEMINI_API_KEY` and `GEMINI_CHAT_MODEL` fields
- [x] `server/tests/services/embedder.test.ts` — same mock update

### Script Utilities
- [x] `devbrain.ps1` + `devbrain.sh` — added `restart` and `stop` commands; `status` command shows live health of Ollama, Postgres, server, and Vite client

---

## Phase 31 — Settings UX Improvements ✅ COMPLETE

### Settings Page Reorganization
> Replace the flat single-column scroll of 16 stacked sections with a sidebar-nav two-column layout.

- [x] Add `const [tab, setTab] = useState('general')` to `SettingsPage` state
- [x] Define `NAV` array of 8 tab groups with `adminOnly` flag; filter non-admin tabs from the sidebar
- [x] Render 168px left sidebar with nav buttons; active tab highlighted in indigo; admin-only tabs hidden from non-admins
- [x] Replace flat content pane with conditional rendering per tab:
  - **General** — AI Backend (provider, models, Ollama URL) + About (version, stack)
  - **Account** — Auth mode, change-password form, sign-out button
  - **Users & Auth** *(admin)* — User Management + LDAP Configuration
  - **Data** — Export JSON, Import JSON (dry run + live), Scheduled Backup, Export by Project (zip), Import from Zip, Danger Zone (reset seed, admin only)
  - **Notifications** — Notification Rules + Notification Hub
  - **Integrations** — External Issue Sync *(admin)* + Claude Code + Antigravity/Gemini CLI
  - **Templates** — Templates manager
  - **Audit Log** *(admin)* — Audit Log paginated view + CSV export
- [x] Fix E2E tests in `sharing.spec.ts` — three tests broke because they expected Settings content without tab navigation; added tab-click steps before assertions

### Font Size / UI Scale
> Let the user scale the entire interface to one of four sizes; persisted to localStorage.

- [x] Add `[data-density="xl"]` variant to `tokens.css` — `--fs: 16px`, `--row-h: 42px`, proportional spacing
- [x] Add `DENSITY_LS_KEY = 'devbrain_density'` constant; initialise `density` state from localStorage (was hardcoded `'normal'`, reset on every refresh)
- [x] Persist density to localStorage via `useEffect` on density change
- [x] Add `DENSITY_ZOOM` map (`compact: 0.92`, `normal: 1`, `comfy: 1.15`, `xl: 1.23`) in `App.tsx`
- [x] Apply `zoom: DENSITY_ZOOM[density]` + `height: 100vh/zoom` on `.app` so the entire UI (top bar, sidebar, content) scales uniformly without clipping
- [x] Fix sidebar resize handler — divide drag delta by zoom factor so the handle tracks the cursor correctly at any scale
- [x] Pass `density` + `setDensity` as props to `SettingsPage`
- [x] Add **Font Size** section to Settings → General tab — four buttons (Small / Medium / Large / XL) with live "A" preview at each size; active option highlighted in accent colour
- [x] Update sidebar footer quick-toggle to include `xl` option
- [x] Add section 23 (Font Size & UI Scale) to `docs/FEATURE_GUIDE.md`

---

## Phase 32 — DocChat RAG Quality Improvements ✅ COMPLETE

> Ask AI / DocChat currently sends each question to the LLM in isolation (no chat history), retrieves via pure pgvector cosine similarity only (the `tsv` full-text index on `documents` is unused in chat), chunks documents with a naive fixed 1800-char/230-overlap window, and has no reranking step. Techniques researched across AnythingLLM, Open WebUI, SurfSense, and open-notebook converged strongly on the same fixes. Ordered by impact/effort; zero-GPU-VRAM items first given the single 6GB RTX 2060 budget.

### Build Order & Priority
| Priority | Sub-phase | Why this order |
|---|---|---|
| 1 | **32.1** Chat Memory & Persistence | Biggest UX gap, smallest lift, zero VRAM cost, unblocks 32.4 |
| 2 | **32.2** Hybrid Search (RRF) | Independent; reuses the full-text infrastructure already half-built |
| 3 | **32.3** Reranking & Better Chunking | Widens/reorders results from 32.2 before generation |
| 4 | **32.4** Conversation-Aware Retrieval | Depends on 32.1 — needs persisted history to backfill/rewrite from |
| 5 | **32.5** Citation UX & Prompt Hardening | Independent; mostly frontend, pairs with the threshold work from 32.2 |
| 6 | **32.6** Stretch / Optional | Evaluate only after 32.1–32.5 ship |

### Phase 32.1 — Chat Memory & Persistence ✅ COMPLETE
> Fixes: no multi-turn follow-ups (each question sent to the LLM alone); chat history lost on page refresh (client-state only, no DB table). Every researched tool persists history and sends it back to the model each turn.

#### Schema
- [x] `chat_sessions` table: `(id TEXT, user_id TEXT, project_id TEXT NULLABLE, component TEXT NULLABLE, title TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)`
- [x] `chat_messages` table: `(id TEXT, session_id TEXT, role TEXT — 'user'|'assistant', content TEXT, citations JSONB, created_at TIMESTAMPTZ)`

#### Backend (`server/routes/chat.ts`)
- [x] `POST /api/chat` — accept optional `sessionId`; create a session on the first message of a new conversation (title = truncated question)
- [x] Before retrieval: load the last 10 messages for `sessionId` from `chat_messages`
- [x] Include loaded history in the `aiChatStream` messages array alongside the system prompt + RAG excerpts
- [x] After each turn: persist both the user question and the assistant answer (+ citations) to `chat_messages`
- [x] `GET /api/chat/sessions` — list sessions for the current user, optionally scoped by project
- [x] `GET /api/chat/sessions/:id/messages` — full message history for a session
- [x] `DELETE /api/chat/sessions/:id` — delete a session and its messages (cascades to chat_messages)

#### Frontend (`client/src/pages/DocChat.tsx`)
- [x] Load/resume a session on mount instead of purely local `messages` state
- [x] Add a session picker ("💬 Chats" dropdown) / "New chat" action to start fresh vs. continue
- [x] Persist `sessionId` in `localStorage` so history survives a page refresh

### Phase 32.2 — Hybrid Search (RRF) ✅ COMPLETE
> Fixes: retrieval is pure vector search; the `tsv` full-text index pattern already used on `documents` isn't applied to chunk retrieval in chat.

#### Schema
- [x] Add a generated `tsv TSVECTOR` column + GIN index on `document_chunks.content` (mirrors the existing `documents.tsv` pattern in `schema.sql`) — needed because full-text ranking must happen at chunk granularity, not whole-document

#### Backend (`server/services/embedder.ts` — `searchChunks()`)
- [x] Run a second query using `ts_rank_cd` against the new `document_chunks.tsv` index, same scoping (`documentId` / `projectId` / `component`) as the existing vector query
- [x] Fuse vector-search ranks and full-text ranks via Reciprocal Rank Fusion (`1/(k + rank)`, k=60), merged in SQL via a `UNION ALL` + `GROUP BY` over two independently-limited, index-friendly CTEs
- [x] Add a minimum similarity/rank threshold (cosine 0.3) to drop low-relevance chunks before generation (cheap reranking substitute — bundled with this work)

### Phase 32.3 — Reranking & Better Chunking ✅ COMPLETE
> Fixes: no reranking step after retrieval; naive fixed-size chunking with no structure awareness, hurting both recall and citation precision.

#### Chunking (`server/services/embedder.ts` — `chunkText()`)
- [x] Replace char-count chunking with token-counted chunking (`js-tiktoken`, `cl100k_base`), 512 target tokens / 80 overlap (~15%)
- [x] Add Markdown-header-aware pre-split (split on `#`/`##`/`###` before packing into token windows), falling back to recursive token-window splitting for plain text/other formats or oversized sections
- [x] Prepend a small metadata header (document title, `[Title]\n\n...`) to each chunk before embedding — improves citation accuracy and lets full-text search match on title terms too
- [x] One-time re-embed migration script (`server/db/migrations/rechunk_all_documents.ts`) — run against the live DB, re-chunked all existing documents

#### Reranking
- [x] Add a CPU-only cross-encoder reranker (`Xenova/ms-marco-MiniLM-L-6-v2`, ONNX via `@huggingface/transformers`, 87MB fp32, cached to `server/.cache/transformers` outside node_modules) — new `server/services/reranker.ts`, falls back to pre-rerank order if the model fails to load/run
- [x] `searchChunks()`: widen initial retrieval to top-20 post-hybrid-fusion, rerank via the cross-encoder, return the caller's requested `limit` (default 5)
- [x] Verified in practice the reranker never claims GPU/CUDA — confirmed empirically (`model.device` reports `'cpu'`) both in isolation and via live chat requests against the running app

### Phase 32.4 — Conversation-Aware Retrieval ✅ COMPLETE
> Fixes: follow-up questions ("what about the second one?") retrieve nothing relevant, since only the raw new message gets embedded with no awareness of prior turns. Depends on **32.1** (needs persisted history to draw from).

- [x] Backfill: when fused retrieval for a turn comes back thin (< 3 candidates), pull in chunks cited in the last 2 assistant turns of the session as extra candidates before reranking (`searchChunks(..., { backfillChunkIds })`, `server/services/embedder.ts`) — scoped identically to the main search (document/project/component), with a real cosine score recomputed against the current question rather than a stale one
- [x] If still empty after backfill: rewrite the question into a standalone search query using recent history, then retry retrieval once (`rewriteQuery()`, `server/routes/chat.ts`)
  - Correction from the original plan: there's no `gemma3:4b`-specific wiring anywhere in this codebase (confirmed — even the existing "gemma3:4b" auto-tag route just calls the generic `aiChat()`, which uses whatever `OLLAMA_CHAT_MODEL`/`AI_PROVIDER` is configured). Rewriting uses the same `aiChat()` as everywhere else rather than inventing a new hardcoded-model dependency that might not even be pulled (CLAUDE.md lists gemma3:4b as "optional").
- [x] Explicitly out of scope: open-notebook's scatter-gather multi-query decomposition (up to 5 sub-queries per question) — too slow for sequential `mistral:7b` calls on a single 6GB GPU

### Phase 32.5 — Citation UX & Prompt Hardening ✅ COMPLETE
> Fixes: citations are a flat 300-char excerpt with no click-to-view-in-context; the RAG prompt doesn't explicitly whitelist citable chunk IDs, risking hallucinated citations.

#### Backend (`server/routes/chat.ts`)
- [x] RAG system prompt: explicit "CITATION RULES" block listing exactly which excerpt numbers may be cited (`[1], [2], ...`), a worked example, and an instruction to never invent a number or cite an unsupported fact — open-notebook's anti-hallucination pattern
- [x] Zero-results short-circuit: if nothing clears the relevance threshold (from 32.2) even after backfill/rewrite (32.4), skip the LLM call entirely and send a canned response — saves a ~3–5s `mistral:7b` round trip and guarantees no fabricated citations on empty retrieval
- [x] `GET /api/documents/:id/chunks/:chunkIndex` — returns the cited chunk plus its immediate neighbors (bounds-clamped at 0), for citation click-through

#### Frontend
- [x] Citation chips in `DocChatPage`: a "⤢ view in context" button opens `ChunkContextModal`, which fetches the new endpoint and shows the cited chunk highlighted alongside its neighbors (reusing the existing `PreviewPanel` wasn't viable — it's whole-document content, not chunk-addressable — so this is a dedicated chunk-context modal instead)
- [x] "referenced N×" badge shown on a citation card when multiple cited chunks in the same answer come from the same document

### Phase 32.6 — Stretch / Optional ✅ COMPLETE
> Evaluate only after 32.1–32.5 ship and prove out.

- [x] "Full Context Mode" — when chat `scope === 'document'` and the doc is short enough (≤1200 tokens — conservative given no `num_ctx` is configured anywhere in this codebase, so Ollama falls back to its likely-2048-token default), skip chunk retrieval entirely and pass the whole document instead (`tryFullContextMode()`, `server/routes/chat.ts`). Citations use a `chunkIndex: -2` sentinel; client shows "📄 full document" instead of a chunk badge.
- [x] Summary-first hierarchical retrieval — at ingest time (`embedDocument()`, `server/services/embedder.ts`), generate a 1-paragraph summary via `aiChat()` (correction from the plan's `gemma3:4b` wording — see the same note under 32.4), embed it, and store it in `document_chunks` with `chunk_index = -1` so it rides the existing hybrid-search/rerank pipeline for free instead of needing a separate query path. Excluded from the `chunk_count` shown in the UI. Client shows "📝 summary" instead of a chunk badge.

### Explicitly not planned
- Adopting AnythingLLM / Open WebUI / SurfSense / open-notebook wholesale — all are separate full applications (own DB, own auth, own UI), not libraries; would fragment DevBrain's unified project/issue/document model
- Claim-level grounding verification (checking LLM-generated claims against source text before returning an answer) — confirmed absent in all 4 tools researched; would be original R&D, not a port

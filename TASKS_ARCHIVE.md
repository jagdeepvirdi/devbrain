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

---

## Phase 32.6 — Known Issues (Resolved)

### Ollama GPU thrashing during Phase 32.6 rechunk migration (2026-07-15)

**Root cause**: `embedDocument()` (`server/services/embedder.ts`) now calls `aiChat()` (mistral, for the document summary) and `aiEmbed()` (nomic-embed-text, for chunk embeddings) interleaved within the same per-document loop. Under the pre-existing documented VRAM risk (mistral:7b + nomic-embed-text together exceed the RTX 2060's 6GB), this forces Ollama to swap models repeatedly per document instead of once. Running `rechunk_all_documents.ts` back-to-back across 11 documents pushed Ollama into a degraded state — confirmed via isolated testing: a *trivial* prompt ("say hello in one word") with **zero** concurrent load hung 90+ seconds, and `nvidia-smi` showed the GPU pinned at 100% utilization / ~86% VRAM used. Not caused by document size or prompt length — the trivial-prompt test ruled that out.

**Status (2026-07-16): Ollama confirmed healthy, all 3 documents re-embedded successfully.**
- [x] Ollama health confirmed — GPU idle (0% util, 24 MiB/6144 MiB VRAM) before test; trivial-prompt test completed with normal cold-load behavior (no 90+s hang); `/api/ps` showed a single clean model load, no thrashing
- [x] 3 documents re-embedded one at a time — all now `embedding_status: 'done'` with real chunk counts:
  - `TOT_DLD_SAP_Interface_Accrual_v1.0_20150713` (`c0ad5c6b-e515-4e1f-adde-449f526cc786`) — 50 chunks
  - `TOT_DLD_SAP_Interface_EstimateWriteoff_v0.1` (`23313623-82c5-49bd-b076-0c7564fb980d`) — 29 chunks
  - `TOT_DLD_SAP_Interface_v1.0 JS` (`813b44ac-5351-4d8c-8e3a-5e93283afadd`) — 56 chunks
- [x] **Design question resolved + shipped (2026-07-17)**: added `embedDocumentsBatch()` to
      `server/services/embedder.ts` — phase-separated across a whole batch (every document's summary
      generated via `aiChat`/mistral first, *then* every document's chunks embedded via `aiEmbed`/
      nomic-embed-text), instead of alternating chat→embed once per document. Cuts total model swaps
      from ~2×N to 2 regardless of batch size — directly targets the 2026-07-15 incident, where even a
      *sequential* one-doc-at-a-time loop (`rechunk_all_documents.ts`) thrashed Ollama because each
      document forced its own swap pair. One document's failure is captured per-item in the returned
      `BatchResult[]`, never aborts the rest of the batch.
      Rewired all three call sites that previously fired `embedDocument()` per document: the
      `PATCH /api/documents/bulk` `re-embed` action (was an unawaited concurrent loop — the exact
      thrashing pattern flagged below), `rechunk_all_documents.ts` (was sequential-but-interleaved), and
      the Dashboard "Retry all failed" button (was `Promise.allSettled` over N individual `/reembed`
      HTTP calls — switched to one `documentsApi.bulk(failedIds, 're-embed')` call so the phase
      separation happens server-side). Single-document call sites (upload, explain, save-as-document,
      component-overview, single re-embed) keep using `embedDocument()` unchanged — one document is only
      2 swaps either way, not the failure mode. 8 new tests for `embedDocumentsBatch` (ordering, chunk
      counts, per-doc failure isolation, progress callback) + 3 new tests for the rewired bulk route;
      full suite 229/229, server + client typecheck clean.

---

### CI E2E failure: document upload destroyed the document on embed failure (fixed 2026-07-17)

**Root cause**: CI's `e2e` job (`.github/workflows/ci.yml`) has no Ollama service — `OLLAMA_URL` points
at `localhost:11434`, nothing listens there. `POST /api/documents` and `POST /api/documents/url`
(`server/routes/documents.ts`) awaited `embedDocument()` synchronously and, on any failure, **deleted
the just-inserted document row** and returned a 500 — unlike every other embed-triggering route in the
same file (bulk re-embed, `update-content`, single re-embed), which mark `embedding_status = 'failed'`
and keep the document, matching the UI's existing "failed — click to retry" badge
(`EMBED_DOT.failed` in `client/src/pages/Documents.tsx`). So in CI, uploading a document during
`e2e/documents.spec.ts` always failed outright, which the test surfaced as a Playwright strict-mode
violation (`getByText('E2E Test Document')` resolved to 2 elements) rather than an obvious "upload
failed" — the drop-zone's staged-file banner never clears on failure, so its filename text and the
reverted "Ready to upload…" status text both matched the assertion.

- [x] `routes/documents.ts` — both routes now catch embed failures locally, log via `console.error`,
      mark `embedding_status = 'failed'`, and still return 201 with the document (matching the
      already-established graceful pattern elsewhere in this file). The outer catch (which still
      deletes + 500s) now only fires for genuine parse/insert failures, not embed failures.
      `tests/routes/documents_embedding_status.test.ts` had a test asserting the *old* rollback
      behavior — rewritten to assert the document survives + gets marked `failed`, plus a new
      equivalent test added for the URL-import route's failure path (previously uncovered).
- [x] `e2e/documents.spec.ts` — a single selected file is staged (not uploaded) so Auto-tag can inspect
      its real content first (existing, unrelated behavior) — the test now explicitly clicks "Upload"
      and waits for the real `POST /api/documents` response before asserting the list, instead of
      asserting right after `setInputFiles()`.
      Verified locally end-to-end (Ollama *is* actually running natively on this machine, not
      containerized — `docker ps` just doesn't show it): all 3 tests in the file pass; confirmed via
      direct DB query that the uploaded documents reached `embedding_status: 'done'`. Server suite
      248/248 (247 + 1 new test), both `tsc --noEmit` clean.
      **Not done**: `routes/documents.ts`'s `save-explanation` and `component-overview` routes don't
      delete on embed failure either, but they also don't mark `embedding_status = 'failed'` — a row
      stays silently `pending` forever with no retry affordance. Lower severity (not what broke CI,
      no test currently depends on it) — left as a follow-up rather than expanding this fix's scope.

---

## Phase 33 — Architect & VC Review: Critical & High Priority (Resolved 2026-07-24)

> External brutal-honesty review requested by the user (architect + VC lens), findings cited against the
> actual codebase as of commit 51b4b15. Full verdict/scores table and remaining open items (God-file
> splits, Nice-to-Have polish) stay in TASKS.md. This section archives the resolved action items.

### Critical (fix immediately — showstoppers)

- [x] **Stored XSS via unescaped markdown rendering** (resolved 2026-07-24) — `client/src/pages/DocChat.tsx`'s `inlineMd()` regex-transformed text straight into `dangerouslySetInnerHTML` with zero HTML-escaping; the text is the AI's RAG answer, grounded in uploaded/URL-imported document content. Fixed by adding `escapeHtml()` (escapes `&`/`<`/`>`/`"`/`'`) and running it first, before any of the markdown regexes build their own literal HTML tags. Covers all four `dangerouslySetInnerHTML` call sites in the file (they all route through `inlineMd`); the code-block path was already safe (renders `{code}` as a React child, not raw HTML). Verified no other component in `client/src` reuses this pattern — the other two `dangerouslySetInnerHTML` uses in the codebase (`NotificationsPanel.tsx`'s hardcoded `<style>` string, `Commands.tsx`'s Shiki output) don't touch user/AI-controlled text unescaped.
- [x] **Crypto key reuse** (resolved 2026-07-24) — `server/services/crypto.ts` derived the AES-256-GCM key from `JWT_SECRET`. Added a dedicated `ENCRYPTION_KEY` env var (own Zod validation in `lib/env.ts`, required unconditionally like `JWT_SECRET`) and switched `crypto.ts`'s `key()` to derive from it instead. Threaded through everywhere `JWT_SECRET` was: `vitest.config.ts`'s test env, `crypto.test.ts`'s mock, `.env.example`, both real local `.env`/`server/.env` files, `docker-compose.yml`, `docker-compose.prod.yml` (also replaced a dead, never-wired-up `ENCRYPT_KEY` var that was silently doing nothing), the CI e2e job's env block, `devbrain.sh`/`devbrain.ps1`'s startup env checks (placeholder-value warning + hard fail if unset, mirroring the existing `JWT_SECRET`/`AUTH_PASSWORD` checks), and README/CONTRIBUTING/STARTUP_GUIDE's env var docs. **Note**: rotating this key going forward will make previously-encrypted secrets (LDAP bind password, S3/SFTP credentials, integration tokens) undecryptable — they'll need re-entering in Settings after a rotation, same as if `JWT_SECRET` changed before this fix. Full server suite still 1180/1180, both `tsc --noEmit` clean.
- [x] **Rate limiting covers ~9 of ~40 mutating routes** (resolved 2026-07-24) — added a baseline `apiLimiter` (300 req/min per client) applied to all of `/api` right after `requireAuth` in `server/index.ts`, so every authenticated route has *some* ceiling now, not just the hand-picked AI endpoints. The existing tighter `mutationLimiter` (60/min) still layers on top for the AI/mutation-heavy routes unchanged.
- [x] **No `helmet` security headers** (resolved 2026-07-24) — added `helmet` (`server/package.json`) with a CSP tuned to what the app actually needs: `style-src`/`font-src` allow Google Fonts (used in `client/index.html`) plus `'unsafe-inline'` for styles (the client uses inline `style={{}}` throughout — not a quick refactor, and `style-src`'s `unsafe-inline` is a far smaller risk than `script-src`'s), `script-src`/`object-src`/`frame-ancestors` locked down to `'self'`/`'none'`/`'none'`. Deliberately exempts `/api/docs` — swagger-ui-express's bundled UI needs a looser policy and isn't worth carving out directives for on a page with no user data. Verified server boots past env validation with the new middleware wired in (DB not running locally at test time, but `lib/env.js` didn't reject startup, confirming the CSP/limiter wiring itself is sound); full server suite 1180/1180, client 3/3, both `tsc --noEmit` clean.

### High Priority (refactoring & scalability)

> Resolved 2026-07-24 except god-files (explicitly deferred — see below). User made two
> scope calls before this batch: (1) single-GPU bottleneck — mitigate with a concurrency
> queue + document the single-tenant scope, rather than chase real multi-GPU infra; (2)
> god-file splits — defer until client test coverage exists, since refactoring a
> 3,000-line component with no regression tests backing it is a real risk, not a free
> action. Server suite 1196/1196 (was 1180), client suite 19/19 (was 3), both `tsc
> --noEmit` clean, both `npm run lint` clean (0 errors), client production build
> verified, and the server was smoke-tested live against a real Postgres + Ollama
> (health check 200, CSP headers present and correctly scoped, tasks-watcher/listener
> initialized, digest-scheduler lock acquired and spawned).

- [x] **Single-GPU AI bottleneck is the real scaling ceiling** — added `withOllamaQueue()` to `server/services/ai.ts`: every Ollama call (`aiChat`, `aiEmbed`, `aiChatStream`) now runs through a single promise-chain queue instead of firing concurrently, so simultaneous requests degrade to slower-but-correct instead of thrashing the GPU into the hung state documented in Known Issues (2026-07-15). A failed queued call doesn't wedge the queue for the next one (verified by a dedicated test). This is a stability mitigation, not a scaling story — `CLAUDE.md`'s Non-Goals and README's intro now explicitly frame the project as self-hosted/single-tenant software, not multi-tenant SaaS, and point at real infra (vLLM/TGI, or a paid `AI_PROVIDER`) as the actual answer if that ever changes. 2 new tests in `tests/services/ai.test.ts` (serializes a concurrent chat+embed call; queue survives a thrown error).
- [x] **In-process schedulers can't run on more than one instance** — new `server/lib/advisoryLock.ts`: `withAdvisoryLock()` wraps a one-shot job (backup, stale-issue scan, embedding-health snapshot) in a Postgres transaction-scoped advisory lock (`pg_try_advisory_xact_lock`) that auto-releases on COMMIT/ROLLBACK; `tryAcquireLongLivedLock()` covers the digest scheduler's long-running spawned Python process via a session-level lock held for the process's whole lifetime, released when it exits. All four schedulers in `server/index.ts` now go through one of these — a second instance sharing the same DB skips the job silently instead of duplicating it. 6 new tests (`tests/lib/advisoryLock.test.ts`) plus updated mocks in `backup.test.ts`/`notifications.test.ts`/`embeddingHealthSnapshot.test.ts` (a fake `pool.connect()` client) and a new digest-scheduler test for the lock-contention skip path.
- [x] **SSE state is per-process, not shareable** — used Postgres LISTEN/NOTIFY (no new infra) rather than Redis: `services/tasks-watcher.ts`'s debounced file-change handler now calls `publishTaskUpdate()`, which UPSERTs the freshly-parsed tree into a new `task_tree_cache` table (migration `add_task_tree_cache.ts` + `schema.sql`) and `pg_notify`'s a channel with just the project id (NOTIFY payloads cap at 8000 bytes — too small for an arbitrary tree, hence the cache table). Every server instance keeps one dedicated `LISTEN`ing connection open (`startListening()`) and re-reads the cached row on notification, broadcasting to its own local SSE subscribers — so whichever instance actually holds a given client's connection delivers the update, regardless of which instance's chokidar watcher detected the file change (only one instance can have a project's `fs_path` mounted in the first place). Handles reconnect-with-backoff if the listen connection drops, and `stopListening()` (wired into `index.ts`'s `SIGTERM` handler) destroys the permanently-checked-out client so `pool.end()` doesn't hang waiting for it. 8 new/rewritten tests. **Only `tasks-watcher.ts` needed this** — the `claude-projects.ts`/`antigravity-projects.ts` `/tasks/watch` SSE endpoints poll-and-diff on their own timer rather than relying on a push from a watcher, so they don't share this gap.
- [x] **Client-side test coverage is a blind spot** — added `client/src/components/FilterBar.test.tsx` (5 tests: toggling a status chip, de-duplicating an already-active toggle, independent status/priority toggles, "Clear all" resetting every field not just the visible ones, documents-vs-issues section visibility) and expanded `client/src/lib/api.test.ts` from 3 to 14 tests covering the shared `request()`/`_fetch()` error handling (401 → dispatches `devbrain:unauthorized` + throws, server error message passthrough, generic-message fallback, non-JSON body, GET deduplication, non-GET never deduplicated) and `documentsApi.upload()` (form-data shape, optional-field omission, success, 409 `existingId` conflict, generic failure). `.github/workflows/ci.yml`'s `client` job now runs `npm run test` after typecheck — previously only typecheck ran, so the client's own test file (even the pre-existing 3 tests) was never actually gated in CI.

- [x] **`bcryptjs` is pure-JS and CPU-blocking** — swapped for native `bcrypt` (prebuilt binaries, confirmed installing cleanly on this Windows machine with no build tools needed — hash/compare smoke-tested directly before committing to it) in `server/routes/auth.ts` and `routes/users.ts`; same API shape (`hash`/`hashSync`/`compare`), so this was an import-path change plus swapping the `vi.mock('bcryptjs', ...)` target to `'bcrypt'` in the two route test files. `@types/bcryptjs` removed in favor of `@types/bcrypt`.
- [x] **Open CORS with no origin allowlist** — added `CORS_ORIGINS` (comma-separated) to `lib/env.ts`; `server/index.ts` now passes it to `cors({ origin, credentials: true })`. Unset defaults to same-origin-only (`false`) in production (the client is served by this same process there) and permissive (`true`, reflects the request origin) in development, so the Vite dev server keeps working with zero config out of the box.
- [x] **No dependency/vulnerability scanning in CI** — ran `npm audit fix` on both sides first (server: 11 → 3 vulnerabilities, all "no fix available" — `adm-zip`/`sharp` via `@huggingface/transformers`'s `onnxruntime-node`, and `xlsx` itself; client: 8 → 1, `react-router-dom`'s moderate open-redirect advisories, which need a v6→v7 major bump not attempted here). New `.github/workflows/security-audit.yml`, deliberately **separate** from the main `ci.yml` (weekly cron + manual dispatch) so it can't block merges on those already-known, currently-unfixable findings — it exists to surface *new* high/critical advisories, not to re-litigate accepted risk on every push.

---

## V2 Roadmap — Completed Items (Resolved 2026-07-20 to 2026-07-22)

> Re-scoped 2026-07-17: audited the original `Fix -> Test -> Backup -> Visibility -> AI -> Git ->
> Integrations -> Multi-user` pipeline. Remaining open item (Two-Way Integration Sync) stays in
> TASKS.md. This section archives everything else, which is fully resolved.

### CI Coverage Gating (resolved 2026-07-20)

- [x] **Enforced a coverage threshold in `.github/workflows/ci.yml`'s server job** — the "Tests" step
      now runs `npm run test:coverage` instead of `npm test`, and `server/vitest.config.ts` gained a
      `coverage.thresholds` block. Baseline picked from a fresh run (34 files / 250 tests): actual was
      Statements 39.61% / Branches 30.12% / Functions 36.45% / Lines 41.14% — set thresholds a few
      points below actual (37/28/34/39) so CI gates real regressions without being flaky on incidental
      noise, rather than picking an arbitrary round number. Coverage is low overall because several
      services (`backup.ts`, `exporter.ts`, `notifier.ts`, `notifications.ts`, `tasks-watcher.ts`, the
      Claude/Antigravity discovery services, `session-reader.ts`) have zero tests today — raising the
      floor is a separate follow-up, not part of this gate. Verified the gate actually fires: temporarily
      set `statements` to 90%, confirmed `vitest` prints `ERROR: Coverage for statements (39.61%) does
      not meet global threshold (90%)` and exits non-zero; reverted to 37 and confirmed a clean pass/exit
      0 at the real baseline.

### Zero-Coverage Service Tests (found via 2026-07-20 coverage baseline)

> Coverage report from the CI Coverage Gating baseline above showed 9 services at or near 0%
> (~1370 lines untested). Split into one item per service, ordered by priority: small/high-impact
> first, hardest-to-test last. Each item should raise `server/vitest.config.ts`'s
> `coverage.thresholds` floor to match once its service is covered, so the gate keeps tightening
> instead of just holding steady.

- [x] **`server/services/backup.ts`** (resolved 2026-07-21) — 9 new tests
      (`tests/services/backup.test.ts`) covering `triggerBackupNow()` (real temp-dir + real `archiver`
      zip write, verifies the file lands and `last_backup_at` is recorded, plus the rejection path when
      the archive build fails) and `startBackupScheduler()`'s internal `maybeRunBackup()` — DB-not-ready,
      no settings row yet, `schedule: 'off'`, no path configured, still-within-threshold, and both the
      success and failure branches of an actual scheduled run (bridged fake timers for the 30s startup
      delay with real timers + `vi.waitFor` for the real fs/archiver I/O underneath, since that isn't
      timer-driven). 100% line / 100% branch coverage on the file.
      **Found a live production bug while writing these tests**: `archiver` was pinned `^8.0.0` in
      `package.json`, and v8 is a breaking rewrite — pure ESM, no more `archiver(format, opts)` factory
      function, replaced by format-specific classes (`ZipArchive`/`TarArchive`/`JsonArchive`). `@types/archiver`
      is still on the old `^7.0.0` factory-function shape, so `tsc` saw nothing wrong, but at runtime both
      `runBackup()` here and **both routes in `server/routes/export.ts`** (`/api/export/project/:id` and
      `/api/export/all`) threw `archiver is not a function` — scheduled backups and manual exports have
      been broken since whenever archiver was last bumped. Fixed both files: swapped the
      `require('archiver') as typeof import('archiver')` cast for
      `const { ZipArchive } = require('archiver') as { ZipArchive: new (options?: ArchiverOptions) => Archiver }`
      (kept the existing `createRequire` pattern rather than switching to a native `import`, since
      `@types/archiver` has no named exports for the real v8 shape) and `archiver('zip', opts)` →
      `new ZipArchive(opts)` at all three call sites. `tsc --noEmit` clean on both sides, full server
      suite 259/259, lint clean.
- [x] **`server/services/exporter.ts`** (resolved 2026-07-21) — 11 new tests
      (`tests/services/exporter.test.ts`) covering `addProjectToArchive()` (per-item markdown files for
      documents/issues/commands with frontmatter round-tripped through `gray-matter`, the four collective
      `*.md` files and their `rows.length > 0` skip-when-empty gates, and `slugify()`'s lowercase/strip/
      truncate/`'untitled'`-fallback behavior) and `buildZipToStream()` (`'all'` vs. an explicit project-id
      array, the `WHERE id = ANY($1)` query shape, `archive.finalize()` always called including when zero
      projects match). Deliberately included DB rows with `null` (not `[]`/`''`) for every optional
      jsonb/text field — `investigation_steps`, `notes`, `features`/`fixes`/`breaking_changes`, runbook
      `steps`, document `content` — since those are exactly the `?? []` / `?? ''` / `||` fallback branches
      that a "populated + empty-array" fixture pair alone doesn't reach. 100% statements/lines/functions,
      98.57%→100% branches on the file. No production bug found here (unlike the `backup.ts` item above) —
      `addProjectToArchive`/`buildZipToStream` only build strings and call `archive.append`/`finalize`,
      never construct an `Archiver` themselves, so they were unaffected by the archiver@8 breakage. Full
      suite 270/270, `tsc --noEmit` and lint clean.
- [x] **`server/services/notifier.ts`** (resolved 2026-07-21) — 10 new tests
      (`tests/services/notifier.test.ts`) covering `sendAppriseNotification()`: no enabled channels (no
      spawn), the three-way per-project preference branch (no pref row → default-allowed, explicit
      `enabled: true`, explicit `enabled: false`), a channel whose `decrypt()` throws (skipped, others
      unaffected, `console.error` asserted), "every channel filtered out" (no spawn), the Python
      subprocess's non-zero exit with and without `stderr` (fallback message), malformed JSON on stdout
      (`console.error` + `'Invalid JSON output: ...'` asserted), the `results.sent === false` +
      `results.error` absent edge case (body left unchanged), and `entity_type`/`entity_id`/`channel`/
      `delivery_status` INSERT params for both the project-scoped and global cases. `child_process.spawn`
      mocked with a hand-built `EventEmitter`-based fake child (real stdout/stderr/close events), synced
      to the async DB-then-spawn flow via `vi.waitFor(() => expect(spawn).toHaveBeenCalled())` before
      driving it — no fake timers needed since nothing here is timer-driven. 100% coverage on the file.
      No production bug found. Full suite 280/280 at the time, `tsc --noEmit` and lint clean.
- [x] **`server/services/antigravity-discovery.ts` + `server/services/claude-discovery.ts`** (resolved
      2026-07-21) — these two files are near-duplicates (differ only in marker filename —
      `ANTIGRAVITY.md` vs. `CLAUDE.md` — and one redundant `SKIP_DIRS` entry, `.gemini`, which the
      dot-prefix skip rule already covers), so they got matching 14-test suites
      (`tests/services/antigravity-discovery.test.ts`, `tests/services/claude-discovery.test.ts`) against
      real temp-directory fixture trees (`fs.mkdtemp`, no mocking — pure fs/parsing logic per the backlog
      note). Covered: full project (marker + `TASKS.md` phases incl. `[~]`/`[!]` markers counting toward
      `total` but not `done`, `sessions/` date-folder selection ignoring non-date-named siblings),
      marker-only fallback to dirname with empty phases, qualifying via `TASKS.md`'s `project:`
      frontmatter field alone vs. not qualifying when that field is absent, qualifying via a bare
      `sessions/<dir>/SESSION.md` with no marker/`TASKS.md`, a `sessions` entry that's a file not a
      directory (readdir-fails catch branch), `SKIP_DIRS`/dotfolder skipping, no-recursion-into-an-
      already-qualifying-folder, the `maxDepth = 3` boundary (found at depth 3, not at depth 4), malformed
      `TASKS.md` frontmatter falling back gracefully, a nonexistent scan root, an already-aborted signal,
      and `existingProjects` matching by normalized `short_name` (not just `name`). 100% lines, ~88%
      branches (the remaining gap is `signal.aborted` mid-scan cancellation checks — real but only
      reachable via a genuine async race with an in-flight recursive scan, not worth a flaky test to
      force), ~93% functions on both files.
      **Found a live production bug while writing these tests**: `parseTasksMd()`'s
      `lastUpdated = data.last_updated ? String(data.last_updated) : null` — `gray-matter`'s YAML parser
      auto-converts an unquoted ISO timestamp into a JS `Date` (YAML's implicit core-schema timestamp
      type), and both integration templates (`integrations/claude-code/src/templates/TASKS.md`,
      `integrations/antigravity/.../templates/TASKS.md`) ship exactly that unquoted format
      (`last_updated: 2025-05-17T10:30:00`). `String(date)` on that produces a locale/timezone-dependent
      string like `"Fri May 17 2025 10:30:00 GMT+0000 (Coordinated Universal Time)"`, not an ISO date —
      which broke `client/src/components/projects/TasksTab.tsx:93`'s `tree.lastUpdated.slice(0, 10)` date
      badge (rendered garbled text like "updated Fri May 17" instead of "updated 2025-05-17") for every
      project set up via the standard template. Fixed in both discovery services: `data.last_updated
      instanceof Date ? data.last_updated.toISOString() : String(data.last_updated)` — normalizes the
      Date case to a real ISO string while still passing through an already-quoted string frontmatter
      value unchanged (both branches covered by new tests). Full suite 308/308, `tsc --noEmit` and lint
      clean on both sides.
- [x] **`server/services/session-reader.ts`** (resolved 2026-07-21) — 15 new tests
      (`tests/services/session-reader.test.ts`) against real temp-directory fixtures (no mocking, same
      approach as the discovery services above) covering `readSessions()` (missing/empty `sessions/`
      dir, a fully-populated `SESSION.md` with both `-`/`*` bullet styles and a `## Session Ended` block,
      minimal frontmatter falling back to folder-derived values + `'active'` default + omitting `ended`,
      newest-first sort by folder name, a non-directory entry inside `sessions/` being skipped via the
      catch branch, a folder name with no `YYYY-MM-DD` prefix, and the `## Session Ended` parser
      continuing past a line that doesn't match `ended:\s*(.+)` before finding the real one) and
      `readSessionDetail()` (match by `session_id`, fallback match by folder name, no match → `null`,
      and — deliberately structured as *only* a broken entry rather than "broken + valid sibling", since
      the function returns on first match and a valid sibling could otherwise mask the catch branch
      entirely depending on directory iteration order — an unreadable folder correctly falling through
      to `null` without throwing). 100% statements/branches/functions/lines on the file.
      **Found the same live production bug a third time**: both `readSessions()` and
      `readSessionDetail()` had the identical `data.started ? String(data.started) : date` pattern as
      the `claude-discovery.ts`/`antigravity-discovery.ts` item above, and the real session-start hooks
      (`integrations/{claude-code,antigravity}/src/hooks/session-start.{sh,ps1}`) write exactly the
      vulnerable unquoted format (`started: 2025-05-17T10:30:00Z`) into every `SESSION.md`. Extracted a
      shared `frontmatterString()` helper (`value instanceof Date ? value.toISOString() : String(value)`)
      and used it at both call sites instead of duplicating the ternary a third time. The observable
      impact here is milder than the `TasksTab.tsx` case — `SessionsTab.tsx`'s `fmtTime()` re-parses the
      value via `new Date(iso)` rather than string-slicing it, and V8 happens to round-trip its own
      `Date.toString()` output, so the display doesn't currently show garbage — but it's still the same
      underlying defect (relying on undocumented engine-specific string round-tripping instead of
      actually being an ISO string), so it's fixed for the same reason. Full suite 323/323 at the time,
      `tsc --noEmit` and lint clean.
- [x] **`server/services/notifications.ts`** (resolved 2026-07-21) — 15 new tests
      (`tests/services/notifications.test.ts`) covering `createNotification()` (default vs. explicit
      channel/deliveryStatus/entity fields), `getUsersToNotify()` (always-included active admins, the
      global-active-users branch when `projectId` is `null` vs. the `project_members` branch when it's
      set, and de-duplication when an admin is also a project member), `scanStaleIssues()` (the
      `stale_issues_enabled === false` early return, default vs. custom `stale_threshold_days`, creating
      a notification for a not-yet-notified user, skipping a user already notified about the same stale
      issue within 24h, notifying project members for a project-scoped issue, and the outer try/catch
      logging via `console.error` without throwing), `startNotificationScheduler()` (fake-timer-advanced
      through both the 15s initial delay and the hourly interval, confirming `scanStaleIssues` fires
      each time), and `startDigestScheduler()` (`spawn` called with the right args/`stdio: 'inherit'`,
      plus its `'error'`/`'close'` handlers, using the same `EventEmitter`-based fake-child pattern as
      `notifier.test.ts`). 100% lines/branches, 95.12% statements, 83.33% functions — the gap is the
      `.catch(err => console.error(...))` wrapping each `scanStaleIssues()` call in the scheduler, which
      by construction never actually rejects (its own internal try/catch swallows everything first), so
      forcing that branch would need a fragile test rather than a meaningful one. No production bug
      found. Full suite 338/338 at the time, `tsc --noEmit` and lint clean.
- [x] **`server/services/audit.ts`** (resolved 2026-07-21) — 3 new tests
      (`tests/services/audit.test.ts`): a full `logAudit()` call with metadata serialized to JSON, every
      optional field (`userId`/`username`/`entityName`/`metadata`) nullified when omitted, and DB errors
      swallowed without throwing (audit failures are explicitly non-fatal). 100% coverage on the file. No
      production bug found. Full suite 341/341, `tsc --noEmit` and lint clean.
- [x] **`server/services/tasks-watcher.ts`** (resolved 2026-07-21) — 16 new tests
      (`tests/services/tasks-watcher.test.ts`) split into `readTaskTree()`/`parseTasksFile()` against real
      temp-directory `TASKS.md` fixtures (missing file, full frontmatter + all four checkbox statuses
      `[x]`/`[ ]`/`[~]`/`[!]` + a `<!-- done: YYYY-MM-DD -->` stamp, malformed frontmatter falling back
      gracefully, a phase with zero items not dividing by zero, a checklist-shaped line appearing before
      any `## ` heading being ignored, and a body with no headings at all) and the `chokidar`-backed
      watcher lifecycle (`subscribe`/`refreshProjectWatch`/`initTasksWatcher`) with `chokidar` and the DB
      pool mocked — a hand-built `EventEmitter`-based fake `FSWatcher` (`.on`/`.close()`), covering the
      300ms debounce (not-yet-fired at 299ms, fires at 300ms), coalescing rapid changes into one
      broadcast, no broadcast after unsubscribe, a subscriber whose `res.write()` throws being dropped
      from the set without affecting others, `refreshProjectWatch` closing the previous watcher and
      clearing its pending debounce timer before starting a new one, `fsPath: null` closing without
      restarting, and `initTasksWatcher`'s DB-driven startup (N projects → N watchers + a count log, 0
      projects, and a query failure logged via `console.error` without throwing).
      **Debounce callback awaits real `fs.readFile`, which fake timers don't drive** (same shape as the
      `backup.ts` item's scheduler test) — advancing past the 300ms mark only *starts* the callback; the
      broadcast lands asynchronously afterward. Fixed by switching to real timers + `vi.waitFor()`
      immediately after the fake-timer advance that crosses the debounce threshold, same bridge pattern
      as `backup.test.ts`. 100% statements/branches/functions/lines on the file.
      **Found the same `lastUpdated` bug a 4th time, and extracted a shared fix**: `parseTasksFile()` had
      the identical `data.last_updated ? String(data.last_updated) : null`, and — unlike the discovery
      services, which only feed the *scan* view — `readTaskTree()` backs the *live* per-project view:
      `GET /api/claude-projects/:id/tasks` and `GET /api/antigravity-projects/:id/tasks`
      (`routes/{claude,antigravity}-projects.ts`) both call it directly, and both feed the exact same
      `TasksTab.tsx:93` `.slice(0, 10)` display already fixed for the discovery-scan path — so the live
      per-project tab was still showing the garbled date even after that earlier fix. At four independent
      copies of the same one-liner (`claude-discovery.ts`, `antigravity-discovery.ts`, `session-reader.ts`,
      now this file), duplicating a fifth guard stopped making sense — extracted `frontmatterString()` into
      new `server/lib/frontmatter.ts` (4 new tests, `tests/lib/frontmatter.test.ts`, 100% coverage) and
      switched all four call sites to import it instead of inlining or locally duplicating the check
      (`session-reader.ts`'s own local copy of the same helper removed in favor of the shared one).
      Full suite 361/361, `tsc --noEmit` and lint clean on both sides.

**All 9 zero-coverage services from the 2026-07-20 baseline are now covered.** Server coverage overall:
Statements 83.65% / Branches 78.62% / Functions 84.97% / Lines 87.36% (baseline was 39.61/30.12/36.45/41.14%).

### Partially-Covered Service Tests (found via 2026-07-20 coverage baseline)

> Same baseline, the tier above 0% — these have *some* tests but leave large gaps. Deepening these
> should also raise `coverage.thresholds` once done.

- [x] **`server/services/links.ts`** (resolved 2026-07-21) — 10 new tests (`tests/services/links.test.ts`):
      `resolveEntities()` (empty-`ids` short-circuit without a query, the `issue`/`release` table+column
      maps, a `null` subtitle passed through), `entityExists()` (row present/absent), and
      `deleteLinksFor()` (the `a_type`/`b_type` OR-clause DELETE). 100% coverage on the file.
- [x] **`server/services/ai.ts`** (resolved 2026-07-21) — extended the existing `tests/services/ai.test.ts`
      (Ollama-only before) with full Claude and Gemini coverage for both `aiChat()` and `aiChatStream()`:
      request shape (system prompt separated for Claude, `system_instruction` + role remap — `assistant`
      → `model` — for Gemini), non-ok responses throwing with the provider-specific error message, SSE
      parsing for both providers (`content_block_delta` events for Claude, `candidates[].content.parts[]`
      for Gemini) including a malformed-JSON line and a well-formed-but-textless event both being skipped
      rather than throwing, and Gemini's `system_instruction` being omitted entirely when no system
      message is present. Also added the one missing Ollama-path case: a malformed NDJSON stream line
      being skipped instead of aborting the rest of the stream. Provider switching is driven by mutating
      the shared mocked `env.AI_PROVIDER` between describe blocks (reset to `'ollama'` in each `afterEach`)
      rather than a second mock setup, since `ai.ts` reads `env.AI_PROVIDER` live on every call rather
      than caching it at import time. 100% coverage on the file (up from 37.86%/29.16% branch).
- [x] **`server/services/integrations.ts`** (resolved 2026-07-21) — extended `integrations.test.ts` with
      `syncJira()` entirely (previously untested): the Basic-auth header construction, `mapJiraStatus`/
      `mapJiraPriority`'s branches (`Done`→resolved, `In Review`→investigating, else→open;
      `Blocker`→critical, `Major`→high, `Minor`→low, absent→medium), the
      `description?.content?.[0]?.content?.[0]?.text || ''` optional-chain fallback, the ON CONFLICT
      rowCount 0 → skipped branch, and `integration.config ?? {}` when no config is set. Also rounded out
      `syncGitHub` (existing/rowCount-0 → skipped, no-token → no `Authorization` header, non-ok throws)
      and `syncLinear` (the remaining `mapLinearPriority`/`mapLinearStatus` branches, a GraphQL
      `errors[]` response throwing with the API's own message, non-ok throws). One test-authoring bug
      caught and fixed before it shipped: a fixture used Jira priority `"Trivial"`, which doesn't contain
      either `"low"` or `"minor"` and would actually map to `medium`, not `low` — corrected to `"Minor"`.
      100% coverage on the file (up from 46.83%/29.23% branch).
- [x] **`server/services/parser.ts`** (resolved 2026-07-21) — extended `parser.test.ts` with the
      previously-untested `.pdf`/`.docx` paths on both sides (MarkItDown-success and the
      MarkItDown-unavailable native fallback via `pdf-parse`/`mammoth`, both mocked the same way the
      existing `.doc`/word-extractor test already does — a real PDF/DOCX binary fixture isn't worth
      constructing for a unit test), `.xlsx`'s native fallback via a **real** workbook built and written
      with the `xlsx` package itself (unmocked — round-tripping the library's own writer/reader avoided
      having to hand-mock its sheet/CSV API surface) asserting the `## Sheet: <name>` + CSV-per-sheet
      output across two sheets, a `.pptx` MarkItDown-unavailable case hitting the "PPTX requires
      MarkItDown" throw (the existing pptx test only exercised the MarkItDown-success path),
      `renderCellOutput`'s `error`-type rendering and its final `''` fallback for an unrecognized output
      type with no `text/plain` data, `joinSource`'s plain-string (non-array) and empty/undefined
      branches, a notebook JSON with no `cells` field at all, and `parseUrl`/`fetchUrl` (success trims
      the fetched text and derives the title from the URL's hostname; a non-ok Jina response throws with
      status + statusText). 100% statements/lines/functions, 98.14% branches — the one remaining branch
      (the ternary's `ext === 'md'` arm inside the MarkItDown-success `else` block) is genuine dead code:
      `.md` is never in `markItDownSupported`, so that branch of `text !== null` can't be reached by any
      input, not a real gap. Up from 64.21%/70.37% branch.

**All four Partially-Covered services are now at or effectively at 100%.** `lib/**+services/**` overall:
Statements 96.29% / Branches 92.26% / Functions 95.85% / Lines 99.01% (was 83.65/78.62/84.97/87.36% after
the Zero-Coverage pass above, and 39.61/30.12/36.45/41.14% at the original 2026-07-20 baseline). Full
server suite 401/401, `tsc --noEmit` and lint clean.

### Untested Route Handlers (found via 2026-07-20 audit — routes/** not yet in the coverage gate)

> `routes/**` isn't in `vitest.config.ts`'s `coverage.include` at all yet (see the item below), so none
> of this shows up in the coverage percentage today — found instead by diffing `routes/*.ts` against
> `tests/routes/*.test.ts` imports. 14 of 25 route files already have a dedicated test file
> (`documents.ts`, `issues.ts`, `chat.ts`, `git.ts`, `links.ts`, `notifications.ts`, `notify.ts`,
> `projects.ts`, `search.ts`, `tasks.ts`, `templates.ts`, `api-tokens.ts`, `audit.ts`, `auth.ts`). These
> 11 have none. Ordered smallest first.

> **All 11 resolved 2026-07-21** — 304 new tests across 11 new `tests/routes/*.test.ts` files, all at or
> effectively at 100% coverage in isolation (`--coverage.include='routes/<file>.ts'`). Every handler test
> calls the route function directly off the Express router's own `stack` (bypassing `requireRole`/
> `multer` middleware and real HTTP entirely — middleware sits earlier in the same route's stack, the
> handler under test is always `stack[stack.length - 1].handle`), so no supertest/real-server harness was
> needed anywhere in this batch.
>
> **One real cross-cutting bug in the *test* suite, not the app, worth flagging for future route test
> work**: `vi.clearAllMocks()` clears call history but does **not** clear queued
> `mockResolvedValueOnce`/`mockRejectedValueOnce` values. `users.test.ts` initially had a test whose
> request body failed Zod validation before ever reaching `pool.query`, so that test's queued rejection
> went unconsumed and silently leaked into (and desynced) every subsequent test in the file. Fixed the
> immediate bug and switched that file (and `commands.test.ts`, `settings.test.ts`) to
> `vi.resetAllMocks()` in `beforeEach`, which also clears the once-queue — the safer default whenever a
> route under test has an early-return path that a test might trigger by accident.
>
> **Found and fixed one production bug in the process**: see `export.ts`'s changelog entry below — the
> same `archiver@8` breakage originally caught in `services/backup.ts` extended to this route's two
> endpoints too, and was still unfixed here.

- [x] **`server/routes/export.ts`** — 5 tests (`export.test.ts`), reusing the real-archiver-plus-real-
      `Writable`-sink pattern from `services/backup.test.ts` (a plain `status`/`json` stub can't stand in
      for `res` here since `archive.pipe(res)` needs a real stream). **Found the same `archiver@8`
      breakage as the `backup.ts` item further up this file, in a route that hadn't been touched by that
      fix**: `/api/export/project/:id` and `/api/export/all` both still called the old
      `archiver('zip', opts)` factory function, so both were throwing `archiver is not a function` at
      runtime despite `tsc` being clean (same root cause — `@types/archiver` is pinned to the pre-v8
      factory-function shape). Fixed both call sites the same way as `backup.ts`: swapped to
      `new ZipArchive(opts)` via the same `createRequire` cast. 87.5%/100%/50%/100% — the gap is
      `archive.on('error', ...)`'s callback, never forced into a real archiver error state.
- [x] **`server/routes/aitask.ts`** — 14 tests (`aitask.test.ts`): validation, the non-streaming and SSE
      streaming paths (`aiChatStream`'s `onChunk` callback, the `[DONE]` sentinel, an error mid-stream
      still ending the response), and the fire-and-forget `handleAiTaskDoneNotification()` (default vs.
      `ai_task_alerts_enabled: false`, task truncated to 60 chars in the notification body, a notification
      failure logged via `console.error` without affecting the already-sent response) — awaited via
      `vi.waitFor()` since it's never awaited by the route itself. 100% lines/branches/statements, 60%
      functions (the two empty `.catch(() => {})` arrows guarding that same structurally-never-rejects
      promise, same shape as the `notifications.ts` service item above).
- [x] **`server/routes/integrations.ts`** — 18 tests (`integrations.test.ts`): config CRUD, token
      encryption on create (and `COALESCE`-preserving the existing one when a create/update omits a new
      token), and `/:id/sync`'s provider dispatch (github/jira/linear/unrecognized-provider-defaults-to-
      zero), token decryption only when `token_enc` is set, the sync-complete notification's default-on
      and `sync_alerts_enabled: false` branches, a notification-lookup failure logged without breaking the
      response, and `last_synced_at` only being updated on sync success (not after a thrown sync error).
      100% coverage on the file.
- [x] **`server/routes/runbooks.ts`** — 25 tests (`runbooks.test.ts`): full CRUD plus `GET /` 's WHERE-
      clause construction (`projectId=global` vs. a specific id vs. `search`, and their combined `$1`/`$2`
      placement), `PUT /:id`'s dynamic `SET` clause (including the `steps` column's `::jsonb` cast +
      `JSON.stringify`), and `POST /:id/use`. 100% coverage on the file.
- [x] **`server/routes/antigravity-projects.ts`** + **`server/routes/claude-projects.ts`** — 28 tests
      each (near-duplicate files, matching suites, same pairing rationale as the discovery-service item
      above): `/scan` (no scan root configured, a successful scan, **a second scan request aborting the
      first's `AbortController`** — verified by capturing the signal passed into the mocked
      `discoverProjects()` and asserting `.aborted` after the second request starts, then resolving the
      first to avoid leaving it hanging — and a scan failure), `/:id/tasks`, the SSE `/:id/tasks/watch`
      endpoint (headers + initial payload + `subscribe()`/`unsubscribe()` on `req`'s `'close'` event, the
      5-minute idle-timeout `setTimeout` via fake timers, and the `!res.headersSent` guard on the error
      path — simulated by having `flushHeaders()` flip `headersSent` before the failure), and
      `/:id/sessions` + `/:id/sessions/:sessionId` (status/search filtering across all five searchable
      fields, pagination clamped to a max `limit` of 50). 100% coverage on both files.
- [x] **`server/routes/users.ts`** — 31 tests (`users.test.ts`): user CRUD with `bcryptjs` mocked
      (`hash`/`compare` needed an explicit `Mock<(...) => Promise<...>>` cast — `vi.mocked()` picked the
      wrong overload off bcryptjs's ambiguous callback-vs-promise signatures and inferred a `void` return),
      the self-service-vs-admin-reset-another-user's-password branch (own password needs no
      `adminPassword`; someone else's needs it, verified via `bcrypt.compare` against the admin's own
      stored hash, with distinct 403s for "missing", "admin has no hash on file", and "wrong password"),
      `logAudit()` called with the right actor/entity/action on create/update/delete, "cannot delete
      yourself", and the invite flow (token hashed with real `node:crypto` for storage while the raw token
      is returned once, `created_by` nulled for the built-in `dev` user). 100% coverage on the file. This
      is also the file where the `resetAllMocks()` test-suite bug above was first caught.
- [x] **`server/routes/dashboard.ts`** — 10 tests (`dashboard.test.ts`) covering all three endpoints'
      `Promise.all`-parallel query fan-out with a single SQL-substring-dispatching mock (same pattern as
      `exporter.test.ts`'s `mockTableQueries`, needed because a shared `pool.query` mock can't otherwise
      tell six simultaneous calls apart): the project-filter branch skipping the projects-listing query
      entirely (`Promise.resolve({rows:[]})` instead of a real query when a project is selected — verified
      via call count, 6 vs. 5), and `/stats`'s default-when-no-rows fallbacks for `embeddingHealth` and
      `commandsThisWeek`. 100% coverage on the file, including 45/45 branches on `GET /`'s query-building.
- [x] **`server/routes/commands.ts`** — 38 tests (`commands.test.ts`): `GET /`'s namespace logic (
      `personal`/`team`/default-team-plus-own, each both with and without a "real" user — `legacy`/`dev`/
      absent all skip the `created_by` filter the same way), `PATCH /bulk`'s transaction (tag/favorite/
      delete actions, `BEGIN`/`COMMIT`/`ROLLBACK` via a hand-built fake `pool.connect()` client, and
      `client.release()` always firing including on failure), and the fire-and-forget
      `embedCommandAsync()` on create/update (awaited via `vi.waitFor()`, same reasoning as `aitask.ts`
      above). 100% statements/lines, 98.55% branch/92.3% functions — the gaps are the exhaustively-
      validated `action === 'delete'` `else if`'s unreachable false arm (action is pre-validated to one of
      three literals before reaching it) and `embedCommandAsync`'s empty `.catch(() => {})`.
- [x] **`server/routes/releases.ts`** — 46 tests (`releases.test.ts`), the most AI-endpoint-heavy route
      tested this session: `/ai-generate`, `/compare` (including `releaseContext()`'s notes/features/
      fixes/breaking-changes presence-or-absence formatting for both releases being compared), `/:id/qa`,
      `/import-git` (default-to-today date, `ai.* ?? []/''` fallbacks when the AI response omits fields,
      the `pgErr.code === '23505'` duplicate-version 409), `/draft` (explicit `issueIds` vs. project/date-
      range issue lookup, the issue-list-with-and-without-a-resolution formatting, 422 when no resolved
      issues are found), and standard CRUD. Every AI-JSON-extraction route shares the same
      `raw.match(/\{[\s\S]*\}/)` regex, tested via a markdown-fenced response to prove it extracts the
      object regardless of surrounding fence text. 100% coverage on the file.
- [x] **`server/routes/settings.ts`** (672 lines, largest route in the app) — 61 tests
      (`settings.test.ts`), by far the largest single test file written this session, covering all 18
      routes: LDAP (config CRUD with the bind password encrypted at rest and `hasPassword` derived from
      its presence, `/ldap/test` falling back to stored-and-decrypted settings vs. a request override,
      401 on bad LDAP creds), the AI/auth summary at `GET /` (provider-branched `chatModel`, driven by
      mutating the shared mocked `env` object's `AI_PROVIDER`/`AUTH_PASSWORD` between tests the same way
      `ai.test.ts` does), `claude`/`antigravity`/`notifications`/`digest` scan-root and rules CRUD,
      `GET /backup` (JSON export across 7 parallel queries, with the `tasks` table's own
      `.catch(() => ({rows:[]}))` fallback distinct from the outer 500 path), `POST /import` (dry-run
      tallying via `countExisting()` — including the zero-query short-circuit when a table has no ids at
      all — vs. a real transactional import via a faked `pool.connect()` client, `ON CONFLICT`
      rowCount-0-means-skipped), `backup-config`/`backup-now` (merging into existing extra fields on
      partial update, `triggerBackupNow()` only called once a path is configured), and `POST /zip-import`
      — the most involved single endpoint tested this session: built **real** `.zip` fixtures with the
      `adm-zip` package itself (unmocked, same "round-trip the library's own writer/reader" reasoning as
      `parser.ts`'s xlsx test) containing real frontmatter+body `.md` entries, covering the dry-run vs.
      real-transaction split, duplicate-title skip detection, command-text extraction from a code fence,
      silently-skipped malformed-frontmatter entries, and every one of the "not actually a document" scan
      exclusions (wrong extension, unrecognized `entityDir`, unknown project slug, too few path segments,
      directory entries). 99.29% statements, 90.19% branches, 100% functions/lines — the remaining branch
      gaps are exhaustively the same shape: per-row `?? default` fallbacks on optional bulk-import fields
      (project description/color/status/etc.) where only the "field present" side was exercised, a
      pattern already validated correct dozens of times elsewhere this session — diminishing returns to
      chase further on an already 100%-lines file.

**All 11 previously-untested route handlers are now covered.** Full server suite 705/705, `tsc --noEmit`
and lint clean (0 errors; only pre-existing `no-non-null-assertion` warnings, none introduced this
session). Isolated per-file coverage for all 11 is at or effectively at 100%; the other 14 route files
(which already had *some* test coverage before this session, e.g. `documents.ts`, `issues.ts`, `auth.ts`)
were out of scope here and still have real gaps — see the item below.

### Deepen Partially-Tested Route Handlers (found via 2026-07-21 `routes/**` coverage check)

> Byproduct of finishing the Untested Route Handlers item above: running coverage with
> `--coverage.include='routes/**'` (ad hoc — `routes/**` still isn't in the real `coverage.include`, see
> the item below) to sanity-check those 11 files also revealed exactly how thin the *other* 14 route
> files' existing tests are. These files aren't untested — each has a `tests/routes/*.test.ts` — but the
> tests only cover a fraction of each file. Ordered by measured statement coverage, lowest (most
> concerning) first. Each item should raise `server/vitest.config.ts`'s `coverage.thresholds` floor to
> match once `routes/**` is actually in the gate (see the item below) and its file is deepened.

- [x] **`server/routes/issues.ts`** (resolved 2026-07-22) — 80 tests (`tests/routes/issues.test.ts`)
      covering every handler: `GET /` 's full filter-building matrix (project id/`global`-combining,
      status/priority/tags array params, the non-array-non-string-to-single-item-array coercion, date
      range, the shared `q`/`search` full-text+ILIKE placeholder reuse, limit clamped to 100), `GET
      /related` and `GET /triage` (default vs. custom stale-threshold-days settings row, project vs.
      global vs. unfiltered), `PATCH /bulk`'s transaction (tag/status/delete actions, the
      resolved-vs-non-resolved `resolved_at` clause, rollback+400 on a non-string tag/status value,
      rollback+release+500 on a transaction failure), full CRUD (`POST`/`PUT`/`DELETE`), the
      steps-only vs. scalar-only vs. combined update paths on `PUT /:id` (steps replaced atomically,
      404 on a steps-only update against a missing issue, re-embed fires only when title/description
      actually change), notes CRUD, commit linking/unlinking (sha regex validation), and every
      AI-touching endpoint (`related-commands`, `related-docs`, `suggest-steps`'s numbered-list
      parsing incl. dropping short lines, `summarize`'s prompt construction incl. the all-empty
      `(none)`-fallback case, `reembed`, `suggest-tags`'s JSON-array extraction incl. no-match →
      `[]`). This test file already existed uncommitted on disk when this item was picked up (from
      earlier route-test-authoring work) — verified rather than rewritten: all 80 tests pass, isolated
      coverage 97.89% stmts / 94.96% branch / 98.98% lines. The one remaining branch gap
      (`PUT /:id`'s `else if (resolvedClause)` arm, lines 433-438) is unreachable dead code given the
      current schema — `resolvedClause` is only ever set when `updates.status` is present, and
      `status` is itself in `ISSUE_UPDATABLE_COLS`, so `fields.length` can never be 0 when
      `resolvedClause` is truthy — same "exhaustively-validated branch" shape already noted elsewhere
      in this file (`commands.ts`'s delete-action `else if`), not worth a fragile test to force. Full
      server suite 989/989, `tsc --noEmit` and lint clean (0 errors, only pre-existing
      `no-non-null-assertion` warnings).
- [x] **`server/routes/tasks.ts`** (resolved 2026-07-22) — a test file already existed uncommitted
      (`tests/routes/tasks.test.ts`, 24 tests) covering `GET /`'s filter-building (`global`/project id/
      status/priority, sequential placeholders), `POST /import-md`'s markdown-checkbox parser (`##`
      sections as tags, `[ ]`/`[x]` items, created-vs-skipped tallying, a per-item insert failure
      counted as skipped rather than aborting the batch, default `'Imported'` tag + null `projectId`),
      full `POST`/`PUT`/`DELETE` CRUD (`PUT`'s `done_at` auto-set/-clear on status change, the
      `project_id`/`due_date` `colMap` column-name translation, "Nothing to update" 400 on an empty
      body), plus a separate pre-existing `tests/routes/tasks_get_by_id.test.ts` (3 tests) covering the
      `GET /:id` success path and `DELETE /:id`'s `deleteLinksFor` call — together these two files
      already reached 95.14%/92% stmts/branch (100% once combined, since each file's gaps were exactly
      what the other covered). One real gap found and closed: `POST /import-md`'s `(rowCount ?? 0) > 0`
      fallback (line 139, for a `null`/`undefined` `rowCount` from the driver) had no test in either
      file — added one (`rowCount: null` → counted as skipped). Full file now 100%
      stmts/branches/functions/lines. Full server suite 990/990, `tsc --noEmit` and lint clean (0
      errors, only pre-existing `no-non-null-assertion` warnings).
- [x] **`server/routes/projects.ts`** (resolved 2026-07-22) — two test files already existed uncommitted
      (`tests/routes/projects_crud.test.ts`, full CRUD + member-management coverage; and
      `tests/routes/projects.test.ts`, the admin-vs-member visibility-join logic on `GET /` and `GET
      /:id`), together already at **100% stmts/branches/functions/lines** — verified, nothing to add.
      Covers: the admin (no join) vs. non-admin (`JOIN project_members` + `WHERE pm.user_id`) query
      branch on both list and single-project reads, full project CRUD (409 on a duplicate `short_name`
      via a message-substring check, the `''` → `null` field-coercion on `PUT`, "No fields to update"
      400), `PUT /:id/link`'s filesystem validation (422 on a non-directory or nonexistent path, the
      null-unlink skip-fs-check path, `refreshProjectWatch` called with the new path), `POST
      /seed/reset`'s prod-environment 403 guard, and full member CRUD (add/upgrade via `ON CONFLICT`,
      role-update, remove, invalid-role 400).
- [x] **`server/routes/auth.ts`** (resolved 2026-07-22) — two test files already existed uncommitted
      (`tests/routes/auth.test.ts`, the comprehensive suite; `tests/routes/auth_tokens.test.ts`, invite-
      token registration only) at 98.73% stmts / 98.83% branch / 75% functions before this pass. Covers:
      dev-mode (`AUTH_PASSWORD` unset) login/`/me` short-circuits, legacy single-password mode (wrong
      password, first-admin creation defaulting username to `"admin"`, explicit username), multi-user
      mode (missing username, deactivated account, wrong password, correct login, the timing-guard dummy
      `bcrypt.compare` against `DUMMY_HASH` when a user isn't found, LDAP fallback — config decrypt,
      auth failure, successful upsert-login, deactivated LDAP-linked user, the LDAP-settings-query-throws
      → logged + falls through to 401 path), `/register`'s three branches (first-run forces admin, invite
      token validates + deletes the invite, admin-Bearer-required otherwise, malformed/non-admin token
      handling, 409 on duplicate username vs. 500 via `serverError` otherwise), `/me`'s cookie-vs-bearer
      precedence and API-token vs. JWT paths, and `/change-password` (legacy/dev-mode block, LDAP-only
      404, wrong-current-password 401, success + `logAudit` call). One real gap found and closed: the
      `tryApiToken(token).catch(() => null)` fallback (line 256) had no test forcing `tryApiToken` to
      actually reject — added one. Full file now 99.36% stmts / 98.83% branch / 87.5% functions — the one
      remaining gap (line 43, the `express-rate-limit` `handler` callback) is structurally unreachable by
      this suite's pattern of invoking the route's own handler directly off the router stack (same
      pattern used by every other route test file in this repo) — `express-rate-limit`'s internal
      request-counting middleware sits earlier in the stack and is never exercised, so its callback can
      only fire under a real HTTP flood via `supertest`, not worth introducing a second test harness for
      one line. The remaining branch gap is the `process.env.NODE_ENV === 'production' ? 10 : 1000` rate-
      limit ternary (line 39) — evaluated once at module import time under whatever `NODE_ENV` the test
      run has, so only one side is ever reachable without a module-reset trick, same shape as `ai.test.ts`
      mutating `env.AI_PROVIDER` elsewhere except this one is baked in at import rather than read live.
- [x] **`server/routes/git.ts`** (resolved 2026-07-22) — two test files already existed uncommitted
      (`tests/routes/git.test.ts`, local-vs-GitHub-fallback logic; `tests/routes/git_crud.test.ts`, full
      route coverage), together already at **100% stmts/branches/functions/lines** — verified, nothing
      to add. Covers: `POST /:projectId/repo`'s partial-field `SET` clause (repo_url only / PAT only,
      encrypted via `encrypt()` / both with sequential placeholders / "Nothing to update" 400), `GET
      /:projectId/commits`'s local-git-preferred-with-GitHub-fallback (the local `execAsync` failure
      falling through to the GitHub API rather than erroring, `parseGitHubRepo`'s malformed/non-GitHub/
      no-repo-segment URL rejection, PAT decrypt only when stored, a non-ok GitHub response passed
      through with status + truncated body, limit clamped to 50), `GET /:projectId/branches` (local
      `git branch` + `--show-current`, empty when no `fs_path`), `GET /:projectId/diff/:sha` (400 when
      no linked local path — this endpoint has no GitHub fallback), commit link/unlink (SHA-length
      validation, `ON CONFLICT DO NOTHING`), and `GET /:projectId/compare`'s mirror of the commits
      route's local-then-GitHub-fallback logic with its own commit-log string formatting.
- [x] **`server/routes/search.ts`** (resolved 2026-07-22) — two test files already existed uncommitted
      (`tests/routes/search.test.ts`, the saved-filters/history CRUD; `tests/routes/search_query.test.ts`,
      the hybrid-search endpoint), together already at **100% stmts/branches/functions/lines** — verified,
      nothing to add. Covers: `GET /`'s empty-query "recent items per type" branch vs. the non-empty-query
      hybrid-search branch (pgvector cosine search on docs falling back to tsvector/ILIKE when `aiEmbed`
      throws — Ollama-down scenario — tsvector-with-ILIKE-fallback for issues/commands specifically when
      the primary tsvector match returns zero rows, ILIKE-only for releases/runbooks which have no
      tsvector column), the project-id filter applied consistently across every one of those query
      variants, limit clamped to [1,50], the fire-and-forget search-history insert+trim only firing when
      `req.user` is present (awaited via `vi.waitFor()`, its failure logged without affecting the
      response), `GET /suggestions`'s 3-issues+2-docs combine, and saved-filter CRUD (`POST /filters`'s
      required-field 400, `DELETE /filters/:id`'s ownership-scoped `rowCount === 0` → 404).
- [x] **`server/routes/notify.ts`** (resolved 2026-07-22) — two test files already existed uncommitted
      (`tests/routes/notify.test.ts`, an earlier pass; `tests/routes/notify_crud.test.ts`, the
      comprehensive one), together already at **100% stmts/branches/functions/lines** — verified,
      nothing to add. Covers: `POST /` (the external webhook receiver — 404 on unknown `short_name`,
      `delivered_to` summed correctly across users with differing per-user channel counts, including a
      user with zero configured channels), `POST /send-digest`'s localhost-only guard (all three
      loopback address forms — `127.0.0.1`, `::1`, `::ffff:127.0.0.1` — accepted, anything else 403s),
      `GET /log`'s full filter-building matrix (project/level/channel-lowercased/status/date-range with
      sequential placeholders, limit defaulted to 50 and clamped to 200), `POST /test`'s three-way
      outcome (no channels → 400, any channel failed → 500 with details, all sent → 200), `POST
      /retry/:id` (the `external_` prefix stripped back to a bare level, `projectId` nulled for a non-
      project-scoped notification, the stale log row deleted only when a retry actually lands `sent`),
      Apprise channel CRUD (URL masking — short URLs left unmasked, a `decrypt()` throw masked to `''`
      instead of propagating — encrypt-on-create, delete, enabled-flag patch with 400/404 guards), and
      project-notification-prefs `GET`/`PUT` (the `ON CONFLICT DO UPDATE` upsert).
- [x] **`server/routes/documents.ts`** (resolved 2026-07-22) — 11 test files already existed uncommitted
      covering the AI-touching routes in depth (`documents_explain`, `documents_diagram`,
      `documents_save_explanation`, `documents_component_overview`, `documents_find_duplicates`,
      `documents_suggest_tags_from_file`, `documents_update_content`, `documents_chunk_context`,
      `documents_component`, `documents_bulk_reembed` [re-embed action only],
      `documents_embedding_status`) — combined isolated coverage was only 68.1% stmts / 57.97% branch
      because the *plumbing* routes (list, CRUD, delete, plain re-embed, suggest-tags) had no test file
      at all. Added **`tests/routes/documents_list_and_crud.test.ts`** (58 tests) covering: `GET /`'s
      filter-building matrix (same shape as `issues.ts`/`tasks.ts` — project id/`global`-combining,
      fileType/tags/component array params, date range, `q`/`search` full-text+ILIKE, limit clamped to
      100, the non-string/non-array param coercion), `PATCH /bulk`'s tag/component/delete actions
      (component `.trim() || null` clearing, rollback+400 on non-string values, rollback+500 on a
      transaction failure — `re-embed` already covered by `documents_bulk_reembed.test.ts`), `GET /:id`
      404/500, `POST /` and `POST /url`'s remaining validation paths (422 no-extractable-text, 409
      dedup-by-content-hash, malformed-JSON tags falling back to `[]`, the outer-catch cleanup DELETE
      when a step after insert throws, and — since `docId` is only set *after* a successful insert — a
      separate case where `parseFile`/`parseUrl` itself throws before `docId` exists, proving the cleanup
      DELETE is correctly skipped rather than called with `undefined`), `PATCH /:id` (title/tags/
      projectId including the camelCase→snake_case `project_id` mapping and null-clearing, "Nothing to
      update" 400, 404 — `component` alone already covered by `documents_component.test.ts`), `DELETE
      /:id` (success + `deleteLinksFor`, 404, 500), `POST /:id/reembed` (404, the fire-and-forget
      done/failed status flow via `vi.waitFor()`, 500), and `POST /suggest-tags` (400/success/no-match/
      500 — the title+hint variant, distinct from `suggest-tags-from-file`'s real-file-content variant).
      Also closed smaller branch gaps found while chasing the remaining percentage, one test each added to
      the routes' *existing* files rather than the new one, to keep each gap colocated with its route's
      established test file: `documents_explain`/`documents_diagram` (500 response; the truncated-content
      prompt note; diagram's null-language→`'code'` fallback), `documents_save_explanation` (500; a null
      `tags` on the source doc falling back to `[]`), `documents_component_overview` (500; a null
      `projectId` + no-language file exercising the create-new path's remaining ternary branches),
      `documents_find_duplicates`/`documents_suggest_tags_from_file`/`documents_component` (500 each),
      `documents_chunk_context` (500), `documents_update_content` (422 no-text; a null-language file; the
      failed-status cleanup UPDATE itself rejecting, swallowed silently), and four "cleanup query itself
      fails, swallowed by an empty `.catch(() => {})`" cases across `POST /`, `POST /url`, and `POST
      /:id/reembed` — genuinely reachable code, not dead branches, so worth the direct coverage rather
      than leaving them undocumented. File now 99.77% stmts / 99.51% branch / 100% functions/lines — the
      one remaining branch (line 206, `PATCH /bulk`'s implicit final `else` after the `re-embed`/`tag`/
      `component`/`delete` chain) is unreachable dead code given the earlier `action` allowlist check,
      same "exhaustively-validated branch" shape as `commands.ts`'s analogous delete-action `else if`.
      Full server suite 1062/1062, `tsc --noEmit` and lint clean (0 errors, only pre-existing
      `no-non-null-assertion` warnings).
- [x] **`server/routes/templates.ts`** (resolved 2026-07-22) — rewrote `tests/routes/templates.test.ts`
      (20 tests, up from 4 loosely-structured ones covering only the happy paths) to the
      `getHandler(method, path)` + per-route-describe convention used elsewhere: `GET /`'s
      global/built-in-scoping vs. a specific `projectId` (both with and without a `type` filter) plus 500;
      `POST /`'s ZodError→400 vs. any-other-error→500 split (the route's `try/catch` distinguishes them via
      `err instanceof z.ZodError`, not a separate `.safeParse()` — different from every other route in this
      codebase, which was the reason this file's validation path had never been exercised); `PUT /:id`'s
      full dynamic-`SET`-clause coverage (`project_id`-including-null, `description`, `body` all together,
      not just `name` alone), the built-in-template 403 guard, 404, "No fields to update" 400, ZodError 400,
      and 500; `DELETE /:id`'s built-in 403, 404, and 500. 100% stmts/functions/lines, 97.05% branch — the
      one gap (`whereClause`'s `conditions.length > 0 ? ... : ''` ternary's false arm) is unreachable dead
      code: `GET /`'s `if (projectId === 'global' || !projectId) {...} else {...}` unconditionally pushes a
      condition on every request regardless of which arm runs, so `conditions.length` can never be 0.
- [x] **`server/routes/notifications.ts`** (resolved 2026-07-22) — rewrote `tests/routes/notifications.test.ts`
      (9 tests) covering all three routes' success path plus the previously-missing 404 (`PATCH /:id/read`
      against an unowned/nonexistent notification) and 500 for each, and the `limit`/`offset` default-vs.-
      given branches on `GET /`. 100% stmts/branches/functions/lines — the route layer over
      `services/notifications.ts` (already 100%, see the Zero-Coverage Service Tests item above) is now
      fully wired.
- [x] **`server/routes/audit.ts`** (resolved 2026-07-22) — rewrote `tests/routes/audit.test.ts` (8 tests)
      covering `GET /`'s full filter combination (`entityType`+`entityId`+`userId` together with sequential
      placeholders — the original test only ever set `entityType` alone), the no-filter/default-limit-
      offset case, and 500; `GET /export`'s CSV generation including the `username ?? 'system'` and
      `entity_name ?? ''` fallback branches (the original fixtures always supplied both) plus 500. 100%
      stmts/branches/functions/lines.
- [x] **`server/routes/chat.ts`** (resolved 2026-07-22) — the RAG Q&A SSE route, by far the most involved
      file in this batch. Added 13 tests to the existing 22-test `tests/routes/chat.test.ts`: the missing
      400 (invalid body) and a session-resolution DB failure returning a plain 500 *before* the SSE stream
      opens (distinct from the mid-stream error path, which must instead emit an SSE `error` event since
      headers are already flushed by that point) — covering `sendError()`/`done()` and both sides of the
      `(err as Error).message ?? 'Unknown error'` fallback (a thrown non-Error value with no `.message`);
      the 5-minute idle-timeout `setTimeout(onIdle, ...)` firing via `vi.advanceTimersByTimeAsync()` against
      a deliberately-hung `aiChatStream` mock; the `req.on('close', ...)` cleanup handler, captured and
      invoked directly since the test harness's `req.on` stub doesn't fire real socket events; the long-
      question title-truncation branch (`question.length > 60`); a long-chunk citation excerpt truncated to
      300 chars; Full Context Mode's remaining branches — prior conversation turns included in its prompt
      too (`...priorTurns.map(...)`, only reachable with an *existing* session that has real history, unlike
      every prior full-context test which used a brand-new session), and the referenced document not
      existing (falls through to normal chunk retrieval, same as the already-covered "too long" case);
      `getRecentCitedChunkIds()`'s `msg.citations ?? []` and `if (c.id)` fallback branches (a null
      `citations` field and a citation object with no `id`); `rewriteQuery()`'s own `catch` (an `aiChat`
      rejection during query-rewrite treated as "no rewrite," falling back to the canned response, not
      propagating); and 500s for `GET /sessions`, `GET /sessions/:id/messages`, and `DELETE
      /sessions/:id`. 99.29% stmts / 98.48% branch / 100% functions/lines — the one remaining gap
      (`rewriteQuery`'s internal `if (priorTurns.length === 0) return null` guard) is unreachable dead code:
      its only call site already gates on `priorTurns.length > 0` before invoking it.
- [x] **`server/routes/api-tokens.ts`** (resolved 2026-07-22) — extended `tests/routes/api-tokens.test.ts`
      with 6 tests: 500s for all three routes, the dev-mode/legacy-session rejection branch for `POST /`
      and `DELETE /:id` (previously only asserted for `GET /`, despite all three routes independently
      calling the same `requireRealUser()` guard), and `expiresInDays` actually being supplied (the `?
      new Date(...) : null` branch — the existing "creates a token" test always omitted it). 100%
      stmts/branches/functions/lines.

### Bring `routes/**` Into the Coverage Gate (resolved 2026-07-22)

- [x] Added `routes/**` to `coverage.include` in `server/vitest.config.ts` and re-baselined
      `coverage.thresholds` from a fresh run. All 25 route files already had test coverage by this point
      (the Untested Route Handlers + Deepen Partially-Tested Route Handlers items above), so the aggregate
      landed high rather than the ~65% the sequencing note here had warned about: fresh full-suite run
      (1118/1118 tests, 65 files) measured Statements 98.46% / Branches 95.78% / Functions 96.29% / Lines
      99.51% across `lib/**+services/**+routes/**` combined — up from the pre-routes 96.29/92.26/95.85/
      99.01% baseline. Set thresholds a few points below actual, same convention as the original gate:
      statements 96 / branches 93 / functions 94 / lines 97. `services/env.ts` (53% stmts) and
      `services/errors.ts` (100%/50% branch) are the only sub-90% files remaining, both tiny and outside
      today's scope. Verified the gate fires: temporarily set `statements` to 99.9%, confirmed `vitest`
      printed `ERROR: Coverage for statements (98.46%) does not meet global threshold (99.9%)` and exited
      non-zero; reverted to 96 and confirmed a clean pass, exit 0. No CI workflow change needed — `.github/
      workflows/ci.yml`'s server job already just runs `npm run test:coverage`, so the new include/
      thresholds apply automatically. `tsc --noEmit` and lint clean on both sides (0 errors, only
      pre-existing `no-non-null-assertion` warnings).

### Backup Retention & Offsite Destination

- [x] **Prune local backup files** (resolved 2026-07-22) — went with keep-last-N rather than
      age-in-days: `runBackup()`'s dated filenames (`devbrain-backup-YYYY-MM-DD.zip`) already sort
      chronologically as plain strings, so no date-parsing is needed to find the oldest ones, and a
      count is easier to reason about across mixed daily/weekly schedules than an absolute age. New
      exported `pruneOldBackups(backupPath, keepLastN)` in `server/services/backup.ts`: lists the
      directory, filters to the dated-backup filename pattern (ignoring anything else a user might have
      dropped in that folder), sorts, and unlinks everything beyond the newest `keepLastN` — a
      `keepLastN <= 0` is treated as "no limit" rather than "delete everything," and a single file's
      `unlink` failure is caught and logged per-file rather than aborting the rest of the prune or the
      backup that triggered it. Wired into `runBackup()` itself (called after a successful zip write),
      so it fires from both `maybeRunBackup()` (scheduled) and `triggerBackupNow()` (manual "Backup now").
      Retention count is user-configurable, not hardcoded: new `retention_count` field on the existing
      `backup_settings` `app_settings` row (default `DEFAULT_BACKUP_RETENTION_COUNT = 30`, exported from
      `backup.ts` so `routes/settings.ts` doesn't duplicate the magic number), validated `1–365` via zod
      on `PUT /api/settings/backup-config`, merged the same way `path`/`schedule` already are so an
      omitted field preserves whatever was last stored rather than resetting to the default. `GET
      /api/settings/backup-config` always resolves a concrete number (never `null`) so the client never
      has to know about the default itself. Client: `BackupConfig.retention_count: number`, a "Keep
      last" number input (1–365, clamped client-side too) next to the existing Schedule dropdown in
      `Settings.tsx`'s `ScheduledBackupSection`, included in both the Save and Backup-now save-then-run
      flows. 12 new tests: 6 for `pruneOldBackups` itself (over-limit deletion, already-within-limit
      no-op, non-matching filenames left alone, zero/negative treated as unlimited, a missing directory
      resolving without throwing, a mid-prune `unlink` failure logged via `console.error` without
      aborting the rest) plus one `triggerBackupNow` integration test proving real pre-existing dated
      fixture files get pruned down to the requested count end-to-end, all in
      `tests/services/backup.test.ts`; 6 new/updated tests in `tests/routes/settings.test.ts` covering the
      default-when-unset, default-when-the-stored-row-predates-the-field, explicit-value-stored,
      omitted-value-preserves-existing, and out-of-range-400 branches on `backup-config`, plus
      `backup-now` passing the configured (or defaulted) count through to `triggerBackupNow`. Full server
      suite 1130/1130 (up from 1118), coverage still comfortably above the routes/** gate's 96/93/94/97%
      thresholds (98.46/95.82/96.32/99.51% actual), `tsc --noEmit` and lint clean on both sides (0 errors,
      only pre-existing `no-non-null-assertion` warnings).
- [x] **Optional remote backup destination** (resolved 2026-07-22) — implemented both options rather
      than picking one: an S3-compatible bucket (AWS SDK v3, works with AWS/MinIO/Backblaze B2/
      Cloudflare R2 over plain HTTPS, no external binaries — chosen over a CLI-shelling approach since
      this app runs natively on Windows) and an SFTP target (`ssh2-sftp-client`, since `rsync` itself
      isn't available on Windows without WSL/Cygwin — a pure-JS SFTP client was the pragmatic substitute
      for "rsync/SFTP" that still works cross-platform), selected via a destination-type dropdown in the
      Settings UI rather than two separate features.
      New `server/services/remoteBackup.ts`: `uploadBackupToRemote()`, `pruneRemoteBackups()` (mirrors
      `pruneOldBackups()`'s local retention policy on the remote side using the *same* `retention_count`
      setting — otherwise remote storage grows unbounded the same way local backups did before that
      fix), and `testRemoteConnection()` (HeadBucket for S3 / connect-then-close for SFTP, backing a
      Settings UI "Test connection" button). Wired into `services/backup.ts`'s `runBackup()` via a new
      `handleRemote()`: best-effort, non-fatal — a remote failure is logged and recorded via new
      `last_remote_backup_at`/`last_remote_backup_error` fields on the `backup_settings` row, but never
      rolls back or fails the local backup, since that's already the primary safety net by the time
      remote upload runs. Fires from both the scheduled path (`maybeRunBackup`) and manual "Backup now"
      (`triggerBackupNow`, which gained `keepLastN`/`remote` parameters).
      Secrets (S3 secret access key, SFTP password/private key) are encrypted at rest via the existing
      `services/crypto.js` AES-256-GCM helper — same pattern as LDAP's bind password and Apprise channel
      URLs — with a `resolveRemoteConfig()` decrypt step in `backup.ts` for the scheduler/manual-trigger
      path. `routes/settings.ts`'s `PUT /backup-config` follows the established "omitted secret field
      keeps the existing encrypted value" convention (zod `.optional()` + COALESCE-style fallback), and
      `GET /backup-config` redacts secrets to `hasSecretAccessKey`/`hasPassword`/`hasPrivateKey` booleans
      (mirroring LDAP's `hasPassword`) so the client can show "already configured" without ever seeing
      plaintext or ciphertext. New `POST /backup-config/test-remote` mirrors `/ldap/test`'s "provided
      value overrides the stored+decrypted one, falling back only when the stored type matches" pattern,
      explicitly *not* falling back to a differently-typed stored secret (an S3 test can't reuse an SFTP
      password).
      Client: `Settings.tsx`'s Scheduled Backup section gained a destination-type selector with
      conditional S3/SFTP field groups (secret/password/private-key inputs show "configured — leave
      blank to keep" rather than ever displaying a stored secret), a "Test connection" button, and
      last-remote-backup-at/error display.
      New dependencies: `@aws-sdk/client-s3`, `ssh2-sftp-client` (+ `@types/ssh2-sftp-client`) — `npm
      audit` shows 11 pre-existing vulnerabilities in unrelated packages (adm-zip, xlsx, vite, js-yaml,
      etc.), none introduced by these two.
      43 new tests: 25 in new `tests/services/remoteBackup.test.ts` (upload/prune/test-connection across
      S3 and SFTP, the "none" no-op, prefix handling, a missing-`Contents`/keyless-object edge case, an
      SFTP `mkdir`-already-exists tolerance, and every `.catch(() => {})` connection-close guard across
      all three exported functions — 100% stmts/branches/functions/lines on the file); 8 in
      `tests/services/backup.test.ts` (`resolveRemoteConfig`'s decrypt/passthrough branches, remote
      upload+prune+status-write wiring through `triggerBackupNow`, a remote failure being logged/recorded
      without throwing or blocking the local backup's own success, and the scheduled path resolving and
      invoking the configured remote); 10 in `tests/routes/settings.test.ts` (GET redaction for both
      remote types, PUT encrypting/preserving/switching-away-from secrets, 400 on an unrecognized remote
      type, `backup-now` resolving and threading the stored remote through, and `test-remote`'s
      stored-secret-fallback / cross-type-no-fallback / underlying-error-message-on-failure branches).
      Full server suite 1180/1180 (up from 1130), coverage still comfortably above the routes/** gate's
      96/93/94/97% thresholds (98.51/95.95/96.3/99.53% actual), `tsc --noEmit` and lint clean on both
      sides (0 errors, only pre-existing warnings), client production build succeeds.

### Trend & Visibility Dashboards (resolved 2026-07-22)

- [x] **Issue throughput (opened/resolved per week) per project** — new `GET
      /api/dashboard/issue-throughput` in `server/routes/dashboard.ts`, a pure aggregation over
      `issues.created_at`/`resolved_at` (no schema change needed) mirroring the existing `GET
      /dashboard/activity` handler's `generate_series` + `date_trunc` + `LEFT JOIN` day-bucket pattern,
      just at week granularity over a 12-week (~3 month) window, and reusing the same `pid`/`pf()`
      project-filter convention already in that file. Client: `dashboardApi.issueThroughput()` +
      `IssueThroughputWeek` type in `lib/api.ts`, new hand-rolled `IssueThroughputChart` widget in
      `Dashboard.tsx` (grouped two-bar-per-week, no chart library — matches every other widget in this
      file, e.g. `OpenIssuesByProject`'s plain CSS bars), wired into the existing analytics grid and
      fetched inside `loadAnalytics()`.
- [x] **Embedding health over time** — unlike throughput, `documents.embedding_status` only reflects
      *right now*, so this needed real historical snapshots: new `embedding_health_snapshots` table
      (migration `db/migrations/add_embedding_health_snapshots.ts`, mirrored into `db/schema.sql` per
      this repo's convention of keeping schema.sql as the canonical fresh-install source), and a new
      `server/services/embeddingHealthSnapshot.ts` scheduler following `services/backup.ts`'s exact
      shape (`startBackupScheduler()`'s 30s-startup-delay-then-hourly pattern, DB-not-ready swallowed via
      `catch {}`) — `captureSnapshot()` counts `documents` by `embedding_status` and inserts one row,
      `pruneOldSnapshots()` deletes anything older than 30 days every tick (bounded retention from day
      one, unlike `backup.ts`'s original unbounded growth — see the still-open "Backup Retention" item
      below, which exists precisely because that mistake wasn't caught earlier). **Scope call: global,
      not per-project** — the GPU-thrashing failure mode this exists to catch (2026-07-15, see Known
      Issues) is a system-wide Ollama problem, not a per-project one, so a single global counter keeps
      the schema and scheduler trivial; flagged explicitly in the plan and approved. Wired into
      `index.ts` alongside the other schedulers. New route `GET /api/dashboard/embedding-health-trend`
      (last 30 days, oldest first, no project filter). Client: `dashboardApi.embeddingHealthTrend()` +
      `EmbeddingHealthSnapshot` type, new `EmbeddingHealthTrendChart` widget — a small hand-rolled SVG
      polyline chart (pending + failed lines; `done` omitted from the plot since it dominates the scale
      and isn't the signal being watched for), showing a "Not enough history yet" empty state below 2
      snapshots.
      12 new tests in `tests/services/embeddingHealthSnapshot.test.ts` (capture/prune query shape,
      scheduler timing via fake timers matching `backup.test.ts`'s approach, a capture failure swallowed
      without throwing and skipping that tick's prune) — 100% stmts/branches/lines, 75% functions (the
      gap is two `.catch(() => {})` guards on a promise chain that structurally never rejects, same
      accepted shape as `aitask.ts`'s equivalent noted earlier in this file) — plus 6 new route tests in
      `tests/routes/dashboard.test.ts` for the two new endpoints, 100% coverage. Full server suite
      1118/1118, `tsc --noEmit` and lint clean on both sides (0 errors).
      **Verified live**: ran the migration against the local dev DB, started the app via
      `devbrain.ps1 dev start`, and checked the real Dashboard in a headless-browser session — both
      widgets render correctly (Issue Throughput showing real non-zero "opened" bars against
      correctly-zero "resolved" bars, matching the 0-resolved-in-30-days state also shown by the
      pre-existing Avg Resolution widget; Embedding Health Trend showing the expected empty state).
      Confirmed the scheduler itself fires for real in the running server, not just under test: after
      the 30s startup delay it captured a snapshot whose counts (26 done / 0 elsewhere) exactly matched
      a direct DB query of the live `documents` table.

---

## v1.x Backlog — Lint Cleanup (found via full code review 2026-07-17)

> Full codebase review 2026-07-17 — `tsc --noEmit` clean and full test suite green (247 server + 3
> client tests) on both sides, but `npm run lint` currently fails on both. One real bug found and
> already fixed: `AiTask.tsx`'s `useExample()` helper was renamed to `applyExample()` — the `use*`
> name made ESLint's `react-hooks/rules-of-hooks` treat it as a hook call inside a `.map().onClick`
> callback. Everything below is style/type-safety cleanup only — nothing is a runtime bug. Grouped so
> each bullet can be picked up independently.

### react-hooks / React Compiler ruleset (resolved 2026-07-17)

- [x] **Downgraded to warnings in `client/eslint.config.js`** — confirmed the app doesn't actually
      build with React Compiler (no `babel-plugin-react-compiler` anywhere in `client/package.json` or
      `vite.config.ts`), so `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/purity`,
      and `react-hooks/preserve-manual-memoization` (all pulled in as `error` via
      `reactHooks.configs.recommended.rules` on the `eslint-plugin-react-hooks@7.x` bump) had zero
      runtime effect today — they only matter if/when React Compiler is adopted. Rewriting the ~20
      affected files' fetch-on-mount effects to satisfy them now would've been a wide, risky diff for
      no behavioral gain. Set all four to `'warn'` instead of `'error'` so they stay visible without
      failing `npm run lint`; revisit as errors (or do the React Query migration considered and
      deferred) if React Compiler is actually adopted later. `react-hooks/rules-of-hooks` stays an
      error — that one's a real bug class (see `AiTask.tsx`'s `useExample` → `applyExample` rename,
      fixed the same day). Verified: `npm run lint` error count dropped from 69 to the unrelated
      `no-explicit-any` backlog item; typecheck and full test suite (3/3) still clean.

### Type safety — `@typescript-eslint/no-explicit-any` (resolved 2026-07-17)

- [x] **Server** — replaced every `any` with a real type: `getArrayParam(query: any, ...)` in
      `routes/documents.ts` and `routes/issues.ts` → `Record<string, unknown>`; the ad-hoc `values:
      any[]` SQL param arrays in `routes/issues.ts` and `routes/templates.ts` → `Array<string | number>`
      / `string[]` / `Array<string | null>`; `routes/settings.ts`'s LDAP body casts → destructure
      `bindPassword` out instead of `delete (value as any).bindPassword`, and typed the test-route body
      as `Partial<LdapConfig> & { username?: string; password?: string }`; `services/ldap.ts`'s
      `(entry as any).attributes` → removed entirely, `@types/ldapjs`'s `SearchEntry.attributes` was
      already typed, the cast was unnecessary; `services/integrations.ts` — full rewrite with real
      `SyncIntegration`/`GithubIssue`/`JiraSearchResponse`/`LinearResponse` interfaces replacing all 9
      `any` sites. One incidental type error surfaced and fixed: `routes/templates.ts`'s `:id` route
      param is typed `string | string[]` by Express (`ParamsDictionary`) — added `req.params as { id:
      string }`. Verified: server `no-explicit-any` count 0, `tsc --noEmit` clean, 247/247 tests pass.
- [x] **Client** — `lib/api.ts`: `filter_json`/`config`/`body`/`details` fields went from `any` to
      `Record<string, unknown>` / `unknown`; added a proper `TemplateBody` type (`{ title?, description?,
      content?, tags?, steps? }`) instead of a blanket `Record<string, unknown>` for `Template.body`,
      since three unrelated call sites (`Settings.tsx`, `NewIssueModal.tsx`, `Runbooks.tsx`) read
      `.title`/`.steps`/etc. off it and a fully-generic type would've broken all three — this was the
      one place a naive any→Record swap would have cascaded into ~15 new type errors, caught by
      re-running `tsc` after each file. `lib/api.test.ts`'s 3 mocked-fetch `as any` → `as unknown as
      Response`. Component-level casts replaced with real unions already available in scope:
      `IssuesList.tsx` → `Issue['status']`, `MembersTab.tsx` → `'admin'|'member'|'viewer'`,
      `NotificationsPanel.tsx`'s `onNavigate` → narrowed to the two routes it actually calls
      (`'issues'|'projects'`), `GlobalSearch.tsx`'s `history` state → the already-exported
      `SearchHistoryEntry[]`, `Runbooks.tsx`'s `tempSteps` → a concrete draft-step shape (needed an
      `s.instruction || ''` fallback in the submit mapper once the field became optional),
      `Settings.tsx` (5 sites) → `Integration['provider']`, the template `type` union, and
      `Record<string, unknown>` for the dynamic template-body-builder, plus gave `newIntegration.config`
      its own `{ baseUrl?, email? }` shape instead of `Record<string, unknown>` (reading `.baseUrl`/
      `.email` off an index-signature type doesn't narrow the same way). Verified: client
      `no-explicit-any` count 0, `tsc --noEmit` clean, 3/3 tests pass.

### Silent-catch cleanup (resolved 2026-07-17)

- [x] **`server/routes/antigravity-projects.ts:96` and `claude-projects.ts:96`** — the SSE task-watch
      endpoints' catch couldn't put the error in the response body (SSE headers already flushed
      earlier in the same try block, unlike every other route in these files which returns
      `res.status(500).json({ error: (err as Error).message })`), so the error had nowhere to go — added
      `console.error(...)` so it's at least visible server-side, and guarded the fallback response with
      `if (!res.headersSent)` since calling `res.status(500).end()` after SSE headers are already sent
      would itself throw (`ERR_HTTP_HEADERS_SENT`) — a real latent bug sitting right next to the lint
      issue, fixed in passing since it was a one-line guard on the exact line being touched.
- [x] **`server/services/notifier.ts:67`** — `JSON.parse(stdout)` failures from the Python Apprise
      subprocess were swallowed into a generic `Invalid JSON output: ...` result with no server log;
      added `console.error('Failed to parse apprise_client.py output:', err)` alongside the existing
      resolve, so a malformed-output bug in the Python side is actually visible in server logs instead
      of just failing silently in the notification-status table.
- [x] **`client/src/components/FilterBar.tsx:151,164`** — save/delete filter preset catches showed a
      hardcoded generic toast (`'Failed to save filter preset'` / `'Failed to delete preset'`) instead
      of the real server error, inconsistent with the rest of the client (60 other catch blocks across
      11 files use `toast((err as Error).message, 'error')` to surface the actual `request()`-thrown
      message). Switched both to match that convention.
- [x] **`client/src/components/NotificationsPanel.tsx:67`** — the 30s background-poll catch is
      intentionally silent (comment: "ignore errors on background fetch") — a toast here would fire
      every 30s while offline, which is worse than silence. Removed the unused `err` binding entirely
      (`catch {`) rather than logging, since this one really is meant to be silent.
      Verified: `no-unused-vars` gone from both lint runs, `tsc --noEmit` clean on both sides, server
      247/247 and client 3/3 tests still passing.

### Small mechanical fixes (resolved 2026-07-17)

- [x] `prefer-const`: `server/routes/documents.ts:303` (`tempPath`) and
      `server/services/tasks-watcher.ts:133` (`debounceTimers`) — both only ever mutated via methods
      (`.set`/`.delete`) or read, never reassigned; switched `let` → `const`.
- [x] `no-namespace`: `server/middleware/auth.ts:16` — this is a false positive, not a real issue:
      `declare global { namespace Express { interface Request { user?: AuthUser } } }` is the standard,
      required TypeScript pattern for augmenting Express's `Request` type — there's no ES2015-module
      equivalent for ambient global namespace merging. Added a targeted
      `eslint-disable-next-line @typescript-eslint/no-namespace` with a one-line comment explaining why,
      instead of restructuring code that can't actually be restructured.
- [x] Unused eslint-disable directives: `server/routes/export.ts:4`, `server/services/backup.ts:5` —
      both wrapped a `require('archiver')` call via a local `createRequire()`-produced `require`, not
      the global Node `require` the `@typescript-eslint/no-require-imports` rule actually targets — the
      rule doesn't fire on it (confirmed by the "unused directive" warning), so the disable comments
      were dead weight. Removed both.
- [x] `no-unused-expressions`: `client/src/components/projects/SessionsTab.tsx:258` — confirmed a false
      positive (logic was already correct, mutating the `Set` in place), rewrote
      `next.has(id) ? next.delete(id) : next.add(id)` as an explicit `if/else` for clarity, which also
      satisfies the rule naturally without a suppression comment.
      Verified: server lint now **0 errors / 57 warnings** (all remaining are the pre-existing
      `no-non-null-assertion` warnings, untouched — a separate style question, not part of this pass),
      client lint **0 errors / 53 warnings** (all remaining are the React Compiler-readiness rules
      already downgraded to warn earlier in this cleanup). `tsc --noEmit` clean and full test suite
      green (247/247 server, 3/3 client) on both sides.

---

## v1.x Backlog — External Notification Senders (shipped 2026-07-17)

> Integrations in other personal projects that push notifications to DevBrain's `/api/notify` endpoint (built in Phase 28.5, now archived). Not blocking any release.

- [x] **Apprise URL config fully replaces `.env` vars** — removed the `TELEGRAM_BOT_TOKEN`/
      `TELEGRAM_CHAT_ID` env-var fallback from `server/services/notifier.ts` and
      `server/scripts/apprise_client.py`; it was leftover from before Settings → Notification Hub's
      Apprise channel CRUD (+ built-in Telegram quick-form) existed, and only added a silent,
      undocumented-in-UI code path. Apprise channel config in the DB is now the one way to set up
      external delivery — zero `.env` setup needed. Updated README and the Settings empty-state copy
      to match.
- [x] **FlowForge pipeline completion → POST to `/api/notify`** — new `FLOWFORGE_DEVBRAIN_NOTIFY_URL`
      env var (off by default) in `flowforge/engine/runner.py`; `_notify_devbrain()` fires once per run
      (success or failure) right after `audit.log_pipeline_run`, alongside the existing
      `on_failure_webhook_url` (which is per-pipeline-configured and failure-only, not a global
      completion hook). 5 new tests in `tests/test_runner.py`; full FlowForge suite 1981 passed / 2
      skipped.
- [x] **Memex re-index completion → POST to `/api/notify`** — new `DEVBRAIN_NOTIFY_URL` env var (off by
      default) in `server/src/services/itemService.ts`; `notifyDevBrain()` fires from
      `reprocessBulkItems()`'s background completion block with succeeded/failed counts
      (`success`/`warning` level). New `itemService.test.ts` (4 tests, since none existed for this
      service before); full Memex suite 240/240, typecheck clean.
- [x] **PlayCru Firebase deploy success → POST to `/api/notify`** — deploys here are entirely
      manual/local (no CI pipeline runs `firebase deploy`), so a new local wrapper script,
      `scripts/deploy-and-notify.ps1`, in both `playcru/` (functions + firestore rules/indexes) and
      `playcru-web/` (hosting) runs the real `firebase deploy`, then POSTs success or failure to
      DevBrain if `DEVBRAIN_NOTIFY_URL` is set — a no-op passthrough otherwise. Verified end-to-end
      (success, failure, and no-URL-configured paths) against a stubbed `firebase` CLI and a local
      HTTP listener, without ever invoking a real deploy. **Note:** `playcru-web/` has no git repo at
      all (checked — no `.git` anywhere under `PlayCru/` except inside `playcru/`), so that script sits
      on disk uncommitted; only the `playcru/` copy + its `CLAUDE.md` doc note are committed.

---

## v1.x Backlog — Code Documentation Enhancements (research: 2026-07-16)

> Follow-up to the Codes tab + Explain/Save-as-document + entity linking work shipped this session.
> Evaluated 4 user-supplied repos (RepoAgent, DeepWiki-Open, code2docs, auto-github-docs-generator) plus
> self-sourced candidates. Verdict: **none are worth vendoring or running as a dependency** — wrong
> language coverage, wrong architecture (full separate app vs. our single-file model), or too
> immature/stale. What follows are the specific *ideas* worth building natively, using infra we already
> have (Ollama chat/embed, `document_chunks`, `content_hash`, `entity_links`), ranked by priority.

### Must Have

- [x] **Language-aware code chunking via tree-sitter** (shipped 2026-07-16) — `embedder.ts` now chunks
      code files at function/class/method boundaries via `web-tree-sitter` instead of blind token
      windows, for the 16 languages with a prebuilt grammar available (typescript, javascript, python,
      dart, java, kotlin, go, rust, ruby, php, swift, c, cpp, csharp, bash, vue — via `tree-sitter-wasms`).
      Unsupported languages (powershell, svelte, perl, sql, plsql) and any parse error fall back to the
      pre-existing generic token-window chunker automatically — same degrade-gracefully pattern as the
      MarkItDown/JS-fallback in `parser.ts`. New files: `server/services/codeChunker.ts` (chunking logic),
      `server/services/tokenChunker.ts` (tokenizer + window-splitter, extracted out of `embedder.ts` so
      the two don't import each other). 12 new tests, verified live against real files (own `embedder.ts`
      source produced clean function-level chunks, with the token-window fallback correctly kicking in
      mid-function for one function too large to split further).
      **Gotcha hit during implementation, now pinned in `package.json`**: `web-tree-sitter` and
      `tree-sitter-wasms` are pinned to **exact** versions (`0.25.10` / `0.1.13`, no `^` range).
      `web-tree-sitter@0.26+` changed the expected wasm module format (requires a "dylink" metadata
      section); `tree-sitter-wasms@0.1.13`'s prebuilt grammars predate that and fail to load under it
      (`getDylinkMetadata` error) even though both packages still import/typecheck fine together — the
      failure is silent (chunker just returns null and falls back) unless you go looking. Do not bump
      either package without confirming a newer `tree-sitter-wasms` release is compatible first.
      Reference: `tree-sitter/tree-sitter` (26k★, MIT, actively maintained) — the parsing engine RepoAgent
      and Aider both build on. Not vendoring RepoAgent itself (Python-only via `ast`, stale since Dec
      2024) — just using the same underlying parser library, directly from Node via `web-tree-sitter`.
- [x] **Doc staleness detection** (shipped 2026-07-16) — new `documents.explanation_hash` column stamps
      the `content_hash` an explanation was generated against; `explanation_stale` (computed: explanation
      set + hash mismatch) is now returned by `GET /:id`, `GET /` (list), and the new update-content route.
      Turned out content_hash could never actually change on an existing row before this — the only path
      was uploading a *new* document — so this also had to add **`POST /:id/update-content`** (replace an
      existing tracked file's content/hash/language/file_type in place, re-embeds with the new AST
      chunker, leaves the old explanation untouched so it shows as stale instead of vanishing). Codes tab:
      an "Update file" button in the preview footer, and an amber "content changed — consider
      regenerating" banner + a ⚠ badge in the list row when `explanation_stale`. Also fixed in passing:
      the documents list query never selected `embedding_status` at all (status dot always showed
      pending) — one-line fix in the same query. 19 new/updated tests; full suite 198/198. Verified live:
      explain → not stale → update-content → **immediately** stale (no reopen needed) → re-explain → not
      stale again.
      Idea borrowed from RepoAgent's core differentiator (git-diff-aware doc regeneration) — reimplemented
      natively via the hash column we already have, no external tool needed.
- [x] **AI-generated architecture diagrams (Mermaid)** (shipped 2026-07-16) — new sibling "Diagram"
      action next to "Explain with AI" in the Codes preview panel: `POST /:id/diagram` asks the model for
      a Mermaid flowchart of the file's functions/classes and how they call each other, defensively
      strips a ```mermaid fence if the model adds one anyway, and persists it (`documents.diagram` +
      `diagram_hash`, same staleness pattern as explanation — `diagram_stale` flows through GET /:id,
      GET / list, and update-content). Rendered client-side via `mermaid` (MIT, v11.16.0) in new
      `client/src/components/MermaidDiagram.tsx`, with a parse/render-failure fallback (shows the raw
      definition instead of crashing, since the content is AI-generated and occasionally invalid).
      **Caught during build**: a naive static `import mermaid from 'mermaid'` added ~640KB (gzip 155KB)
      to the *main* app bundle for every user, even ones who never open a diagram — switched to a lazy
      `import('mermaid')` inside the component so it only loads on first actual diagram render; confirmed
      via build output that it now lands in its own separate chunk and the main bundle size is back to
      baseline. 9 new backend tests; full suite 204/204. Verified live end-to-end including in a real
      headless browser (Playwright): generated a diagram from a real class, confirmed real SVG output
      with correct node labels, zero console errors, regenerate flow, and the stale banner.
      Also fixed in passing (found via the live browser check, visibly broken in the screenshot): `GET
      /api/documents/:id` never selected `content_length` or `chunk_count` at all — only the list query
      computed them — so every Documents/Codes detail panel showed "NaN M" for file size and `undefined`
      for chunk count. Same query already being edited for the staleness fields above.
      This is the one genuinely new capability DeepWiki-Open has that we don't; the diagram *generation*
      is just another `aiChat` prompt using infra we already have, and Claude's own Artifacts already
      render Mermaid natively, so the rendering approach is well-precedented.

### Good to Have

- [x] **Multi-file / component-level overview doc** (shipped 2026-07-17) — new **Component overview**
      button on the Codes page opens a modal to pick a tagged `component` and generate one combined
      architecture doc from every code file in it, instead of one file at a time. New
      **`POST /api/documents/component-overview`** builds the prompt from each file's compact signature
      outline (`extractSymbolOutline`, reusing the tree-sitter chunker from the Must Have above) rather
      than dumping full file text — "rank symbols, don't dump everything", the design idea borrowed from
      Aider's `repomap.py` (`Aider-AI/aider`, 47k★, Apache-2.0; not vendored, just the pattern). Falls back
      to a truncated excerpt for languages without a grammar. Idempotent per `(project_id, component)` via
      new `documents.source_component` column (migration: `add_source_component.ts`) — regenerating
      updates the same doc instead of creating duplicates, mirroring how `source_document_id` already
      works for single-file "Save as document". Capped at 30 files per component to bound prompt size.
      **Gotcha hit during implementation**: combining several files' outlines into one prompt pushed
      `aiChat()`'s non-streaming request past the existing 30s timeout on this 7B model / 6GB laptop GPU —
      bumped to 120s (`server/services/ai.ts`) to match the streaming path's existing timeout. New tests
      in `documents_component_overview.test.ts`; full suite 219/219, server + client typecheck clean.
- [x] **Links Graph View** (shipped 2026-07-16) — new **Graph** nav item (`/graph`), a force-directed
      visualization of the whole `entity_links` graph, as a companion to the chip-list view. New
      `GET /api/links/graph` returns every link plus a resolved descriptor for every distinct node
      touched (batched per type, same pattern as the single-entity endpoint), no pagination — fine at
      personal-tool scale. Client renders it with `d3-force` (physics only, ISC license) driving a
      hand-rolled SVG (not a full graph library) — dragging is plain React mouse events mutating the
      simulation's node objects directly rather than `d3-drag`/`d3-selection`, which avoids the classic
      "React re-render fights D3's direct DOM writes" footgun; click-vs-drag is disambiguated by a 3px
      movement threshold. Clicking a node navigates cross-page via the same `?open=<id>` convention as
      Linked Items. `d3-force` (and its type defs) turned out to already be transitive dependencies of
      `mermaid` (which depends on the full `d3` bundle) — confirmed **zero net bundle cost**; removed
      `d3-drag`/`d3-selection` from package.json since the manual-drag approach never used them directly.
      12 new backend tests; full suite 207/207. Verified live in a real headless browser: 3 nodes / 2
      edges rendered with correct colors/icons/legend, drag repositioned nodes and physics resettled
      them, a plain click (no drag) correctly navigated to `/issues?open=<id>`, cascade-delete on the
      underlying entities correctly emptied the graph back out, zero console errors throughout.
      UX reference only (not code): `foambubble/foam` (17k★, TypeScript, VS Code Zettelkasten extension)
      and `logseq/logseq` (44k★, AGPL-3.0 — reference for UX ideas only, never copy code from it).
- [x] **Duplicate code file detection** (shipped 2026-07-17, user-requested) — new **Find duplicates**
      button on the Codes page opens a modal that scans code files (scoped to the selected project, or
      all projects if none selected) for near-duplicates — "same file, renamed, with a few edited
      lines," not just byte-identical copies. Two-phase per user's chosen design: phase 1 shortlists
      candidate pairs cheaply via the per-document summary embeddings every code file already gets on
      embed (`document_chunks` `chunk_index = -1` sentinel row) — a pgvector cosine self-join, zero
      extra AI calls; phase 2 scores each shortlisted pair with a new deterministic line-similarity
      ratio (`server/services/duplicateDetector.ts` — Sørensen–Dice coefficient over normalized line
      multisets, order-insensitive but multiset-aware) and keeps pairs ≥ 0.5. New
      **`POST /api/documents/find-duplicates`**. Files that failed summarization (no summary embedding)
      skip phase 1 and are compared directly against every other file in scope, so a missing embedding
      can never silently hide a duplicate — verified by a dedicated test. Modal shows each pair with a
      similarity % and color-coded band (near-identical / likely duplicate / similar), lets you open
      either file (closes the modal, same `?open=<id>` convention as the rest of Codes) or remove one
      directly. 11 unit tests for the Dice-similarity function + 7 route tests; full suite 247/247,
      server + client typecheck clean. Verified live in a real headless browser end-to-end: uploaded a
      near-duplicate pair (one changed line out of 8) plus an unrelated control file, ran the scan,
      confirmed the exact expected 88% score (7/8 shared lines) on the true pair only — the unrelated
      file correctly excluded — clicked a result to confirm it opens the right document, clicked Remove
      and confirmed via direct DB query the file was actually deleted, zero console errors from the
      feature itself (one pre-existing unrelated 401 on `/api/projects` during the login race, nothing
      to do with this endpoint).

### Considered, not recommended

- **RepoAgent** (`OpenBMB/RepoAgent`, 1k★, Apache-2.0) — Python-only (`ast` module), so it would only
  ever cover a fraction of what the Codes tab already tracks (TS, Dart, Go, PL/SQL, Perl, etc.); stale
  since Dec 2024.
- **DeepWiki-Open** (`AsyncFuncAI/deepwiki-open`, 17k★, MIT, very active) — full separate Next.js +
  FastAPI app that clones a whole git repo and builds a hosted wiki site; would duplicate the RAG/embed/
  chat stack we already built, and works against a cloned repo rather than files a user uploads one at a
  time, which doesn't match how Codes is actually used here.
- **code2docs** (`semcod/code2docs`) — 0 stars, created 2026-03, single maintainer, depends on an
  unpublished-looking sibling library (`code2llm`). Too immature/unproven.
- **auto-github-docs-generator** (`microsoft/auto-github-docs-generator`) — abandoned since 2023
  (internal hackathon project), a Jupyter notebook rather than a library, hard-wired to an Azure ML
  PromptFlow endpoint.
- **LiteLLM** (`BerriAI/litellm`, 54k★) — Python-only proxy server; DevBrain's server is Node/TypeScript
  and `services/ai.ts` already does provider switching (Ollama/Claude/Gemini) in ~100 lines with zero
  extra infrastructure. Running LiteLLM would mean standing up a second service to replace something
  that already works simply — not worth the added moving part at this project's scale.

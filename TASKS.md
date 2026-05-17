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
- [x] Multi-user auth — role-based: viewer / editor / admin per project; `users` + `project_members` tables; backward-compatible JWT migration; first-run auto-creates admin from AUTH_PASSWORD
- [x] LDAP/SSO integration — optional, env-var driven (`LDAP_URL` etc.); dynamic import of ldapjs (graceful no-op if not installed); binds as user to verify password
- [x] Shared command library — personal namespace + team namespace per command; filter chips (👥 Team / 🔒 Personal) in sidebar; namespace field in create modal; personal badge on card; server filters by namespace + user
- [x] Audit log — `audit_events` table; `logAudit()` non-fatal service; all user/project mutations logged; `GET /api/audit` (admin only) with filters; AuditLog component in Settings (admin only, paginated)

---

## Phase 13 — Security Hardening ⚠ (review-flagged critical)
> Baseline review score: **3/10**. None of these are optional if more than one person uses this app.

### Authentication & Token Security
- [ ] Rate-limit `/api/auth/login` — `express-rate-limit`: max 10 attempts per 15 min per IP; return 429 with `Retry-After` header
- [ ] Remove legacy token admin fallback — tokens missing `userId` must return 401, not grant admin; force re-login
- [ ] Add `iss` and `aud` claims to JWT signing and verification — prevents tokens from other services being accepted
- [ ] Move JWT from localStorage to HttpOnly cookie — eliminates XSS token theft; update `requireAuth` to read from cookie; keep `Authorization` header as fallback for API clients
- [ ] Fix timing attack on login — run `bcrypt.compare` even when user is not found (compare against a dummy hash) so response time doesn't leak username existence

### Authorization & Audit
- [ ] Audit log: add `logAudit()` to `POST /api/auth/change-password` — password changes must be visible in audit trail
- [ ] Admin password reset confirmation — require admin to re-enter their own password before resetting another user's; add `logAudit()` with `action: 'update'` on the affected user
- [ ] Add HTTPS enforcement option — env var `FORCE_HTTPS=true` adds HSTS header + HTTP→HTTPS redirect middleware; document in `.env.example`

### Input & SQL Safety
- [ ] Replace `Object.keys(updates)` with explicit column allowlists in all dynamic `PUT`/`PATCH` handlers — `commands.ts`, `documents.ts`, `issues.ts`, `users.ts`; use a `const UPDATABLE_COLS = new Set([...])` guard before building the `SET` clause
- [ ] Fix manual SQL parameter index counting — replace `let idx = N; idx++` pattern with a `buildUpdate(cols, vals)` helper that returns `{ setClauses, params }` safely
- [ ] SSRF protection on URL document import — validate that the resolved host is not a private/loopback IP (`10.x`, `192.168.x`, `172.16–31.x`, `127.x`, `::1`) before fetching; return 422 with clear error

### Infrastructure Secrets
- [ ] Move Docker Compose credentials to env file — replace hardcoded `POSTGRES_PASSWORD: devbrain` and `JWT_SECRET` with `${POSTGRES_PASSWORD}` references; add `.env.docker` to `.env.example`; update setup guide
- [ ] Add resource limits to Docker Compose — `mem_limit` and `cpus` on postgres and app containers to prevent runaway queries from crashing the host

---

## Phase 14 — Architecture & Code Quality (review-flagged)
> Baseline review scores: Architecture **5/10**, Code **5/10**. Structural debt that compounds with every feature added.

### Routing — Replace Custom Event System with React Router
- [ ] Install `react-router-dom` v6 — wrap `App` in `<BrowserRouter>`
- [ ] Map all current routes to URL paths: `/`, `/projects`, `/documents`, `/chat`, `/issues`, `/commands`, `/releases`, `/runbooks`, `/tasks`, `/settings`
- [ ] Add project scoping to URLs: `/projects/:projectId/issues`, `/projects/:projectId/commands`, etc.
- [ ] Replace `window.dispatchEvent('devbrain:navigate')` with `useNavigate()` — remove all custom event listeners from `App.tsx`
- [ ] Replace `window.dispatchEvent('devbrain:open-issue')` with URL param: `/issues?open=:id`
- [ ] Persist selected project in URL (`?project=:id`) so refresh and browser history work correctly
- [ ] Add `<Link>` on all clickable cards (issue rows, command cards, release cards) — enables Ctrl+click to open in new tab

### Schema — Single Source of Truth
- [ ] Consolidate all migrations into `schema.sql` — fold `migrate-org-v2.mjs`, `migrate-releases.mjs`, `migrate-runbooks.mjs`, `migrate-tasks-devbrain.mjs` into the canonical schema; a fresh `psql < schema.sql` must produce the same DB as a fully migrated one
- [ ] Add `updated_at TIMESTAMPTZ` column to all tables (`documents`, `issues`, `commands`, `releases`, `runbooks`, `projects`) — needed for conflict detection and activity feeds
- [ ] Write `db/setup.ts` — single idempotent setup script that runs `schema.sql` + seeds; replaces the current multi-script setup dance

### Data Integrity — Fix JSONB Race Conditions
- [ ] Normalize `investigation_steps` into a `issue_steps` table (`id`, `issue_id`, `order`, `instruction`, `done`, `created_at`) — replace all JSONB read-modify-write with `INSERT`/`UPDATE`/`DELETE` on rows; eliminates concurrent-write data loss
- [ ] Normalize `notes` into an `issue_notes` table (`id`, `issue_id`, `content`, `created_at`) — same reasoning; adds ability to query/search notes independently
- [ ] Update `server/routes/issues.ts` to use new tables; update `client/src/lib/api.ts` types; update Issues.tsx rendering

### Reliability — Embeddings & AI
- [ ] Add `AbortController` with 30s timeout to all Ollama `fetch()` calls in `services/ai.ts` — prevents connection pool starvation on hung Ollama process
- [ ] Replace fire-and-forget embed calls with tracked async — store `embedding_status: 'pending' | 'done' | 'failed'` column on `documents` and `issues`; retry failed embeddings on next request; surface status in UI (small indicator dot)
- [ ] Add embedding retry endpoint `POST /api/documents/:id/reembed` and `POST /api/issues/:id/reembed` — allows manual repair of failed embeddings without re-uploading

### Code Quality
- [ ] Split `Issues.tsx` (1,318 lines) into: `IssuesList.tsx`, `IssueDetail.tsx`, `NewIssueModal.tsx`, `IssueSteps.tsx`, `IssueNotes.tsx` — each under 300 lines
- [ ] Replace manual SQL parameter index counting (`let idx = 2; idx++`) with a `buildWhereClause(filters)` utility that returns `{ where, params }` — used in issues, commands, documents list routes
- [ ] Add `useCallback` + `useMemo` to `IssuesList` and `CommandsPage` — memoize filter/sort computations and stable callbacks passed to child components
- [ ] Add `AbortController` to debounced search inputs — cancel in-flight request when a new one starts; prevents stale response overwriting fresh results
- [ ] Add drag-and-drop bounds validation in `IssueDetail` — guard `splice(fromIdx, 1)` with `fromIdx >= 0 && fromIdx < steps.length`
- [ ] Add `<ErrorBoundary>` around each route in `App.tsx` — catches component crashes; shows "Something went wrong" with a reload button instead of blank white screen

### Search & Pagination
- [ ] Make search result limit configurable — replace hardcoded `const PAGE = 5` in `routes/search.ts` with `?limit=N` query param (default 10, max 50); add "load more" to the ⌘K global search results
- [ ] Add request deduplication in `client/src/lib/api.ts` — use an in-flight map keyed by URL+method; return the same promise for identical concurrent requests; cancel on component unmount via `AbortController`

---

## Phase 15 — Design, Accessibility & Usability (review-flagged)
> Baseline review scores: Design **6/10**, UI **4/10**, Usability **6/10**.

### Accessibility (A11y)
- [ ] Add `aria-label` to all icon-only buttons (star/favorite toggle, delete, close ✕, mark-used ✓) — required for screen readers
- [ ] Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to all modals — trap focus within modal on open; restore focus on close
- [ ] Fix `cursor: 'default'` on all `<button>` elements — change to `cursor: 'pointer'` globally; only input-like buttons (disabled state) should be `default`
- [ ] Add `tabIndex` and `onKeyDown` to all interactive card rows (IssueRow, CommandCard, RunbookCard) — keyboard users should be able to navigate and activate with Enter/Space
- [ ] Add visible focus ring — `outline: '2px solid var(--accent)'` on `:focus-visible` for all interactive elements; currently focus is invisible

### Responsive Layout
- [ ] Make sidebar panels resizable — replace hardcoded `width: 300` with a drag-handle that saves width to localStorage; min 200px, max 500px
- [ ] Add responsive breakpoint at 900px — collapse left panel into a toggleable drawer (hamburger icon in header); panels stack vertically below 900px
- [ ] Add mobile viewport meta tag and basic touch targets — `min-height: 44px` on all interactive elements per WCAG 2.5.5

### URL-Driven State & Deep Links
> Depends on Phase 14 React Router work
- [ ] Ensure every entity has a canonical URL — `/issues/:id`, `/commands/:id`, `/documents/:id`, `/runbooks/:id`
- [ ] Add "Copy link" button on issue detail, command detail, runbook detail — copies canonical URL to clipboard
- [ ] Restore last-visited route and project on page load from URL, not just localStorage

### Design System Migration
- [ ] Extract design tokens to `client/src/styles/tokens.css` CSS custom properties — consolidate all `var(--bg)`, `var(--accent)` etc. into one file; remove duplicate declarations across components
- [ ] Create shared style constants file `client/src/styles/shared.ts` — export reusable style objects (`cardStyle`, `inputStyle`, `labelStyle`, `badgeStyle`) imported by all pages; reduces inline style duplication
- [ ] Add enter/exit animations to modals — 150ms `opacity` + `transform: scale(0.97 → 1)` on open; makes transitions feel intentional rather than abrupt

### Usability Improvements
- [ ] Add runbook print/export view — `?print=1` URL param renders a clean, printer-friendly single-page view with no nav chrome; link in runbook detail header
- [ ] Increase ⌘K search to show 10 results by default + "show more" — current 5-result cap hides relevant results in larger knowledge bases
- [ ] Add onboarding empty states — when a section has 0 items, show an illustrated empty state with a single CTA ("Create your first issue", "Upload a document") instead of just "No items"
- [ ] Add "recently viewed" trail — track last 10 visited entities (issue/command/doc) in localStorage; show as a quick-access list on the Dashboard and in ⌘K results when query is empty
- [ ] Add keyboard shortcuts for primary actions — `N` for new (contextual: new issue on Issues page, new command on Commands page), `E` to edit selected item, `Backspace` on selected item to delete with confirm

---

## Phase 12 — Integrations & Platform Expansion

### Git Integration
- [ ] `POST /api/projects/:id/repo` — store repo URL + optional GitHub PAT (encrypted in DB)
- [ ] `GET /api/projects/:id/commits` — fetch recent commits via GitHub API (`/repos/:owner/:repo/commits`)
- [ ] Commit list widget on per-project dashboard — SHA, message, author, date; link to GitHub
- [ ] "Link commit" action on issue detail — attach a commit SHA to an issue (`linked_commits TEXT[]`)
- [ ] `POST /api/issues/:id/commits` — append SHA; show linked commits as chips in issue detail
- [ ] PR link support — store PR URL on issue; open in browser on click
- [ ] Release auto-populate — "Import from GitHub" on new release modal: fetches commits between two tags via API, pre-fills AI generate panel

### Jira / Linear Sync
- [ ] Settings: Jira config section — Jira base URL, email, API token (stored in DB settings table, never in env)
- [ ] Settings: Linear config section — Linear API key
- [ ] `POST /api/issues/import/jira` — fetch issues from a Jira project (JQL query), map to DevBrain issues (title, description, priority, status)
- [ ] `POST /api/issues/import/linear` — fetch issues from a Linear team, same mapping
- [ ] Import modal in Issues page — select source (Jira / Linear), enter project/team key, preview list, confirm import
- [ ] Bi-directional status sync (stretch) — webhook receiver updates DevBrain issue status when Jira/Linear status changes

### Progressive Web App (PWA / Offline)
- [ ] Add Vite PWA plugin (`vite-plugin-pwa`) — generates service worker + manifest
- [ ] Cache shell + static assets in service worker (cache-first strategy)
- [ ] Offline fallback page — show cached data with "You're offline" banner, disable write actions
- [ ] App manifest — name, icons (192/512px), theme color `#0A0A0F`, display standalone
- [ ] "Install app" prompt — intercept `beforeinstallprompt`, show install button in Settings or nav

### Cloud / Multi-Device Hosting
- [ ] Docker Compose production profile — Caddy reverse proxy, auto-TLS, environment-based secrets
- [ ] `docker-compose.prod.yml` — remove volume mounts for source, use built image, add Caddy service
- [ ] One-command deploy script (`deploy.sh`) — pulls latest, rebuilds app image, restarts services
- [ ] Health check endpoint already live (`/api/health`) — wire into Caddy upstream health check
- [ ] Backup cron — daily `pg_dump` to local file + optional S3 upload (AWS_S3_BUCKET env var)
- [ ] Restore script — `restore.sh` accepts dump file, stops app, restores DB, restarts

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically; nomic is tiny (~300MB) so co-exists fine |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |

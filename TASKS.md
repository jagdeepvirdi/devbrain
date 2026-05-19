# TASKS.md — DevBrain (Work Knowledge Base)

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically; nomic is tiny (~300MB) so co-exists fine |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |

---

# V2 Roadmap

> Phases ordered by priority: fix existing gaps first, build the safety net, protect data, then grow features.
> Fix → Test → Backup → Visibility → AI → Git → Integrations → Multi-user.

---

## Phase 19 — Hardening & Quick Wins

> Ten concrete gaps found in the post-Phase-18 review. No new features — fix what's already broken or insecure. Highest score-per-effort of any phase.

### Security
- [ ] **Complete localStorage → HttpOnly cookie migration on the client** (`client/src/lib/api.ts:10-13`) — Phase 13 added the HttpOnly cookie server-side but the client still reads `localStorage.getItem('devbrain_token')` and sends it as `Authorization: Bearer`. XSS can still steal the token. Remove `getToken()`/`setToken()` localStorage calls; rely solely on the cookie the server sets. Update `authApi.login()` to stop writing to localStorage. Audit all `getToken()` call sites.
- [ ] **Sanitize 500 error responses in production** (`server/routes/auth.ts:193`, `server/routes/documents.ts:251,267`) — `res.status(500).json({ error: (err as Error).message })` leaks raw PostgreSQL error messages. Add a central Express error-handler middleware: log full error server-side; return `{ error: 'Internal server error' }` when `NODE_ENV=production`, full message in dev only.
- [ ] **Add Zod to `change-password` route** (`server/routes/auth.ts:225`) — the only mutation route still using a raw `req.body as { ... }` cast. Add a `ChangePasswordBody` Zod schema consistent with every other route.
- [ ] **Rate-limit mutation and AI endpoints** — add a second `express-rate-limit` instance (60 req/min per IP) on `POST /api/documents`, `POST /api/chat`, `POST /api/issues/:id/summarize`, `POST /api/commands/:id/explain`. Prevents authenticated users from hammering Ollama or the DB.

### Reliability
- [ ] **Wrap `res.json()` in try/catch in client `api.ts`** (`client/src/lib/api.ts:33`) — server returning HTML (Caddy proxy error, cold-start race) causes `res.json()` to throw a `SyntaxError` with no user-visible feedback. Catch and throw `Error('Unexpected server response')` instead.
- [ ] **Add idle timeout to SSE streams** — `GET /api/chat` and `GET /api/claude-projects/:id/tasks/watch` hold connections open indefinitely. Add a 5-minute inactivity timeout: if no `res.write()` fires in 5 min, send `data: {"type":"timeout"}\n\n` and call `res.end()`.
- [ ] **Fix Multer temp directory for cross-platform dev** (`server/routes/documents.ts:18`) — `dest: '/tmp/devbrain-uploads'` does not exist on Windows, silently breaking file uploads in native Windows dev. Replace with `path.join(os.tmpdir(), 'devbrain-uploads')`.

### Database
- [ ] **Add indexes on `embedding_status` columns** (`server/db/schema.sql`) — `WHERE embedding_status = 'failed'` is a full table scan. Add `CREATE INDEX IF NOT EXISTS idx_documents_embedding_status ON documents (embedding_status)` and the same on `issues`.

### Code Quality
- [ ] **Audit request deduplication cache key** (`client/src/lib/api.ts:41`) — in-flight map keys on the raw `path` string. Verify every `request()` call site includes the full query string so cache hits only occur on truly identical requests. Fix any call sites that omit query params.
- [ ] **Parameterize LIMIT/OFFSET in `search.ts`** (`server/routes/search.ts:30,37,44,51,57`) — `LIMIT ${PAGE}` is safe (validated number) but violates the project rule of fully parameterized SQL. Replace with `LIMIT $N` and push `PAGE` into the params array across all five query branches.

---

## Phase 20 — E2E Testing & Quality

> Playwright E2E suite covering critical user paths. Safety net before new features land. Includes the resizable sidebar deferred from Phase 15.

### Setup
- [ ] Add `@playwright/test` to `client/devDependencies`
- [ ] Add `playwright.config.ts` — baseURL `http://localhost:5173`, Chromium only, screenshots + traces on failure, `webServer` block to auto-start dev servers
- [ ] Add `test:e2e` script to `client/package.json`; add E2E job to `.github/workflows/ci.yml` that uploads trace artifact on failure

### Test Suites
- [ ] **Auth flow** — unauthenticated visit → redirect to login; valid login → Dashboard; logout → back to login
- [ ] **Issue lifecycle** — create issue → appears in list → open detail → add note → change status to resolved → status chip updates
- [ ] **Document upload** — upload `.md` file → title appears in list → open DocChat → ask question → SSE response streams in
- [ ] **Command CRUD** — create command → star favorite → search for it by title → delete → verify gone from list
- [ ] **Global search** — ⌘K → type query → results appear across multiple entity types

### Deferred UX (resizable sidebar from Phase 15)
- [ ] Resizable sidebar — drag handle on right edge of sidebar; width persisted to `localStorage`; clamp between 180px and 420px; double-click handle to reset to default

---

## Phase 21 — Export & Backup

> Protect existing data before building more on top. Full knowledge-base export to portable markdown zip, scheduled auto-backup, and import from backup.

### Export
- [ ] `GET /api/export/project/:id` — stream a `.zip` containing one `.md` per document (YAML frontmatter + content), `issues.md` (all issues + steps + notes as sections), `commands.md`, `releases.md`, `runbooks.md`
- [ ] `GET /api/export/all` — same but all projects; one subfolder per project inside the zip
- [ ] Settings: Export section — project dropdown + "Export project" button; "Export all" button; file downloads as `devbrain-export-YYYY-MM-DD.zip`

### Scheduled Backup
- [ ] Add `backup_path TEXT` and `backup_schedule TEXT` (`'daily' | 'weekly' | 'off'`) keys to `app_settings`
- [ ] Server: 24-hour `setInterval` on startup — if schedule enabled and `backup_path` exists, run export and write zip to path; log result; update `last_backup_at` in `app_settings`
- [ ] Settings: backup path input + schedule dropdown + "Backup now" button + last backup timestamp display

### Import
- [ ] `POST /api/import` — accept zip upload; parse markdown frontmatter to reconstruct issues / documents / commands; skip duplicates by matching title + project
- [ ] Settings: Import section — zip file upload input + "Dry run" toggle (returns diff of what would be created without writing); confirmation step before live import

---

## Phase 22 — Dashboard & Analytics

> Insight widgets that surface value from all the data already in the DB. CSS-only bar/grid charts — no chart library dependency.

### New API Endpoints
- [ ] `GET /api/dashboard/stats` — open issue count per project, avg resolution time (days) per project, doc count, embedding failure count, commands added this week
- [ ] `GET /api/dashboard/activity` — daily event counts (issues opened, issues resolved, docs added, commands added) for last 30 days; keyed by date string

### Widgets
- [ ] **Open Issues by Project** — horizontal bar chart; one bar per project, colored with project color, value label on right
- [ ] **Avg Resolution Time** — bar chart; days per project for last 30 days; "No data" state when no resolved issues
- [ ] **Activity Heatmap** — 5-week × 7-day grid (GitHub contribution style); cells shaded by total event count; tooltip on hover shows date + count
- [ ] **Embedding Health** — three labeled counts (done / pending / failed) with colored dots; "Retry all failed" button calls existing `POST /api/documents/:id/reembed` for each failed doc
- [ ] **Stale Issues** — issues open > 14 days with no note in that period; listed with priority badge + one-click "Mark investigating" action

### Layout
- [ ] Dashboard: 2-column widget grid on screens ≥ 1100px; single column below
- [ ] Each widget: header with title + refresh icon; React Query `refetchInterval: 300_000` (5 min)

---

## Phase 23 — AI Enhancements

> Expand local AI capabilities using existing `services/ai.ts` infrastructure. `gemma3:4b` for fast classification, `mistral:7b` for generation. All local, zero cost.

### Auto-tagging
- [ ] On document upload: call `gemma3:4b` with title + first 500 chars → suggest up to 5 tags; show as dismissable "Suggested" chips in the upload form before save
- [ ] On issue create: same pattern — suggest tags from title + description; chips appear below the tags input

### Command Explanation
- [ ] Add `explanation TEXT` column to `commands` table in `schema.sql`
- [ ] Add `POST /api/commands/:id/explain` — send command text to `gemma3:4b`; store + return explanation
- [ ] Command detail panel: "✦ Explain" button; explanation rendered below the code block; "Regenerate" icon to refresh

### Issue Summarization
- [ ] Add `summary TEXT` column to `issues` table in `schema.sql`
- [ ] Add `POST /api/issues/:id/summarize` — run `mistral:7b` over steps + notes → produce 3-bullet TL;DR; store in `summary` column
- [ ] Issue detail: "✦ Summarize" button; summary card rendered above steps accordion; "Regenerate" icon

### Release Note Drafting
- [ ] Add `POST /api/releases/draft` — accepts `{ projectId, from: ISO, to: ISO, issueIds?: string[] }`; fetches resolved issues in range; runs `mistral:7b` to draft Features / Fixes / Breaking Changes sections; returns a pre-filled `Release` object
- [ ] Releases page: "✦ Draft with AI" button → modal with date range picker + resolved issue multi-select → inserts draft into the new release form

### Smart Search Suggestions
- [ ] On empty ⌘K query: `GET /api/search/suggestions` returns up to 5 suggestions ranked by `updated_at` from recent issue titles and document names
- [ ] GlobalSearch: show suggestions list when query is empty instead of blank state

---

## Phase 24 — Git Integration

> Read-only git integration scoped to linked projects. Surfaces commit history, branches, and commit↔issue linking without any external service. Shells out to `git` via `child_process` — stub route already wired in `index.ts`.

### Server
- [ ] Implement `server/routes/git.ts` handlers (stub already imported in `index.ts`):
  - `GET /api/git/:id/log` — run `git log --format="%H|%s|%an|%aI" -n 50` in project `fs_path`; return parsed commit array
  - `GET /api/git/:id/branches` — run `git branch -a --format="%(refname:short)"`; return list + current branch
  - `GET /api/git/:id/diff/:sha` — run `git show <sha> --stat --patch`; return raw diff string
- [ ] Add `issue_commits` join table to `schema.sql`: `(issue_id UUID, sha TEXT, project_id UUID, linked_at TIMESTAMPTZ)`
- [ ] Add `POST /api/git/:id/link` — link a sha to an issue (`{ sha, issueId }`)
- [ ] Add `DELETE /api/git/:id/link/:sha` — unlink a commit from an issue

### Client
- [ ] Add **Git** tab to project detail panel (only when `fs_path` is set and `git rev-parse` succeeds)
- [ ] `CommitList` component — sha chip, message, author initial avatar, relative date
- [ ] `CommitCard` expandable — `--stat` output + "Link to issue" action with issue search dropdown
- [ ] `BranchBadge` in project card header — shows current branch name
- [ ] Issue detail: linked commits shown as sha chips below description; clicking opens `CommitCard` inline
- [ ] Add `GitCommit`, `GitBranch`, `IssueCommit` types and `gitApi.*` methods to `client/src/lib/api.ts`

---

## Phase 25 — External Issue Sync (GitHub / Linear)

> One-way import of issues from GitHub and Linear. OAuth tokens stored AES-256-GCM encrypted. Stub files `crypto.ts` and `integrations.ts` already exist in server.

### Infrastructure
- [ ] `server/services/crypto.ts` (stub exists) — implement AES-256-GCM `encrypt(text)` / `decrypt(ciphertext)` using `JWT_SECRET`; used for all stored OAuth tokens
- [ ] Add `integrations` table to `schema.sql`: `(id UUID, provider TEXT, project_id UUID, external_project_id TEXT, token_enc TEXT, last_synced_at TIMESTAMPTZ, config JSONB)`
- [ ] `server/routes/integrations.ts` (stub exists) — implement handlers listed below

### GitHub Integration
- [ ] Settings: GitHub section — "Connect GitHub" → OAuth PKCE flow → exchange code → store token encrypted
- [ ] `POST /api/integrations/github/sync` — fetch open issues via GitHub REST API; upsert with `source: 'github'` + `external_id` to prevent duplicates
- [ ] Map GitHub labels → DevBrain tags; `priority:*` label → priority field; closed → `resolved`
- [ ] Settings UI: last sync timestamp + "Sync now" button per connected repo

### Linear Integration
- [ ] Settings: Linear section — API key input (stored encrypted, never returned to client)
- [ ] `POST /api/integrations/linear/sync` — fetch via Linear GraphQL API; upsert with `source: 'linear'`
- [ ] Map Linear priority (Urgent / High / Medium / Low) → DevBrain (critical / high / medium / low)

### Client
- [ ] Issue list: source badge chip (`GH` / `LN`) on imported issues
- [ ] Issue detail: "View on GitHub" / "View on Linear" link when `external_id` is present

---

## Phase 26 — Multi-user & Org Sharing

> Expand from single-user to small team use. LDAP service already in `server/services/ldap.ts`. Biggest lift in the roadmap — only tackle once the app is stable and being shared with others.

### Users & Roles
- [ ] Add `role TEXT` column (`'admin' | 'member' | 'viewer'`) to `users` table
- [ ] Enforce role in `requireAuth` middleware: viewers — GET only; members — create/edit; admins — full access including user management
- [ ] Settings: User Management section — list users with role badge; invite by email (one-time token); deactivate / reactivate; admin password reset

### LDAP Configuration
- [ ] Settings: LDAP section — host, port, base DN, bind DN, bind password (stored encrypted); "Test connection" button
- [ ] On login: if LDAP configured, try LDAP bind first; fall back to local bcrypt; auto-provision LDAP user on first successful bind

### Per-project Access Control
- [ ] Add `project_members` table: `(project_id UUID, user_id UUID, role TEXT)`
- [ ] `GET /api/projects`: admins see all; members see assigned projects only
- [ ] Project settings panel: **Members** tab — add member by username, set role, remove member

### Audit Log UI
- [ ] Settings: **Audit Log** page — paginated `audit_events` table (backend already writes these); filter by user / action / entity type / date range; "Export CSV" button

# TASKS.md — DevBrain (Work Knowledge Base)

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically; nomic is tiny (~300MB) so co-exists fine |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |
| Python environment missing | Parser includes JS fallbacks for all formats; markitdown is preferred but optional |

---

# V2 Roadmap

> Phases ordered by priority: fix existing gaps first, build the safety net, protect data, then grow features.
> Fix → Test → Backup → Visibility → AI → Git → Integrations → Multi-user.

---

## Phase 22 — Dashboard & Analytics

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

## Phase 22.5 — Enhanced Ingestion (MarkItDown) — COMPLETED

> Improve RAG quality by converting all ingested files to structured Markdown.

- [x] Create Python bridge `server/scripts/markitdown_bridge.py` to interface with Microsoft MarkItDown
- [x] Update `server/services/parser.ts` to prefer MarkItDown for PDF, DOCX, XLSX, PPTX
- [x] Implement JS fallbacks for all formats to ensure system works without Python environment
- [x] Add PPTX/PPT support via MarkItDown

---

## Phase 23 — AI Enhancements — COMPLETED

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

## Phase 24 — Git Integration (Local & GH) — COMPLETED

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

## Phase 25 — External Issue Sync (GitHub / Linear / Jira) — COMPLETED

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

## Phase 26 — Multi-user & Org Sharing

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

## Phase 27 — Testing & Hardening (Missing Coverage) — COMPLETED

> Fill the testing gaps for Phase 26 features to ensure enterprise reliability.

### Backend Unit Tests (Vitest)
- [x] **LDAP Service**: Mock `ldapjs` to verify bind and search logic; test error handling for connection timeouts
- [x] **Audit Service**: Verify entity-based filtering and CSV generation formatting in `audit.test.ts`
- [x] **Project Access**: Unit test membership-based visibility logic in `projects.test.ts`
- [x] **User Invitations**: Test token generation, hashing, and consumption during registration in `auth_tokens.test.ts`

### E2E Tests (Playwright)
- [x] **Audit UI**: Verify the filter dropdown correctly updates the event list
- [x] **Invitation Flow**: Full flow from generating an invite link to registering a new user via token
- [ ] **Permissions**: Verify that a 'viewer' cannot see "Create Project" or "Delete" buttons
- [ ] **Project Privacy**: Log in as two different users and verify User A cannot see User B's private project
- [ ] **Account Status**: Verify that deactivating a user prevents login


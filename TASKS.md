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

## Phase 28.1 — Notifications & Alerts — COMPLETED

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

## Phase 28.5 — Notification Hub (External Delivery via Apprise) — COMPLETED

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

### Backlog (future phases)
- [ ] Apprise URL config fully replaces `.env` vars — zero env setup needed
- [ ] FlowForge pipeline completion → POST to `/api/notify`
- [ ] Memex re-index completion → POST to `/api/notify`
- [ ] PlayCru Firebase deploy success → POST to `/api/notify`

---

## Phase 28.2 — Advanced Search & Filtering — COMPLETED

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

## Phase 28.4 — Bulk Operations & Triage — COMPLETED

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

## Phase 28.3 — Templates System — COMPLETED

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


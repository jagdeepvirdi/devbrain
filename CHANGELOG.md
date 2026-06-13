# Changelog

All notable changes to DevBrain are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-06-13

### Added

- **Antigravity / Gemini CLI integration** — `integrations/antigravity/` mirrors the Claude Code integration pattern for Gemini CLI / Antigravity sessions. SessionStart/End hooks (PS1 + SH) scaffold `TASKS.md` and `SESSION.md`, archive completed tasks older than 7 days to `TASKS_ARCHIVE.md`, and inject per-phase task progress + last-session summary into the model's context window at session open. A `/devbrain` skill allows on-demand task updates and session summaries.
- **Antigravity project discovery** — `server/services/antigravity-discovery.ts` scans a configured root directory for projects tracked by `TASKS.md`; `server/routes/antigravity-projects.ts` exposes scan, task tree, session list, session detail, and live task-watch (SSE) endpoints.
- **Antigravity settings** — `GET /api/settings/antigravity` and `PUT /api/settings/antigravity` store the `antigravity_scan_root` path in `app_settings`. Configurable under **Settings → Antigravity Integration**.
- **Projects page** — "Link folder" modal now recognises `ANTIGRAVITY.md` alongside `TASKS.md` and `CLAUDE.md` as a valid marker file. Project badge updated from "CLAUDE" to **"AI SYNC"** to reflect both integrations.
- **Feature Guide** — `docs/FEATURE_GUIDE.md` — comprehensive walkthrough of all 22 feature areas with step-by-step test instructions for new users.
- **Documentation section in README** — links to Feature Guide, Changelog, Startup Guide, and Contributing from a single place.

---

## [1.0.0] — 2026-06-13

First stable release. DevBrain ships as a complete local-first developer knowledge base
with AI-powered document Q&A, structured issue investigation, multi-user RBAC, and a
notification hub — all running on-device via Ollama with zero recurring AI cost.

---

### Core Knowledge Base

- **Documents** — Upload PDFs, DOCX, Markdown, spreadsheets, and URLs; text extracted, chunked, and embedded for semantic retrieval. Microsoft MarkItDown bridge converts rich formats to structured Markdown before chunking (JS fallbacks included for environments without Python).
- **Document Q&A (RAG)** — Ask questions against any document or project; `mistral:7b` streams answers with source citations rendered as collapsible cards.
- **Issues** — Structured investigation flow: steps with done-state, notes, linked docs, linked commands, resolution, priority, and tags.
- **Commands Library** — Searchable snippets with syntax highlighting (Shiki), one-click copy, usage tracking, and favorites.
- **Release Notes** — Semver timeline with features, fixes, and breaking changes per project; AI drafting from resolved issues.
- **Runbooks** — Step-by-step operational playbooks; each step can embed a command and a note.
- **Multi-project** — Project switcher in the top bar; all views scope to the selected project or show a unified "All Projects" global view.

---

### AI Features (100% local — Ollama, RTX 2060 Max-Q)

- **Auto-tagging** — `gemma3:4b` suggests up to 5 tags on document upload and issue creation; shown as dismissable chips before save.
- **Command explanation** — `gemma3:4b` explains any command on demand; explanation stored and shown below the code block with a Regenerate action.
- **Issue summarization** — `mistral:7b` generates a 3-bullet TL;DR for any issue; stored in `summary` column; shown above the steps accordion.
- **AI release drafting** — `mistral:7b` drafts Features / Fixes / Breaking Changes sections from resolved issues in a configurable date range; inserts a pre-filled draft into the release form.
- **Smart search suggestions** — Recent issue titles and document names surfaced in ⌘K when query is empty.
- **Optional Claude API** — All AI features use Ollama by default. Setting `USE_CLAUDE=true` routes chat and RAG through the Anthropic API instead — zero code changes required. The "Enhance with Claude" button is the only place the Claude API is ever called automatically.

---

### Search

- **Global Search (⌘K)** — Hybrid semantic (pgvector cosine similarity) + full-text (PostgreSQL tsvector) search across all projects simultaneously; results grouped and color-coded by project.
- **Advanced filtering** — Issues filterable by status, priority, tags, date range, and project; documents additionally filterable by file type. Active filters shown as dismissable chips.
- **Saved filters** — Named presets stored per-user; appear as quick-apply chips above the filter bar.
- **Search history** — Last 20 queries surfaced in ⌘K below smart suggestions.

---

### Git Integration

- **Local git log** — Browse commit history and branch list per project (set `fs_path` on the project).
- **Commit linking** — Link commit SHAs to issues via `POST /api/git/:id/link`; SHA chips shown in issue detail.
- **External issue sync** — Import and continuously sync issues from GitHub (REST), Linear (GraphQL), and Jira (JQL/basic auth). Imported issues carry a source badge chip.

---

### Multi-user & Org Sharing

- **RBAC** — Three roles: `admin` (full access + user management), `member` (create/edit), `viewer` (GET only).
- **User management** — Invite by email (48-hour one-time token); deactivate / reactivate accounts; admin password reset. All managed from Settings > User Management.
- **LDAP / AD authentication** — Configure host, base DN, bind credentials (AES-256-GCM encrypted at rest); auto-provisions LDAP users on first successful bind; falls back to local bcrypt.
- **Per-project access control** — `project_members` table; members and viewers see only their assigned projects; admins see all.
- **Audit log** — Paginated `audit_events` table in Settings; filter by entity type; export as CSV.

---

### Notifications & Apprise Hub

- **In-app notifications** — Bell icon with red unread-count badge; slide-in panel grouped Today / Earlier; click navigates to the entity.
- **Browser notifications** — Opt-in prompt on first panel open; respects browser permission state.
- **Stale issue alerts** — Server background job inserts a `stale_issue` notification (deduplicated to once per issue per day) for issues open past a configurable threshold with no recent note.
- **Integration sync alerts** — `sync_complete` notification inserted after each external issue sync with the count of newly imported issues.
- **External delivery (Apprise)** — Node notifier service spawns `server/scripts/apprise_client.py`; sends to any Apprise-compatible URL (Telegram, Slack, Discord, email, and 80+ others).
- **Telegram quick-add** — Bot Token + Chat ID fields auto-construct the `tgram://` Apprise URL on save.
- **Per-project channel toggles** — Checkbox grid (projects × channels) to opt projects in or out of each delivery channel.
- **Daily digest** — `server/scripts/digest_scheduler.py` (APScheduler) sends a daily summary: open issue count per project, last session date, and stale-project callout. Schedule configurable in Settings.
- **`POST /api/notify`** — Public endpoint accepting `{ title, body, project, level }`. Intended for external callers — other personal projects can push notifications into DevBrain without any shared auth.
- **Notification log** — Dedicated page with full history; filter by project, level, channel, status, and date range; failed rows have a Retry button.
- **Claude Code hook** — `integrations/claude-code/session-end.ps1` and `session-end.sh` POST a session-complete notification to DevBrain on every Claude Code session exit (fire-and-forget, 3s timeout, silent on failure).

---

### Bulk Operations & Triage

- **Multi-select** — Checkbox column on Issues, Documents, and Commands lists (visible on row hover or when any item is checked).
- **Select all / indeterminate** — Column header checkbox; partial-selection shows indeterminate state.
- **Floating action bar** — Appears at the bottom of the list when ≥1 item is selected; context-aware buttons (Tag / Change Status / Re-embed / Favorite / Delete) + selected count + Deselect all.
- **Triage view** — Dedicated Issues tab showing stale + high-priority open issues sorted by urgency; `is_stale` flag derived from the same threshold as notification rules.

---

### Templates

- **Built-in templates** — Bug Report and Investigation (issue type); Deployment Runbook and Incident Postmortem (runbook type). Read-only but duplicatable.
- **Custom templates** — Create, edit, and delete templates scoped to a project or globally available.
- **One-click apply** — "Use template ▾" dropdown in Issue and Runbook create modals pre-fills title, description, tags, and steps.
- **Template editor** — Name, type selector, project scope dropdown; step-builder UI for runbooks, markdown textarea for issues and documents.

---

### Dashboard & Analytics

- **Open Issues by Project** — CSS-only horizontal bar chart; one bar per project using its assigned color.
- **Avg Resolution Time** — Days-per-project bar chart for the last 30 days; "No data" state when no resolved issues exist.
- **Activity Heatmap** — 5-week × 7-day GitHub-contribution-style grid; cells shaded by total event count; hover tooltip.
- **Embedding Health** — Done / pending / failed counts with colored dots; "Retry all failed" button re-embeds every failed document.
- **Stale Issues widget** — Issues open > 14 days with no note in that period; listed with priority badge and a one-click "Mark investigating" action.

---

### Infrastructure & Quality

- **CI (GitHub Actions)** — Three jobs: server typecheck (`tsc --noEmit`), client typecheck, and E2E tests (Playwright + Postgres service container). All green at release.
- **Server unit tests (Vitest)** — Auth routes, audit routes and service, git routes, projects routes, search routes and filters, templates routes, LDAP service, auth-token lifecycle.
- **E2E tests (Playwright)** — Login/logout, document CRUD, issue CRUD, command CRUD, release CRUD, runbook CRUD, global search (including ⌘K / Escape), audit log filtering, invite user flow, viewer role restrictions, per-project privacy, account deactivation.
- **TypeScript strict mode** — `strict: true` throughout; Zod for all API request validation and env-var parsing.
- **Security** — JWTs in `HttpOnly` cookies only; AES-256-GCM for stored OAuth and LDAP credentials; all mutations and auth events written to `audit_events`; SSRF protection on URL imports.
- **DevBrain × Claude Code integration** — `integrations/claude-code/` SessionStart / SessionEnd hooks scaffold `TASKS.md` and `SESSION.md` in every Claude Code project; Apprise integration delivers session-complete notifications.

---

### Fixed (pre-release hardening)

- FK violation when creating invites in dev mode — `created_by` FK references the `users` table but dev mode injects synthetic `id: 'dev'`; now passes `NULL`.
- `user_invites` table and `is_active` column were absent from `schema.sql` (only added via migration, never backported); fresh CI databases were missing both.
- Search modal Escape key missed in E2E — `onKeyDown` handler on `<input>` only fires after the 30ms focus delay; fixed with a document-level listener active while the modal is open.
- `navigator.clipboard.writeText()` throws in headless Chromium — made non-blocking with `.catch(() => {})`.
- Server start script path after TypeScript compilation — `rootDir: ".."` in `tsconfig.json` mirrors the full tree, producing `dist/server/index.js` not `dist/index.js`; `package.json` `start` script corrected.
- Unused import `decrypt` in `server/services/integrations.ts` causing typecheck failure.
- Express `IRoute` type does not expose `.methods` — route-stack inspection in tests updated to cast via `(s.route as any)?.methods.*`.
- `archiver` namespace import used as a runtime value — replaced with `import type { Archiver }` to satisfy ESM strict imports.

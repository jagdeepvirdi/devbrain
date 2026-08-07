# TASKS.md — DevBrain (Work Knowledge Base)

## Release Status

| Version | Date | Status |
|---|---|---|
| **v1.2.0** | 2026-06-15 | Released — Gemini API provider, restart/status scripts, Settings sidebar nav, font size scaling |
| **v1.1.0** | 2026-06-13 | Released — Antigravity integration, Feature Guide |
| **v1.0.0** | 2026-06-13 | Released — all phases complete, CI green |

Completed phases are archived below for reference.
Active development resumes at **v1.x backlog** items at the bottom of this file.

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically — **but see Known Issues below**: under sustained interleaved chat+embed calls (Phase 32.6's summarization step), this swapping was observed to degrade into a hung/thrashing state, not a clean automatic swap |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |
| Python environment missing | Parser includes JS fallbacks for all formats; markitdown is preferred but optional |

---

## Phase 33 — Architect & VC Review: Production-Readiness Hit-List (2026-07-24)

> External brutal-honesty review requested by the user (architect + VC lens), findings cited against the
> actual codebase as of commit `51b4b15`, not generic advice. Scores and verdict recorded here for
> reference; action items below are ordered Critical → High Priority → Nice-to-Have, most severe first
> within each tier.

### Verdict & Scores (out of 10)

| Category | Score | Why |
|---|---|---|
| Architecture | 6 | Clean service/route separation, solid Postgres schema (proper FKs/cascades, GIN+HNSW indexes) — but every background job and SSE endpoint is an in-process singleton with no distributed-lock or pub/sub story; zero horizontal-scaling design. |
| Code Quality | 6 | Consistent TypeScript, zero `any` (lint-enforced), Zod validation at every boundary — undercut by several 700–3,000-line god-files (`Settings.tsx`, `documents.ts`, `issues.ts`, `settings.ts`). |
| Test Coverage | 5 | Server: genuinely excellent (96/93/94/97% stmts/branch/fn/lines). Client: **one** test file (`api.test.ts`) covering ~18,700 lines of page/component code, and CI doesn't even run the client's own `npm test`. The average hides a real blind spot. |
| Security | 4 | Real good instincts (SSRF guard on URL import, httpOnly+Secure+SameSite=Strict cookies, Zod-validated env, AES-256-GCM at rest) undone by an unescaped-HTML stored-XSS path, a key-reuse bug in the crypto helper, no `helmet`, and rate limiting applied to ~9 of ~40 mutating routes. |
| Usability | 7 | Broad, coherent feature set (RAG, issues, commands, releases, runbooks, Codes tab, dashboards) behind one consistent design system — not independently UX-tested end-to-end as part of this review. |
| Scalability | 2 | Cannot survive "10,000 users tomorrow." The entire AI layer is one Ollama instance on one consumer GPU, which this project's own Known Issues section (above) already documents thrashing into a 90s-hang degraded state under *single-user* load. |
| Documentation/Process | 9 | `TASKS.md`/`CHANGELOG.md`/`README.md`/`CLAUDE.md` discipline is genuinely better than most funded startups' — this is the strongest part of the project. |
| "Moat" | 3 | Every capability is a competent assembly of well-known OSS primitives (pgvector, tree-sitter, Ollama) — no proprietary algorithm, no data network effect. Real value is personal/workflow-specific (wired to this developer's own projects and machine), not a market moat. |

**Overall gut check**: as a personal/local-first knowledge tool, this clears the bar most solo projects never reach — the backend test discipline and documentation are rare, full stop. As a "market-ready product" judged on a VC/architect lens, it isn't close: no tenant isolation, no billing, no horizontal-scaling story, and a real XSS hole sitting in a feature (RAG chat) that's central to the product. Both readings are true at once; which one matters depends entirely on whether this stays a personal tool or becomes a pitch.

> Critical items and most of High Priority resolved 2026-07-24 — see TASKS_ARCHIVE.md.

### High Priority (remaining)

- [ ] **God-files need splitting** — **deferred by user decision (2026-07-24)**: `client/src/pages/Settings.tsx` (3,002 lines), `server/routes/documents.ts` (942), `server/routes/settings.ts` (826), `server/routes/issues.ts` (764), `client/src/pages/Commands.tsx` (1,221) are still single-responsibility violations waiting to cause a bad merge. Revisit now that the client test-coverage item above is landed — splitting with at least some regression tests in place is a materially different risk than doing it against a nearly-untested 3,000-line component.

### Nice-to-Have (polish & market-readiness)

- [ ] **No tenant isolation** — multi-user today is RBAC + `project_members` scoping inside one shared Postgres DB, not multi-tenant partitioning. Fine for one org; selling to multiple unrelated customers as SaaS needs a real tenant boundary (schema-per-tenant, or a tenant_id discipline enforced at the query layer, not just app logic).
- [ ] **No billing/licensing** — no Stripe, no seat limits, no plan gating anywhere in the schema or routes. RBAC exists but nothing meters or monetizes it.
- [ ] **No product analytics** — zero visibility into real usage beyond the internal audit log; add basic event telemetry if this is ever meant to be observed at a product level, not just a personal-tool level.
- [ ] **No SAML/OIDC** — only LDAP/AD and local bcrypt; modern B2B buyers expect SSO via SAML/OIDC, not just LDAP.
- [ ] **No formal privacy/ToS/DPA** — standard procurement blockers for any B2B sale; irrelevant for personal use, required the moment this is pitched externally.
- [ ] **Cloud-inference cost model undefined** — the "$0/month" pitch (`CLAUDE.md` Cost Summary) only holds for local Ollama on your own GPU; the moment `AI_PROVIDER=claude`/`gemini` becomes the default for other users, "zero cost" becomes "per-token cost per user," and nothing in the app tracks or caps that spend today.

---

# V2 Roadmap

> Re-scoped 2026-07-17: audited the original "Fix → Test → Backup → Visibility → AI → Git →
> Integrations → Multi-user" pipeline against what's actually shipped. Most of it landed already
> (RBAC, LDAP/AD auto-provisioning, GitHub/Linear/Jira import, local git browsing + commit linking,
> Apprise external notifications, scheduled backup + zip/JSON restore, CI with server tests + client
> typecheck + Playwright e2e). What follows are the specific gaps found — not a full category rebuild.

> Everything else in this roadmap is resolved and archived to TASKS_ARCHIVE.md (2026-07-20 to 2026-07-22).

## Two-Way Integration Sync (GitHub / Linear / Jira)

- [ ] Webhook-based live sync as an alternative to the current manual `POST /api/integrations/:id/sync`
      pull-only trigger — investigate per-provider webhook setup (GitHub App vs. PAT scopes, Linear
      webhooks, Jira webhooks) before committing to one approach; biggest unknown of the four items here.
- [ ] Push-back: create/update the external issue from DevBrain, not just import — needs a design
      decision on conflict resolution once sync is bidirectional (simultaneous edits on both sides).

---

## Phase 34 — Principal Engineer Code Audit & Hardening (2026-07-24)

> Audit findings across security, architecture, performance, and code quality. Action items prioritized for review.

- [x] **Rate Limiter IP Spoofing via Unconfigured `trust proxy`** — fixed 2026-08-07: added `TRUST_PROXY` env var (`server/lib/env.ts`) wired via `app.set('trust proxy', env.TRUST_PROXY)` in `server/index.ts`, defaulting to `false` (no proxy trusted, `X-Forwarded-For` ignored). `docker-compose.prod.yml` sets `TRUST_PROXY: 1` for its bundled Caddy reverse-proxy hop; documented in `.env.example` and `CONTRIBUTING.md`.
- [ ] **60 Non-null Assertion (`!`) Warnings in Server Routes** — ESLint flags 60 instances of `@typescript-eslint/no-non-null-assertion` across `aitask.ts`, `auth.ts`, `chat.ts`, `documents.ts`, `users.ts`, `ai.ts`. Refactor to strict guards to prevent uncaught runtime type errors.
- [ ] **Event Loop Blocking in Duplicate Document Line Similarity** — `POST /api/documents/find-duplicates` computes multiset Dice-similarity on full raw text synchronously on the main event thread. Add string length caps or async yielding for large contents.
- [ ] **God-File Modularization (`documents.ts`, `Settings.tsx`, `settings.ts`)** — Split monolithic route and page files into isolated domain modules and sub-controllers now that baseline test coverage exists.

---

## Phase 36 — In-App Code Editor: Codes Tab (CodeMirror, DB Snapshot) (2026-08-07)

> Replaces external EditPlus/Notepad usage for viewing and editing tracked code with a real syntax-highlighted
> editor inside DevBrain. Library choice researched against massCode, Trilium Notes, and Gitea's own
> Monaco→CodeMirror migration (same bundle-size/consistency tradeoff). Targets the existing Codes tab
> (DB-stored snapshot, no filesystem access). [[Phase 37]] (separate, later) extends the same editor component
> to real on-disk files via a project's linked `fs_path`.

### Decided
- Engine: **CodeMirror 6** via `@uiw/react-codemirror`, not Monaco (Monaco is 2–5MB and can't lazy-load; CM6 is
  ~50KB core with per-language lazy loading, matching how Shiki already lazy-loads grammars in this codebase).
  Theme: `@uiw/codemirror-theme-github`'s `githubDarkInit` (font family overridden to `var(--font-mono)`) —
  matches the existing Shiki `github-dark` theme already used in `Commands.tsx`. `githubLight` wasn't wired up:
  DevBrain has no light-mode toggle anywhere in the app (confirmed via `Mermaid.initialize({ theme: 'dark' })`
  being hardcoded too), so there's no app state to switch on yet. Languages: `@codemirror/language-data`
  (confirmed via the CM6 source to cover everything in `LANGUAGE_COLOR` except Svelte, which falls back to
  plain text — no dedicated grammar available upstream).
- Window style: in-app full-screen overlay (not a real OS popup window) for v1.
- Save: manual (Ctrl+S / button) by default, with a per-session autosave toggle (debounced). A localStorage
  draft safety net persists in-progress edits regardless of autosave state, so nothing is lost on an accidental
  close — offered back as "restore unsaved draft?" on reopen, cleared on a successful server save.
- Opens read-only, not straight into edit mode (changed after initial implementation, per user feedback): the
  Codes-tab trigger button reads "Open" (was "Edit"), and the overlay itself shows a "read-only" badge + an
  "Edit" button in the header. Clicking it flips the editor writable and swaps in the Save/autosave controls —
  so browsing a file never risks an accidental edit, and only clicking Edit switches into the mutation path.
- Explicit "← Codes" back-link in the header (top-left, same convention as `IssueDetail.tsx`'s "← Issues"),
  added after user feedback that the original small "✕" close button in a control-heavy header wasn't
  discoverable. Replaces the "✕" outright rather than sitting alongside it; routes through the same
  confirm-if-dirty close path as Escape.

### Tasks
- [x] `PATCH /api/documents/:id/content` — Zod-validated `{ content }`, `requireRole('member')`; text-based
      sibling to the existing file-upload `update-content` route (same content/content_hash/embedding_status
      update pattern, re-embeds via `embedDocument()`, leaves title/tags/component/project untouched).
- [x] `client/src/components/codes/CodeEditor.tsx` — `@uiw/react-codemirror` wrapper (`forwardRef`, exposing
      `view.focus()` so the overlay can focus it when switching into edit mode); dynamically imports the
      matched language from `@codemirror/language-data` off `doc.language`; applies the GitHub-dark theme
      to match the app theme. `LANGUAGE_COLOR`/`langColor` moved out of `Codes.tsx` into `client/src/lib/language.ts`
      so both the list view and the editor share one source instead of drifting.
- [x] `client/src/components/codes/CodeEditorOverlay.tsx` — full-screen modal, opens read-only: "← Codes" back
      link, filename/language badge, dirty indicator, read-only badge + Edit button (view mode) that swaps to
      autosave toggle + Save button (edit mode), Ctrl+S / Escape / back-link (all confirm-if-dirty), draft-restore
      banner (restoring a draft also enters edit mode), localStorage draft persistence keyed `devbrain:draft:<docId>`.
- [x] Wire into `Codes.tsx` — "Open" action on the preview panel launches the overlay (read-only); existing
      AI/metadata panel (explain, diagram, linked items, reembed, replace-file) stays as-is, unrelated concern.
- [x] Client tests for `CodeEditorOverlay` (14 tests: opens read-only, Edit switches to writable + reveals Save
      controls, dirty-tracking, save via button/Ctrl+S, Escape/back-link confirm-close, draft restore/discard,
      autosave on/off) — `CodeEditor` itself is mocked with a `forwardRef` textarea (readOnly forwarded through)
      so these exercise the overlay's own logic without mounting real CodeMirror in jsdom.
- [x] Server test for the new `PATCH .../content` endpoint (5 tests: empty/missing content 400s, 404, happy
      path leaves `file_type`/`language` untouched + re-embeds, failure marks `embedding_status = 'failed'`),
      mirroring existing `update-content` coverage.

---

## Phase 37 — In-App Code Editor: Real On-Disk File Editor (project `fs_path`), later

> Follow-up to [[Phase 36]] — reuses its `CodeEditor` component and "Decided" choices (CodeMirror 6, in-app
> overlay, manual save + autosave toggle). This is the phase that actually replaces EditPlus/Notepad for live
> files, since Phase 36 only edits a DB-tracked snapshot with no link back to disk.

### Tasks
- [ ] `server/routes/project-files.ts`: list/read/write files under a project's linked `fs_path`.
      **Security-critical**: every call must resolve the requested path against `fs_path` and strictly verify
      containment (reject `..`, symlink escape) before touching the filesystem — same rigor category as the
      existing SSRF guard on URL import.
- [ ] Respect `.gitignore` at listing time; size cap + binary-file sniff on read.
- [ ] Reuses `CodeEditor` from [[Phase 36]] verbatim; save path here is a real disk write — does not touch
      `documents`/embeddings (explicitly separate from the Codes-tab snapshot; no auto-sync between the two
      in v1).
- [ ] Decide (before starting): file size/type allowlist, whether writes need a first-use-per-session
      confirmation step, and that this is inert for any project without `fs_path` set.

---

## Phase 38 — Notes (2026-08-07)

> Freeform, taggable notes that connect to everything else in DevBrain (issues, tasks, releases, commands,
> other documents/codes) — requested as an alternative to jamming notes into the structured Tasks tab
> (status/priority/due-date fields don't fit freeform content).

### Decided
- Storage: no new table. Notes are `documents` rows with a new `file_type = 'note'` — exact precedent: this is
  how the Codes tab already works (`file_type = 'code'` on the same table). One migration
  (`add_note_file_type.ts`, mirroring the existing `add_code_file_type.ts`) widens the `documents_file_type_check`
  CHECK constraint to add `'note'`.
- Notes get `language = 'markdown'` set at creation — the same column code files use for `'typescript'`/
  `'python'`/etc. Since `CodeEditor` ([[Phase 36]]) picks its syntax highlighting off that column, notes get
  markdown highlighting with **zero editor code changes** (`@codemirror/language-data` already includes
  Markdown).
- RAG: notes ARE embedded via `embedDocument()`, same as every other document — searchable/answerable through
  Ask AI, not kept as a separate un-embedded scratch space.
- Editor UX: reuses `CodeEditorOverlay`'s read-only-by-default flow for *opening an existing* note (same
  no-accidental-edit safety as Codes). A **freshly created** note skips that and opens straight into edit mode
  via a new `startInEditMode` prop, since composing is the entire point right after creation.
- Tagging/linking: **zero new code**. Documents are already a linkable `entity_links` type with a working tags
  column and `FilterBar` — notes are connectable to issues/tasks/releases/commands/other documents the moment
  this ships, with no changes to `LinkedItems.tsx` or the `entity_links` schema.
- Nav: new standalone "Notes" tab/page/route (not folded into the Documents page) — matches the Codes-tab
  precedent of a dedicated, purpose-built UI over the same underlying table.

### Tasks
- [x] `server/db/migrations/add_note_file_type.ts` — mirrors `add_code_file_type.ts`: widens
      `documents_file_type_check` to add `'note'` (no new column — `language` already exists). Also run against
      the local dev DB and mirrored into `schema.sql` for fresh installs.
- [x] `POST /api/documents/note` — Zod-validated `{ title, content, projectId?, tags?, component? }` (`content`
      may be empty — a brand-new note can start blank); inserts with `file_type='note'`, `language='markdown'`,
      hashes content, embeds via `embedDocument()`. Modeled directly on the existing `POST /api/documents/url`
      route (typed-content insert + embed, no file upload/parsing, no duplicate-content 409).
- [x] `documentsApi.createNote(...)` in `client/src/lib/api.ts`.
- [x] `CodeEditorOverlay`: added an optional `startInEditMode` prop so a newly created note opens straight into
      edit mode instead of the read-only-first flow.
- [x] `client/src/pages/Notes.tsx` — mirrors `Codes.tsx`'s list+preview layout, minus the code-specific columns
      (language/chunks/size — not meaningful for notes); "New note" button opens a small title+tags modal that
      calls `createNote` then immediately opens `CodeEditorOverlay` in edit mode. Row click reuses the existing
      read-only→Edit overlay flow as-is.
- [x] Wired `LinkedItems` into the note preview panel exactly as `Codes.tsx` already does (`entityType="document"`)
      — no changes needed to `LinkedItems.tsx` itself.
- [x] Added "Notes" to the sidebar nav + route in `App.tsx` (between Documents and Codes).
- [x] Added a `markdown` entry to `LANGUAGE_COLOR` in `client/src/lib/language.ts`.
- [x] Tests: 5 server tests for `POST /api/documents/note` (`documents_create_note.test.ts`), 4 client tests for
      the note-creation flow (`Notes.test.tsx`) + 1 for `CodeEditorOverlay`'s `startInEditMode` prop. Also fixed
      a real bug this surfaced: the client `DocMeta.file_type` union in `api.ts` was missing `'note'` — caught by
      `tsc -b` (the build) but not plain `tsc --noEmit`, since Vitest doesn't type-check.

> Implemented 2026-08-07: server (1206/1206) and client (38/38) test suites pass, full typecheck/lint clean,
> production build succeeds. Not yet verified by clicking through in a browser — this instance has
> `AUTH_PASSWORD` set, so an automated Playwright pass couldn't get past the login gate; still pending manual
> confirmation.

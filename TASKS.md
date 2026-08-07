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

## Phase 33 — Architect & VC Review: Production-Readiness Hit-List (2026-07-24) — closed, see [[Phase 39]]

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

> Critical items and most of High Priority resolved 2026-07-24 — see TASKS_ARCHIVE.md. Remaining High
> Priority and Nice-to-Have action items consolidated into [[Phase 39]] (priority-ordered) on 2026-08-07 —
> the Verdict/Scores/gut-check above stay here as the dated snapshot they were; see Phase 39 for current status.

---

# V2 Roadmap

> Re-scoped 2026-07-17: audited the original "Fix → Test → Backup → Visibility → AI → Git →
> Integrations → Multi-user" pipeline against what's actually shipped. Most of it landed already
> (RBAC, LDAP/AD auto-provisioning, GitHub/Linear/Jira import, local git browsing + commit linking,
> Apprise external notifications, scheduled backup + zip/JSON restore, CI with server tests + client
> typecheck + Playwright e2e). What follows are the specific gaps found — not a full category rebuild.

> Everything else in this roadmap is resolved and archived to TASKS_ARCHIVE.md (2026-07-20 to 2026-07-22).

## Two-Way Integration Sync (GitHub / Linear / Jira) — closed, see [[Phase 39]]

> Action items consolidated into [[Phase 39]] (priority-ordered) on 2026-08-07.

---

## Phase 34 — Principal Engineer Code Audit & Hardening (2026-07-24) — closed, see [[Phase 39]]

> Audit findings across security, architecture, performance, and code quality. Action items prioritized for review.
> Remaining items consolidated into [[Phase 39]] (priority-ordered) on 2026-08-07.

- [x] **Rate Limiter IP Spoofing via Unconfigured `trust proxy`** — fixed 2026-08-07: added `TRUST_PROXY` env var (`server/lib/env.ts`) wired via `app.set('trust proxy', env.TRUST_PROXY)` in `server/index.ts`, defaulting to `false` (no proxy trusted, `X-Forwarded-For` ignored). `docker-compose.prod.yml` sets `TRUST_PROXY: 1` for its bundled Caddy reverse-proxy hop; documented in `.env.example` and `CONTRIBUTING.md`.

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

## Phase 37 — In-App Code Editor: Real On-Disk File Editor (project `fs_path`) (2026-08-07)

> Follow-up to [[Phase 36]] — reuses its `CodeEditor` component and "Decided" choices (CodeMirror 6, in-app
> overlay, manual save + autosave toggle). This is the phase that actually replaces EditPlus/Notepad for live
> files, since Phase 36 only edits a DB-tracked snapshot with no link back to disk.

### Decided
- No existing path-containment precedent anywhere in the codebase (`git.ts` only ever passes `fs_path` itself
  as a whole-repo `cwd`, never combined with a user-supplied sub-path) — wrote `resolveSafePath()` from
  scratch: resolve the candidate against the project root and verify via `path.relative` (catches `..`
  escapes), **then** re-resolve both root and candidate through `fs.realpath` (walking up to the nearest
  existing ancestor for a not-yet-existing write target) and re-verify containment on the *real* paths —
  catches a symlink planted inside the tree that points outside it, which the first check alone would miss.
- `.gitignore` handling is root-level only, no cascading per-subdirectory resolution — a deliberate v1
  simplification (`ignore` package added as a real dependency; it previously only existed as an eslint
  transitive dep, unusable from server code). `.git` itself is always excluded regardless of `.gitignore`.
- Binary-file detection: null-byte heuristic (same approach git itself uses) — no mime/binary-sniffing library
  existed in the codebase to reuse.
- File size cap: 2MB (`MAX_FILE_BYTES`), both read and write — generous for source files, well below the 50MB
  document-upload multer limit (that's for bulk ingestion, not a live in-browser editor buffer).
- **Additional scope-narrowing decision beyond the original plan**: writes only overwrite a file that already
  exists — creating brand-new files/directories from the browser is out of scope for v1. Keeps the risk
  surface to "edit what's already there" rather than "silently add new files a `git status` wouldn't expect."
- No separate first-use-per-session write confirmation dialog: [[Phase 36]]'s already-established read-only-
  by-default + explicit "Edit" click *is* the confirmation step (you have to consciously choose to make a file
  writable), so a second modal on top would just be redundant friction, not extra safety.
- UI lives inside the existing per-project panel in `Projects.tsx` (new "Files" tab, alongside Tasks/Sessions/
  Git/Members — gated behind `isLinked` i.e. `!!project.fs_path`, same as Git already is), not a new top-level
  nav item — unlike Notes/Codes (cross-project entities), a file browser is inherently scoped to one project's
  linked folder.
- `CodeEditorOverlay` (Codes/Notes) was **not** generalized to share code with the new file editor — genuinely
  different data sources (a `documents` row + `documentsApi` vs. a raw file path + `projectFilesApi`) would
  have forced an awkward shared interface. Built a separate `ProjectFileEditorOverlay` that mirrors its UX
  instead. `CodeEditor` itself *was* extended (backwards-compatibly) with an optional `filename` prop, using
  CodeMirror's own `LanguageDescription.matchFilename` for syntax highlighting — real files have no stored
  `language` column to key off, unlike Codes/Notes documents.

### Tasks
- [x] `server/routes/project-files.ts`: list/read/write files under a project's linked `fs_path`, mounted at
      `/api/project-files`. **Security-critical**: every call resolves the requested path against `fs_path`
      and strictly verifies containment (rejects `..` and symlink escapes) before touching the filesystem —
      same rigor category as the existing SSRF guard on URL import. 14 server tests (1 skipped: symlink-escape
      test, conditional on the OS actually allowing symlink creation — this Windows box lacks Developer Mode)
      run against a **real** temp directory rather than mocked `fs`, since mocking the filesystem would let a
      broken containment check pass trivially.
- [x] Respects `.gitignore` at listing time (root-level); size cap (2MB) + binary-file sniff (null-byte
      heuristic) on read/write.
- [x] Reuses `CodeEditor` from [[Phase 36]]; new `ProjectFileEditorOverlay` component (mirrors
      `CodeEditorOverlay`'s read-only-first/Edit/Ctrl+S/autosave/draft-safety-net/confirm-close UX) wires it to
      `projectFilesApi` instead of `documentsApi` — a real disk write, does not touch `documents`/embeddings
      (no auto-sync between a Codes-tracked snapshot and the real file in v1).
- [x] New "Files" tab in the `Projects.tsx` per-project panel (`FilesTab.tsx`): directory-at-a-time browser
      with breadcrumbs, folder descent, click-a-file-to-open. 5 client tests for `FilesTab`, 10 for
      `ProjectFileEditorOverlay`.
- [x] Found and fixed a real bug during testing: `getFsRoot()` originally returned `null` for **both**
      "project doesn't exist" and "project exists but has no linked path," making the 400 branch dead code —
      every request to a nonexistent project or one with no `fs_path` was 404ing instead of the intended
      404/400 split. Fixed by distinguishing `undefined` (not found) from `null` (no path) as the sentinel.

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

---

## Phase 39 — Consolidated Priority Backlog (2026-08-07)

> Every action item still open elsewhere in this file — from [[Phase 33]]'s remaining High Priority/Nice-to-Have
> items, [[Phase 34]]'s remaining audit findings, and the V2 Roadmap's Two-Way Integration Sync — collected
> here in one place and ordered by actual priority instead of by which review produced them. Original wording
> preserved from its source section; each item notes where it came from. The two phases' overlapping "split the
> god-files" items are merged into one. Tiers, most severe/urgent first:

### Tier 1 — Correctness & reliability (do first)

- [x] **Event Loop Blocking in Duplicate Document Line Similarity** *(from [[Phase 34]])* — fixed 2026-08-07 in
      `server/routes/documents.ts`'s `POST /find-duplicates`: (1) `DUPLICATE_COMPARE_CHARS` (300,000) caps how
      much of each file's content `lineSimilarity()` actually diffs, bounding the cost of any single pathological
      pair; (2) the candidate-pairs loop now yields to the event loop via `setImmediate` every 25 pairs
      (`DUPLICATE_YIELD_EVERY_N_PAIRS`) instead of scoring the whole shortlist in one unbroken synchronous
      stretch. Also removed the `contentById.get(id)!` assertions in the same loop (swapped for an `if (a && b)`
      guard) while in there. 2 new tests: one proves the char cap by constructing files that share an identical
      >300K-char prefix and diverge only in the (uncompared) tail, asserting the score still comes out to
      exactly 1; the other spies on `setImmediate` with 8 documents (28 candidate pairs) and confirms it's
      actually invoked. All 10 tests in `documents_find_duplicates.test.ts` pass.
- [x] **60 Non-null Assertion (`!`) Warnings in Server Routes** *(from [[Phase 34]])* — fixed 2026-08-07. Recount
      at fix time was 58 (across 14 files, not the 6 originally listed — the 2026-07-24 audit's file list was
      already stale). Zero remain (`npx eslint . | grep -c no-non-null-assertion` → 0). Two patterns covered
      most of them:
      - **`req.user!` (32 of 58, across `aitask.ts`, `auth.ts`, `chat.ts`, `integrations.ts`, `notifications.ts`,
        `notify.ts`, `search.ts`, `users.ts`)** — added `requireUser(req)` to `middleware/auth.ts`: throws a clear
        error if `req.user` is missing instead of silently trusting it. Verified per-file that the route is
        actually reached only after `req.user` is set (either the app-wide `requireAuth` mounted before that
        router in `index.ts`, or a route-level `requireAuth`/`requireRole` above `'viewer'`) before applying it —
        this is a real invariant, not a blind assertion swap. `auth.test.ts`'s hand-rolled `middleware/auth.js`
        mock needed `requireUser` added to match.
      - **Everything else (26 instances, one-off per call site)** — no single shared fix; each was a case of
        TypeScript's narrowing not surviving a specific boundary (a nested closure, a re-fetched `Map`/array
        lookup, a separately-tracked boolean standing in for a nullable value) and was fixed at the root rather
        than re-asserted: `documents.ts`'s `docId!` (3x) → typed `pool.query<{ id: string }>(...)` so the insert's
        `RETURNING id` narrows the variable properly instead of losing type info through an untyped `rows[0].id`;
        `settings.ts`'s `client!` (6x, zip-import) → branches on `client` truthiness itself instead of a separately-
        tracked `isDryRun` boolean, so the compiler's own narrowing proves it; `search.ts`'s closure case →
        captured `req.user?.id` into a stable `const` *before* entering the async IIFE that used it (narrowing
        doesn't cross closure boundaries for re-evaluated property access, only for stable bindings);
        `ldap.ts`'s `userDn!` → same closure-capture fix, one level deeper (nested inside `client.bind()`'s own
        callback); `auth.ts`'s `u.password_hash!` → restructured so the truthy-check narrows `u.password_hash`
        itself, not the differently-expressed `userRows[0].password_hash`; `ai.ts`'s `ANTHROPIC_API_KEY!` (2x) and
        `res.body!` (3x) → explicit `if (!x) throw` guards, which happen to also be genuine defense-in-depth (the
        API key's "required" invariant is enforced by env.ts startup validation, not the type system, and
        `res.body` really can be null per the Fetch API's own types even after `res.ok`); `tasks-watcher.ts`'s
        `subscribers.get(id)!` → rewritten as a standard get-or-create (`let subs = map.get(k); if (!subs) {...}`)
        instead of a `.has()` check followed by a separate `.get()!`; `integrations.ts`'s `syncLinear`'s `token!`
        → this one was a real (if unlikely) bug, not just a lint nit: `token` can genuinely be `null` when an
        integration has no PAT configured, which would have sent a literal `"null"` Authorization header to
        Linear's API instead of a clear local error.
      All touched files' existing test suites re-run clean (server: 1222/1222 + 1 skipped, unrelated to this
      item); no behavior changes intended anywhere — every fix is either a type-narrowing restructure or an
      explicit guard on an invariant that was already true.

### Tier 2 — Code quality / maintainability

- [~] **God-file splitting** *(merged from [[Phase 33]] and [[Phase 34]], which each listed an overlapping
      subset)* — `client/src/pages/Settings.tsx` (3,002 lines), `server/routes/documents.ts` (942),
      `server/routes/settings.ts` (826), `server/routes/issues.ts` (764), `client/src/pages/Commands.tsx`
      (1,221) are still single-responsibility violations waiting to cause a bad merge. Originally deferred
      2026-07-24 pending better client test coverage.
      **Server-side (3 of 5) done 2026-08-07** — these already had 99%+ test coverage, so the precondition
      didn't apply; split via `router.use(subRouter)` composition under the original mount point in `index.ts`
      so the external API surface (paths, method, `export default router`) is unchanged:
      - `issues.ts` (764→445 lines) → `routes/issues-notes.ts` (notes/commits CRUD) +
        `routes/issues-ai.ts` (related-commands, suggest-steps, related-docs, summarize, reembed, suggest-tags),
        with shared SQL fragments/embed helper pulled into `services/issuesShared.ts` to avoid a circular
        import. Tests split into `issues.test.ts` / `issues_notes.test.ts` / `issues_ai.test.ts` (80 tests,
        exact parity).
      - `settings.ts` (828→201 lines) → `routes/settings-backup.ts` (backup/import/backup-config/backup-now/
        test-remote/zip-import, own `multer` instance) + `routes/settings-notifications.ts`
        (notifications/digest). Tests split into `settings.test.ts` / `settings_backup.test.ts` /
        `settings_notifications.test.ts` (81 tests, exact parity).
      - `documents.ts` (1057→651 lines) → `routes/documents-ai.ts` (explain, diagram, save-explanation,
        component-overview, find-duplicates, suggest-tags, suggest-tags-from-file; own `multer` instance +
        duplicated `sha256()` helper, same precedent as `settings-backup.ts`). Of the 13 pre-existing
        `documents_*.test.ts` files: 5 needed only a router-import swap to `documentsAiRouter`
        (`documents_explain`, `documents_diagram`, `documents_component_overview`, `documents_find_duplicates`,
        and the renamed `documents_suggest_tags.test.ts` which now also covers the plain `/suggest-tags` route
        that was previously tested inside `documents_list_and_crud.test.ts`); `documents_list_and_crud.test.ts`
        had its moved `suggest-tags` describe block removed and gained the "linked explanation doc" GET `/:id`
        block moved in from `documents_save_explanation.test.ts`, which in turn kept only the
        `save-explanation` block. 7 files needed no change. Full suite: 1222 passed/1 skipped — exact parity
        with pre-split baseline.
      - In every case, mount order of the sub-routers doesn't matter: each moved route is either 2+ path
        segments or a POST-only bare route with no colliding GET/PUT/DELETE `/:id`-shaped route in the parent
        or sibling router. Verified via `tsc --noEmit`, full `vitest run`, and `eslint .` after each split —
        all clean.
      **Client-side (2 of 5) still not started** — `Settings.tsx` and `Commands.tsx` remain at 0% dedicated
      test coverage; this session's new client suites (`CodeEditorOverlay`, `Notes`, `FilesTab`,
      `ProjectFileEditorOverlay`, ~40 tests) established a working test pattern for interactive components but
      don't cover either file. Splitting them now would mean doing it against effectively untested code —
      still blocked on writing regression tests for the specific file being split first, not a general
      "coverage improved" green light. Treat as a distinct, larger follow-up.

### Tier 3 — Feature enhancements

- [ ] **Webhook-based live sync** *(from V2 Roadmap — Two-Way Integration Sync)* — alternative to the current
      manual `POST /api/integrations/:id/sync` pull-only trigger — investigate per-provider webhook setup
      (GitHub App vs. PAT scopes, Linear webhooks, Jira webhooks) before committing to one approach; biggest
      unknown of the two items here.
- [ ] **Push-back sync** *(from V2 Roadmap — Two-Way Integration Sync)* — create/update the external issue from
      DevBrain, not just import — needs a design decision on conflict resolution once sync is bidirectional
      (simultaneous edits on both sides). Blocked on the design decision, not effort.

### Tier 4 — Nice-to-have / market-readiness (only relevant if this stops being a personal tool)

*(from [[Phase 33]] — all explicitly framed there as non-goals for personal/local-first use; lowest priority by
design, not oversight)*

- [ ] **No tenant isolation** — multi-user today is RBAC + `project_members` scoping inside one shared Postgres DB, not multi-tenant partitioning. Fine for one org; selling to multiple unrelated customers as SaaS needs a real tenant boundary (schema-per-tenant, or a tenant_id discipline enforced at the query layer, not just app logic).
- [ ] **No billing/licensing** — no Stripe, no seat limits, no plan gating anywhere in the schema or routes. RBAC exists but nothing meters or monetizes it.
- [ ] **No product analytics** — zero visibility into real usage beyond the internal audit log; add basic event telemetry if this is ever meant to be observed at a product level, not just a personal-tool level.
- [ ] **No SAML/OIDC** — only LDAP/AD and local bcrypt; modern B2B buyers expect SSO via SAML/OIDC, not just LDAP.
- [ ] **No formal privacy/ToS/DPA** — standard procurement blockers for any B2B sale; irrelevant for personal use, required the moment this is pitched externally.
- [ ] **Cloud-inference cost model undefined** — the "$0/month" pitch (`CLAUDE.md` Cost Summary) only holds for local Ollama on your own GPU; the moment `AI_PROVIDER=claude`/`gemini` becomes the default for other users, "zero cost" becomes "per-token cost per user," and nothing in the app tracks or caps that spend today.

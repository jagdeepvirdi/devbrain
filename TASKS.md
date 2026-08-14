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

- [x] **God-file splitting** *(merged from [[Phase 33]] and [[Phase 34]], which each listed an overlapping
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
      **Client-side (2 of 5) done 2026-08-07** — wrote regression tests first (per the precondition recorded
      above), then split, matching the "test before touching untested code" rule:
      - `Commands.tsx` (1,221→590 lines) → `components/commands/highlighter.ts` (Shiki singleton, lang
        colors/date fmt), `CodeBlock.tsx` (+ `LangBadge`), `CommandCard.tsx`, `CommandDetail.tsx`,
        `NewCommandModal.tsx`, `CommandPalette.tsx`. New `Commands.test.tsx` (13 tests) written first against
        the still-monolithic file — list/search/filter, favorite toggle, create/validate, inline edit, delete
        confirm, bulk select/tag/favorite/delete, shell-file import, and the command palette's search→copy
        flow (mocking `shiki`'s `createHighlighter` and `navigator.clipboard`) — then kept green through the
        extraction unchanged.
      - `Settings.tsx` (3,002→384 lines) → 15 new files under `components/settings/`: `shared.tsx` (`Row`,
        `Section`), `constants.ts` (`ROLE_COLOR` — kept out of `shared.tsx` to avoid a
        `react-refresh/only-export-components` warning from mixing a constant into a components-only file),
        `UserManagement.tsx`, `AuditLog.tsx`, `ApiTokensSection.tsx`, `IntegrationsSection.tsx`,
        `LdapConfigurationSection.tsx`, `CandidateRow.tsx` (shared by both integration scanners),
        `ClaudeIntegrationSection.tsx`, `AntigravityIntegrationSection.tsx`, `ExportSection.tsx`,
        `ScheduledBackupSection.tsx`, `NotificationRulesSection.tsx`, `ZipImportSection.tsx`,
        `NotificationHubSection.tsx`, `TemplatesSection.tsx`. `Settings.tsx` keeps only the tab shell plus the
        General/Account/Data-backup/Danger-Zone blocks that were never factored into their own components.
        New `Settings.test.tsx` (18 tests, one `describe` per sidebar tab) written first against the
        monolithic page, mocking the full `lib/api` surface it touches — covers the primary data-fetch and
        one create/save action per tab, plus a non-admin-hides-admin-tabs check — then kept green through the
        extraction.
      - Both splits verified via `tsc --noEmit`, full `vitest run` (84/84 passing — the 66 pre-existing plus
        the 18 new Settings tests; Commands' 13 were already counted in the 66), and `eslint .` (0 errors,
        warning count unchanged from the pre-split baseline — confirmed by diffing against the original files'
        own lint output, not just eyeballing).

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

---

## Phase 40 — Code Intelligence & Knowledge Graph Engine (2026-08-13)

> Requested after a ChatGPT/Gemini-authored spec proposed a standalone Python `tree-sitter` + `sqlglot` +
> KuzuDB indexer for statically parsing a multi-language codebase (Python/Perl/Bash/Postgres+Oracle SQL) into
> a call/reference graph, to power "which functions call this," "what does this stored procedure touch," and
> LLM-ready context export for refactoring. Goal: a real understanding of *code structure* (calls, imports,
> table reads/writes, impact radius) that goes beyond what DevBrain currently does — chunking code into RAG
> embeddings (`codeChunker.ts`) and free-text search. Not restricted to one project or one language family:
> **primary pilot target is NT Billing** (`ntbilling` project — Perl/Bash/Oracle+Postgres SQL, matches the
> spec's exact language list), but the engine is a per-language pluggable parser registry from day one so any
> tracked project (and future languages) can be indexed the same way.
>
> The original spec assumed a pure-Python implementation (`requirements.txt`, `python -m code_intelligence.cli`,
> KuzuDB/SQLite). DevBrain's server is 100% Node/TypeScript with **zero Python in the runtime** and a single
> Postgres+pgvector datastore as a stated architectural principle — so this phase re-shapes the spec onto
> existing DevBrain infrastructure rather than following it verbatim. Confirmed with the user 2026-08-13:
> (1) target is all projects, extensible beyond Perl/Oracle/Python, NT Billing first; (2) Perl + SQL parsing
> via a Python subprocess bridge; (3) graph stored in Postgres tables, not a new embedded DB engine.

### Decided

- **Reuse, don't reinvent, for Python/Bash/TS/JS**: `server/services/codeChunker.ts` already loads
  `web-tree-sitter` + `tree-sitter-wasms` grammars for `python`, `bash`, `typescript`, `javascript` (and 12
  others) — this phase's parsers for those languages call into the *same* loaded-`Language`/`Parser` machinery
  (extracted into a shared helper, not copy-pasted) to walk the AST for `function_definition`/`class_definition`/
  `call`/`import`-shaped nodes, rather than adding a second tree-sitter binding path. Zero new npm dependency for
  these four languages.
- **Perl + SQL (Postgres/Oracle) via a Python subprocess bridge**, following the *exact* existing precedent of
  `parseWithMarkItDown()` in `server/services/parser.ts` (`execAsync('python server/scripts/markitdown_bridge.py
  ...')`, try/catch → `null` on failure, `console.warn`, caller falls back gracefully) — this is already
  DevBrain's established pattern for "optional local Python dependency, JS-side degrades cleanly if it's
  missing" (see Known Risks: "Python environment missing → JS fallbacks... markitdown preferred but optional").
  Two new scripts alongside the existing `markitdown_bridge.py`/`apprise_client.py`/`digest_scheduler.py`:
  - `server/scripts/sql_bridge.py` — uses `sqlglot` (already the right tool for dialect-aware Postgres *and*
    Oracle parsing; no viable Node equivalent exists at comparable quality) to extract tables read/written and
    `CREATE OR REPLACE PROCEDURE/FUNCTION` definitions. `sqlglot` added to the existing shared
    `server/scripts/requirements.txt`.
  - `server/scripts/perl_bridge.py` — regex/heuristic extraction (`sub <name>`, `use`/`require`, DBI
    handles, embedded SQL strings) rather than shelling out to real Perl + the CPAN `PPI` module — `PPI` is
    itself a Perl library, so using it would add a *third* runtime dependency (Perl) on top of Node+Python for
    marginal v1 gain. Noted as a future upgrade path (either real `PPI` via a Perl subprocess, or
    `tree-sitter-perl` if/when a prebuilt wasm grammar becomes available), not blocking v1.
  - Both scripts communicate via a single JSON object on stdout (entities + relationships, matching the Unified
    Entity/Relationship schema below) — one process spawn per file, same cost model `markitdown_bridge.py`
    already accepts.
  - `.pl`/`.pm` → `perl`, `.sql` → `sql`/`postgres`, `.spc`/`.bdy`/`.pks`/`.pkb` → `plsql`/`oracle` extension
    mapping **already exists** in `parser.ts`'s `CODE_EXT_LANGUAGE` (added ahead of this phase, presumably
    anticipating NT Billing) — reused as-is for dispatch, not redefined.
- **Storage: new Postgres tables, not KuzuDB/SQLite.** `server/db/migrations/add_code_intel_graph.ts` (mirroring
  the existing migration + `schema.sql`-mirror convention) adds:
  - `code_nodes (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, file_path TEXT,
    language TEXT, entity_type TEXT, name TEXT, signature TEXT, docstring TEXT, start_line INT, end_line INT,
    content_hash TEXT, updated_at TIMESTAMPTZ)` — `id` is `file_path::entity_type::entity_name` per the
    original spec's Unified Entity Schema.
  - `code_edges (source_id TEXT REFERENCES code_nodes(id) ON DELETE CASCADE, target_id TEXT REFERENCES
    code_nodes(id) ON DELETE CASCADE, relationship_type TEXT, PRIMARY KEY (source_id, target_id,
    relationship_type))` — `relationship_type` enum: `CALLS | IMPORTS | READS_TABLE | WRITES_TABLE | INCLUDES`.
  - Indexes on `code_nodes(project_id)`, `code_nodes(file_path)`, `code_edges(target_id)` (for fast
    caller-lookups, the most common traversal direction).
  - `get_callers`/`get_callees` are flat indexed lookups; `get_impact_tree(entity_id, depth)` is a single
    `WITH RECURSIVE` CTE over `code_edges` — no new query engine needed. Also unlocks future semantic code
    search "for free" later: `code_nodes.docstring`/`signature` can be embedded into the existing pgvector
    pipeline as a follow-up, without a second database to keep in sync.
- **Decoupled indexing job, not request-path work** — mirrors the existing precedent of `tasks-watcher.ts`'s
  chokidar watcher on a project's `fs_path`. Two trigger modes:
  1. **v1 (this phase): on-demand CLI.** `server/scripts/index-code-graph.ts` (tsx-runnable, same pattern as
     `seed.ts`), invoked as `npx tsx server/scripts/index-code-graph.ts --project ntbilling` (resolves the
     project's existing `projects.fs_path` column — already populated/used by [[Phase 37]]'s on-disk file
     editor) or `--dir <path>` for an arbitrary directory. Walks the tree respecting `.gitignore`-style excludes
     (reuse the `ignore` npm package already a server dependency), dispatches each file by extension to the
     right parser, and upserts into `code_nodes`/`code_edges`.
  2. **Explicitly deferred, not in this phase's scope:** hooking incremental re-index into the existing
     `fs_path` chokidar watcher for near-live graph updates. Ship the batch CLI first and prove correctness
     before wiring it into a live watcher.
- **API surface, no new UI yet.** `server/routes/code-intel.ts`: `GET /api/code-intel/:projectId/nodes?search=`,
  `GET /api/code-intel/:projectId/callers/:entityId`, `.../callees/:entityId`, `.../impact/:entityId?depth=`,
  and `.../context/:entityId` (returns the entity's own source plus signatures of immediate callers/callees as
  Markdown — the spec's "LLM refactor context" output, implemented as an API response format rather than a
  CLI-only feature so the client can use it later). Read-only endpoints, `requireAuth` + project-scoped like
  every other route. A client-side graph browser/UI is **out of scope for this phase** — ship engine + API +
  CLI, revisit UI as its own phase once the underlying data is proven useful.
- **Not building**: KuzuDB or SQLite (superseded by the Postgres decision above); a `requirements.txt` at repo
  root (Python deps stay scoped to the existing `server/scripts/requirements.txt`, since this is still an
  optional bridge, not a core runtime dependency); any automated code-*modification*/refactoring — this phase
  is read-only analysis and context export only.
- **Column-level SQL lineage, not just table-level** — added after review 2026-08-13: table-level
  `READS_TABLE`/`WRITES_TABLE` alone can't answer "how many columns does this touch" or "which column did this
  value come from." `code_edges` gains a `columns TEXT[]` array (nullable — populated only for `READS_TABLE`/
  `WRITES_TABLE` edges) from `sql_bridge.py`'s use of `sqlglot`'s column-lineage support, which walks joins/
  CTEs/subqueries to attribute output columns back to source table+column. Lineage accuracy is capped by how
  much schema info `sqlglot` has — see the schema-registry item below; without it, `SELECT *` and ambiguous
  joined columns can't be fully resolved and are recorded with `columns: null` (unknown), not guessed.
- **Schema registry, designed now so future table definitions plug in without rework** — new
  `code_schema_tables (project_id, table_name, PRIMARY KEY (project_id, table_name))` and
  `code_schema_columns (project_id, table_name, column_name, data_type, PRIMARY KEY (project_id, table_name,
  column_name))` tables. Empty at ship time (this phase does not require you to supply definitions up front —
  the SQL parser works structurally without them, just less precisely on `SELECT *`/ambiguous columns). When
  populated later (manually, or via a follow-up DDL-file import), `index-code-graph.ts` loads the project's
  schema and passes it to `sql_bridge.py` as `sqlglot`'s `schema=` argument, which sharpens column-lineage
  resolution and lets `getContext`/impact-tree output flag "references unknown table/column" as a bonus
  correctness check. No `code_nodes`/`code_edges` shape changes needed when this gets populated — it's a pure
  accuracy upgrade to the same SQL bridge.
- **Explicit cross-file/cross-language link-resolution pass** — added after review 2026-08-13: the original
  per-file parser design would only produce *intra-file* structure (e.g. Perl's `perl_bridge.py` finds an
  embedded SQL string, but never says what stored procedure it targets). Indexing is two passes:
  1. **Pass 1 (extraction)**: every parser, per file, emits `code_nodes` plus a list of *unresolved call
     references* — `{ fromEntityId, rawTargetName, kind: 'call' | 'sql_exec' | 'script_invocation' }` — instead
     of only fully-formed edges. This covers ordinary function calls, Perl embedded-SQL execution (`$dbh->do(...)`
     /`prepare(...)->execute()` targeting a procedure name), and Bash script/procedure invocations (`psql -f
     script.sql`, `sqlplus @script.sql`, `psql -c "CALL proc(...)"`).
  2. **Pass 2 (resolution)**, run once per indexing job after all files are parsed: for each unresolved
     reference, look up `rawTargetName` against the full set of `code_nodes` just written (by `name`, with
     `file_path`/`language` as tiebreakers for duplicate names), and write the resulting edge (`CALLS` for
     ordinary/procedure calls, `INCLUDES` for script invocations). This is what actually answers "which process
     calls this SQL procedure," across the Perl→SQL and Bash→SQL boundary, not just within one language.
  3. **References that don't resolve are kept, not dropped** — stored in a new `code_unresolved_refs
     (project_id, from_entity_id, raw_target_name, kind, reason)` table and surfaced in the CLI summary output
     and a new API endpoint (`GET /api/code-intel/:projectId/unresolved`). Static analysis over legacy Perl/Bash
     will genuinely miss some calls (dynamic dispatch, variable-built SQL, includes via a variable path) — the
     plan is to make that visible rather than silently produce a graph that looks complete but isn't.

### Tasks

- [x] Scaffold `server/services/codeIntel/` — done 2026-08-13: `types.ts` (Unified Entity/Relationship types —
      `CodeNode`/`CodeEdge`/`UnresolvedRef`/`ParseResult`, `buildNodeId()` helper, `language`/`entityType` kept
      as plain strings on purpose so new languages/entity kinds don't need a type change), `parsers/base.ts`
      (the `BaseParser` interface individual language parsers will implement — no language parsers themselves
      yet, that's later Phase 40 tasks), `storage.ts` (`upsertNodes`/`upsertEdges`/`insertUnresolvedRefs`/
      `clearProjectGraph` writes; `getCallers`/`getCallees`/`getImpactTree` reads — the latter a
      `WITH RECURSIVE` CTE walking callers-of-callers up to a depth limit). `tsc --noEmit` and `eslint` both
      clean.
- [x] `server/db/migrations/add_code_intel_graph.ts` — done 2026-08-13: creates `code_nodes`, `code_edges`
      (with `columns TEXT[]`, `relationship_type` CHECK-constrained to the 5-value vocabulary), `code_schema_tables`,
      `code_schema_columns` (composite FK to `code_schema_tables`), `code_unresolved_refs` + indexes on
      `code_nodes(project_id/file_path)` and `code_edges(source_id/target_id)`. Mirrored into `schema.sql`
      after `task_tree_cache`, matching [[Phase 38]]'s `add_note_file_type.ts` convention. Run against the
      local dev DB (`devbrain-postgres-1`), verified idempotent on a second run, and `\d` confirms all FKs/
      CHECK constraints landed as designed.
- [x] `parsers/treeSitterParser.ts` — done 2026-08-13. Extracted the actual grammar-loading machinery
      (`LANGUAGE_WASM`/`loadLanguage`/`ensureInit`) out of `codeChunker.ts` into a new shared
      `server/services/treeSitterLoader.ts` (`getParser(language)`), which `codeChunker.ts` now imports instead
      of owning its own copy — zero behavior change, its existing 19 tests still pass unmodified.
      `codeIntel/parsers/treeSitterParser.ts` implements `BaseParser` for `python`/`typescript`/`javascript`/
      `bash` on top of that shared loader: a small per-language `LangConfig` table (function/class/call/import
      node-type predicates + callee/import-target extraction) drives one generic recursive walk, rather than
      branching per language throughout — same spirit as `codeChunker.ts`'s `BOUNDARY_RE`. Every file gets one
      `entityType: 'script'` node representing the file itself (so top-level calls/imports outside any function
      have somewhere to attach as `fromEntityId`, and bash `INCLUDES` edges have a target once link resolution
      exists). Calls and imports are emitted as `UnresolvedRef`s (Pass 1 only — resolving them into real edges
      is [[Phase 40]]'s later `linkResolver.ts` task), **not** resolved here. Language is inferred from the file
      extension via `parser.ts`'s `CODE_EXT_LANGUAGE` (exported for this reuse, not redefined). Added
      `'import'` to `UnresolvedRefKind` and widened `code_unresolved_refs`'s `kind` CHECK constraint to match
      (`add_code_intel_graph.ts` updated in place with an explicit `ALTER ... DROP/ADD CONSTRAINT` step, since
      it had already been run once this session — re-ran it, confirmed via `\d` that the wider constraint
      landed). 9 new tests (`tests/services/codeIntel/treeSitterParser.test.ts`) covering Python function/
      class/method extraction, docstring capture, TS import+call extraction, Bash function+command extraction,
      unsupported-language and syntax-error fallback, and the extension-based `BaseParser` dispatch. Full suite:
      75 files / 1242 passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] `server/scripts/sql_bridge.py` + `sqlglot` added to `server/scripts/requirements.txt` — done 2026-08-13.
      `python sql_bridge.py <file> --dialect postgres|oracle [--schema '<json>']`, JSON on stdout:
      `{nodes, edges, unresolved_refs}` (the last always `[]` for now — inter-procedure `CALLS` detection is a
      future refinement, not in scope here). Verified against real `sqlglot` installed locally (not guessed
      from memory) — this surfaced several real bugs, all fixed and re-verified against fixture files before
      considering this done:
      - **sqlglot cannot reliably parse a full Oracle `IS/AS ... BEGIN ... END;` procedure body** — confirmed
        empirically: a real `UPDATE` inside a `BEGIN` block was silently dropped from the parse tree entirely.
        So this script never trusts sqlglot to decompose a procedure body on its own. It finds entity
        boundaries itself — regex + BEGIN/END depth-counting for Oracle-style bodies (distinguishing a closing
        bare `END` from a qualified `END IF`/`END LOOP`/`END CASE`, which closes an inner construct, not the
        block), or `$$`-tag matching for Postgres-style ones — then re-splits the body into individual leaf
        statements with its own quote/comment-aware semicolon splitter and feeds each to `sqlglot`
        *individually*. A leaf statement that still fails to parse falls back to regex-based table-name
        scanning for just that one statement (`columns: null`, tables-only) rather than losing the whole file.
      - **Column-level detail deliberately avoids `sqlglot.optimizer.qualify()`** — it raised `OptimizeError`
        on a perfectly ordinary `INSERT INTO x SELECT ... FROM y` during testing. Column attribution instead
        reads the raw (unqualified) parse tree directly: single-table statements attribute all columns
        unambiguously; multi-table statements attribute columns already qualified in the source
        (`alias.column`) via the statement's own alias->table map, and — when `--schema` is supplied — also
        resolve unqualified columns that match exactly one of the statement's tables' known columns (0 or 2+
        matches stays unresolved, not guessed). `SELECT *` expands to a table's full column list only when
        `--schema` names that table and exactly one table is involved.
      - **`SELECT ... INTO local_var FROM ...` (Oracle) wraps the INTO target as an `exp.Table`** — was showing
        up as a bogus extra table; excluded by checking `isinstance(t.parent, exp.Into)`.
      - **Procedure parameters referenced bare in the body parse as columns** — sqlglot has no notion of
        PL/SQL parameter scope. Parameter names are extracted from the entity's own header (paren-depth-aware
        split, so `NUMBER(10,2)`-style type declarations don't break it) and filtered out of every column list
        for that entity. Local `DECLARE`d variables are NOT covered by this — an acknowledged, undocumented
        case beyond `extract_param_names()`'s reach that inflates local-variable-name pollution in rare cases.
      - **`INSERT INTO x (a, b) VALUES (...)`'s target column list is plain `Identifier`s under a `Schema`
        node, not `exp.Column`** — invisible to the general column scan; read separately and merged into the
        write-table's edge.
      - **Line-number tracking bug**: the statement splitter's `start_line` froze at the previous statement's
        terminator instead of tracking forward past blank/comment lines to the next statement's real start —
        fixed by only locking `start_line` on the first non-whitespace character since the last `;`.
      - **Standalone `/` (SQL*Plus batch terminator)** — ubiquitous between `CREATE PROCEDURE`/`FUNCTION`
        blocks in real Oracle scripts (the actual NT Billing file format) — was gluing onto the next statement
        and breaking its parse (falling back to regex, losing column detail) or skewing its line number.
        Now skipped as a no-op when it's the sole content of its line.
      Verified against three hand-written fixtures (an Oracle procedure+function file with nested `IF`,
      `SELECT INTO`, and a trailing top-level `SELECT *`; a Postgres `$$`-quoted function with a subquery and a
      join; a plain multi-statement file with one deliberately-broken statement to confirm partial-failure
      resilience) plus empty-file, missing-file, and invalid-`--schema` error paths — all produce correct,
      well-formed JSON. No Node/TS code touched by this task; `pythonBridgeParser.ts` (later task) is what
      calls this script and persists its output.
- [x] `server/scripts/perl_bridge.py` — done 2026-08-13. `python perl_bridge.py <file>`, same
      `{nodes, edges, unresolved_refs}` JSON-on-stdout contract as `sql_bridge.py`. No `sqlglot`/new
      dependency — pure stdlib regex, deliberately (Perl has no realistic regex-only full parse; Phase 40
      already chose regex/heuristic over shelling out to real Perl + CPAN's `PPI` to avoid a third language
      runtime). Finds `sub NAME { ... }` boundaries via a quote/comment-aware brace-depth counter (mirrors
      `sql_bridge.py`'s BEGIN/END counter, scoped to Perl's `'`/`"`/`#`); scans each sub's body (and top-level
      gaps between subs, where `use`/`require` almost always live) for `use`/`require` (kind: `'import'`),
      plain bareword calls not preceded by `->` and not a Perl keyword/builtin (kind: `'call'`, denylist of
      ~60 keywords to avoid `if(...)`/`print(...)` false positives), and `->do(...)`/`->prepare(...)` DBI
      calls with a quoted SQL argument — classified as `'sql_exec'` (targets a stored procedure, matched via
      `EXEC`/`CALL`/anonymous-block patterns) or a direct `READS_TABLE`/`WRITES_TABLE` edge (plain DML,
      table-only via regex, no column-level detail — an embedded string with `?` placeholders isn't a
      complete statement a real SQL parser handles well, so this doesn't pretend AST-level precision on it).
      No fixture-testing tool available for this one (no `sqlglot`-equivalent to cross-check against) — relied
      on hand-written fixtures and reasoning through each match instead, which caught three real bugs before
      calling it done:
      - **Bareword table/column names *inside SQL string literals* were matching the plain-call scan** — e.g.
        `"INSERT INTO audit_log (acct_id...)"` reported a false call to `audit_log`. Fixed by masking string/
        comment contents (blanked, not removed — offsets stay valid) before the `use`/`require` and call scans
        run; DBI extraction still reads the real, unmasked text (it needs the actual SQL content).
      - **`for my $i (1..$x)` matched as a call to `i`** — `$` isn't a word character, so a bare `\b` word
        boundary is satisfied right after it. Fixed with a `(?<![$@%])` negative lookbehind excluding any
        identifier immediately preceded by a sigil.
      - Confirmed `->method(...)` calls (including non-DBI ones like `$self->calculate_total()`) are correctly
        excluded from plain-call detection, nested braces (hash literals, `if`/`for` blocks) don't break sub
        boundary detection, and escaped quotes (`\"`) inside a string don't break the scanner.
      Verified against two hand-written fixtures (a DBI-heavy one — two subs, procedure call via `EXEC`, plain
      `INSERT`/`SELECT`/`UPDATE` via `->do`/`->prepare`, cross-sub call, module import; one testing nested
      braces/comments/escapes/non-DBI method calls) plus empty-file, missing-file, and no-subs-at-all cases —
      all produce correct, well-formed JSON.
- [x] `parsers/pythonBridgeParser.ts` — done 2026-08-13. Runs `sql_bridge.py` (dialect: `plsql` language ->
      `oracle`, else `postgres`) or `perl_bridge.py` depending on the file's `CODE_EXT_LANGUAGE`, parses the
      JSON, and normalizes it into `CodeNode[]`/`CodeEdge[]`/`UnresolvedRef[]` — same optional-Python,
      try/catch → `console.warn` → graceful-empty-result fallback as `parseWithMarkItDown()`.
      **Deliberately uses `execFile` (argv array), not `exec`** like `parseWithMarkItDown()`'s existing call —
      `exec` runs through a shell, so a file path or `--schema` JSON containing shell metacharacters
      (`` $(...) ``, backticks, `;`) would be a real command-injection vector once string-interpolated into a
      shell command; `execFile` never invokes a shell, so this is immune to that regardless of what characters
      either argument contains. Pre-existing `exec()` calls elsewhere weren't touched (out of scope for this
      task) — this is about not *introducing* the same class of issue in new code.
      **Correction, 2026-08-13, found while researching item 9**: the script paths were originally
      `'server/scripts/sql_bridge.py'`/`'.../perl_bridge.py'`, matching `parseWithMarkItDown()`'s existing
      convention — but `devbrain.sh`/`.ps1` both `cd server` before `npm run dev`, and the Docker image's
      `WORKDIR` is `/app` mapped from the `server/` directory, so the *running server*'s cwd is always
      `server/`, never the repo root. A `'server/scripts/...'` path from that cwd resolves to
      `server/server/scripts/...`, which doesn't exist — `parseWithMarkItDown()` almost certainly has this
      exact bug already (out of scope to fix here; not this task's file). Fixed in this module by resolving
      `SQL_BRIDGE`/`PERL_BRIDGE` from `pythonBridgeParser.ts`'s own file location via `import.meta.url`
      (mirroring how `treeSitterLoader.ts` already resolves its wasm directory via `require.resolve`, not a
      cwd-relative guess) instead of a cwd-relative string — correct regardless of the caller's own cwd, which
      matters because this module has two different callers with two different cwds: the running server
      (`server/`) and `index-code-graph.ts`, a standalone CLI whose cwd depends on wherever a human invokes it
      from. Updated the two dispatch tests that had been asserting the old (wrong) path string to compute and
      check the real resolved absolute path instead.
      **Closed the schema gap flagged when building `sql_bridge.py` (item 4)**: `READS_TABLE`/`WRITES_TABLE`
      edges name a table, but tables aren't discovered as entities by any parser and `code_edges.target_id`
      has an FK to `code_nodes`. Resolved by treating a table as a first-class `entityType: 'table'` node,
      synthesized here (not by the Python scripts, which only know raw table names) via a new
      `buildTableNodeId(projectId, tableName)` in `types.ts` — deliberately a different id shape from
      `buildNodeId()` (no `filePath` component, since e.g. `accounts` referenced from ten different files must
      resolve to the *same* one node, unlike a function/class id which is legitimately file-scoped). This
      needed `code_nodes.file_path`/`start_line`/`end_line`/`content_hash` to become nullable (a referenced-
      but-never-`CREATE TABLE`-defined table has none of those) — `add_code_intel_graph.ts` amended in place
      again (still un-shipped beyond this session's own local DB) with explicit `ALTER COLUMN ... DROP NOT
      NULL` statements, `schema.sql` and `types.ts`'s `CodeNode` updated to match, re-run and verified via `\d`.
      Every file also gets the same one `entityType: 'script'` node `treeSitterParser.ts` already gives its
      files, so a bridge's `from_entity_name: null` (file-scope, not any specific entity) has something to
      resolve to — keeps the "every file has exactly one file-level node" invariant consistent across every
      parser, tree-sitter- and bridge-based alike.
      Entity content hashes are computed by slicing `source` with the bridge-reported `start_line`/`end_line`
      (the bridges report line ranges, not byte offsets — they're not doing an AST parse with node spans the
      way `treeSitterParser.ts` is).
      12 new tests (`tests/services/codeIntel/pythonBridgeParser.test.ts`), `node:child_process` mocked the
      same way `tests/services/parser.test.ts` already mocks it for `markitdown_bridge.py` (CI shouldn't need
      Python/`sqlglot` installed to run this suite — the bridge scripts' *own* correctness was already verified
      against a real local Python+`sqlglot` install while building them, items 4-5) — covering file/entity/
      table-node construction, table-node de-duplication across multiple edges, dialect selection, `--schema`
      pass-through, `from_entity_name: null` resolution, graceful degradation on process failure and malformed
      JSON, and the extension-based dispatch (including that an unrecognized extension never even invokes the
      bridge). Full suite: 76 files / 1253 passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] `parsers/bashParser.ts` — done 2026-08-13. Layers SQL-client invocation detection on top of
      `treeSitterParser.ts`'s generic bash extraction (calls `extractEntitiesForLanguage(..., 'bash')` for the
      base pass, then does its own second tree-sitter walk reading `psql`/`sqlplus` commands' actual argument
      nodes — deliberately AST-based, not regex-over-raw-text: a `sqlplus -s user/pass@db @job.sql` connection
      string contains `@` too, just not as the script-invocation token, which a naive `@\S+` regex over raw
      text would get wrong but reading the real sibling argument nodes off the parsed command doesn't).
      **Refined the `kind` classification from this item's original one-line description** (which said
      `psql -c`'s inline SQL becomes `kind: 'script_invocation'` same as `-f`) **after actually building it**:
      `-f <file>`/`@<file>` (a real script/file reference) stays `'script_invocation'`; `-c "<sql>"` is instead
      classified exactly like `sql_bridge.py`/`perl_bridge.py` already classify embedded SQL — a procedure call
      (`EXEC`/`CALL`/anonymous-block pattern) becomes `'sql_exec'` (the same semantic event as Perl's embedded
      DBI procedure calls, just a different host language), and plain DML becomes a direct `READS_TABLE`/
      `WRITES_TABLE` edge with a `'table'` node via `buildTableNodeId()` (table-only, no columns — same
      reasoning as `perl_bridge.py`: a string embedded in another language isn't a complete statement worth
      pretending AST-level column precision on). This wasn't a late change of mind — the original Decided
      section that introduced this task already grouped `psql -c "CALL proc(...)"` with the other
      procedure-call cases; the later one-line task bullet was just imprecise in simplifying it down to a
      single `kind`.
      Generic bash extraction already reports a `psql`/`sqlplus` line as a `kind: 'call'` ref to the bare
      command name (not useful — it never resolves to anything) — filtered out and replaced with this module's
      precise refs, not left duplicated alongside them.
      **Two id-consistency traps found and fixed during review, before any test caught them**: this module's
      own tree-sitter walk needs to attribute refs to the *same* function/file node ids
      `extractEntitiesForLanguage`'s base pass already produced (`code_unresolved_refs.from_entity_id` has a
      real FK to `code_nodes.id` — a mismatched id isn't cosmetic, it's an insert-time failure). Recomputing
      those ids independently here was the first instinct and is fragile — `treeSitterParser.ts`'s name
      extraction has a fallback path (searches for an identifier/word child when the AST's `name` field itself
      is absent) that a bare `childForFieldName('name')` read here wouldn't mirror, and any divergence goes
      undetected until the DB rejects the row. Fixed by reading both ids back from `base.nodes` instead of
      recomputing them — the file node directly (`entityType === 'script'`), function nodes via a
      `startLine -> id` lookup built from `base.nodes` before this module's own walk runs — immune by
      construction to ever drifting out of sync with however `treeSitterParser.ts` builds those ids.
      8 new tests (`tests/services/codeIntel/bashParser.test.ts`), against the real tree-sitter-bash grammar
      (no mocking needed — local WASM, not a subprocess) — covering `-f` script_invocation, `-c` sql_exec
      classification, `-c` plain-DML table-edge classification, the `sqlplus`/connection-string `@`
      disambiguation, top-level (no enclosing function) attribution to the file node, confirming the generic
      `psql`/`sqlplus` call ref is gone (not duplicated), non-SQL-client generic call detection staying
      untouched, and `BaseParser` conformance. Full suite: 77 files / 1261 passed + 1 skipped. `tsc --noEmit`
      and `eslint` both clean.
- [x] `analyzer/linkResolver.ts` — done 2026-08-13. `resolveLinks(projectId, refs)`: loads every `code_nodes`
      row for the project (new `storage.ts` read, `getProjectNodeSummaries` — id/name/entity_type/language/
      file_path only, not full signature/docstring text for nodes that mostly won't even match), groups by
      `name`, and for each `UnresolvedRef`:
      - Filters candidates by whether the ref's `kind` could even target that `entity_type` —
        `call`→function/subroutine/procedure, `sql_exec`→procedure/function *and* `language` must be
        `sql`/`plsql` (this is what stops `sql_exec` from ever matching a same-named Python function — verified
        by a test with both present), `import`/`script_invocation`→`script`. `READS_TABLE`/`WRITES_TABLE` never
        go through this path at all — parsers already emit those as direct edges, since a table name is
        unambiguous the moment it's known.
      - 1 candidate → resolved, `kind`→`relationship_type` (`call`/`sql_exec`→`CALLS`, `import`→`IMPORTS`,
        `script_invocation`→`INCLUDES`). 0 candidates → unresolved, `reason: 'no matching name'`.
      - 2+ candidates → tiebreak by preferring whichever one shares the calling entity's own `file_path`
        (e.g. a locally-defined `helper` beats an unrelated file's same-named `helper`); still 0 or 2+ after
        that → unresolved, `reason: 'ambiguous — N matches'`.
      - `import`/`script_invocation` targets are often a path, not a bare name (`'../db/pool.js'`,
        `'nightly_job.sql'`) — falls back to matching the raw target's own basename when the exact string
        doesn't match anything (a file-level `'script'` node's `name` is always just its basename already).
        Deliberately not full relative-path module resolution (a real project's directory layout isn't visible
        from this pass) — a known, accepted limit on import-resolution accuracy, consistent with every other
        "surfaced, not silently wrong" limitation across this phase.
      Resolved refs become `CodeEdge`s via `upsertEdges`; the rest get `reason` attached and go to
      `insertUnresolvedRefs` (extended to actually persist the `reason` column, which the item-2 migration
      already had but nothing wrote to yet) — nothing is dropped either way. Added `reason?: string` to
      `UnresolvedRef` in `types.ts`, set only by this module.
      10 new tests (`tests/services/codeIntel/analyzer/linkResolver.test.ts`), `storage.ts` mocked at the
      function boundary (same pattern `tests/services/embeddingHealthSnapshot.test.ts` already uses for its
      own direct dependency) — covering single-match resolution for each of the four kinds, entity-type/
      language filtering (the sql_exec-vs-Python-function case), no-match and genuine-ambiguity reasons, the
      same-file tiebreak actually breaking a tie, the empty-input short-circuit (touches no storage function at
      all), and a mixed batch partitioning correctly into edges vs. unresolved refs. One real bug this caught
      before it shipped: two ambiguity-tiebreak tests initially omitted the calling entity itself from the
      mocked node list — in real indexing it's always present (Pass 1 writes every node before Pass 2 runs),
      and omitting it accidentally made the tiebreak look like it worked for the wrong reason (no source found
      at all, rather than a real same-file check). Fixed the fixtures, not the implementation — this was a test
      gap, not a code bug. Full suite: 78 files / 1271 passed + 1 skipped. `tsc --noEmit` and `eslint` both
      clean.
- [x] `server/scripts/index-code-graph.ts` — done 2026-08-13. `npx tsx scripts/index-code-graph.ts --project
      <shortName> [--dir <path>]`, run from `server/`. `--project` is always required (it's what supplies
      `project_id`, a real `NOT NULL` FK on every `code_nodes` row) — `--dir`, when given, overrides *which*
      directory gets walked without touching the project's own stored `fs_path`; without it, `fs_path` is
      used. This is a clarification of the original one-line description (which read as `--project`/`--dir`
      being alternative modes) made concrete against the actual schema.
      **Researched the codebase's own conventions before building this rather than guessing**: no reusable
      recursive walker existed to reuse (`routes/project-files.ts`'s directory browsing is single-level,
      client-driven recursion, not a real walker) — wrote one. Reused `project-files.ts`'s `ignore`-seeding
      pattern (root `.gitignore` + hardcoded `.git`), but added `node_modules`/`.venv`/`__pycache__`/`dist`/
      `build`/`vendor` as further hardcoded excludes, deliberately going beyond that precedent — browsing a
      directory listing is harmless either way, but this walker *parses* every file it finds, so silently
      descending into a vendored dependency tree isn't just slow, it pollutes the graph with irrelevant code.
      **A real, valuable bug found and fixed while researching this** (not scope creep — directly relevant,
      since this script is one of `pythonBridgeParser.ts`'s two callers): both `devbrain.sh`/`.ps1` `cd server`
      before `npm run dev`, and the Docker image's `WORKDIR` is `/app` mapped from `server/` — so the running
      server's cwd is always `server/`, never the repo root, which means `pythonBridgeParser.ts`'s original
      `'server/scripts/sql_bridge.py'` path (copied from `parseWithMarkItDown()`'s existing convention) was
      wrong, and `parseWithMarkItDown()` itself almost certainly has the same latent bug (out of scope to
      touch). Fixed by resolving both script paths from `pythonBridgeParser.ts`'s own file location instead —
      see that item's entry above for the full writeup.
      Full pipeline per file: read → dispatch via `CODE_EXT_LANGUAGE`+per-language parser registry (bash always
      resolves to `bashParser`, not `treeSitterParser`, even though `treeSitterParser.ts` also technically
      covers bash internally — `bashParser.ts` wraps and enhances it, [[item 7]]) → for `sql`/`plsql` files,
      calls `extractEntitiesWithSchema` with the project's `code_schema_columns` (loaded once up front; empty/
      absent is fine, same graceful-without-schema behavior `sql_bridge.py` already has) instead of the plain
      dispatch. `clearProjectGraph` runs first (always a full fresh rebuild — no incremental mode yet,
      deliberately deferred per this phase's own "Decided" section); one `upsertNodes`/`upsertEdges` call each
      at the end over everything collected across the whole run (**"batched" interpreted as "collect the whole
      project then write once," not literal SQL multi-row inserts** — `storage.ts`'s upsert functions already
      loop one row per query, a deliberate existing simplicity choice from item 1 this task didn't retroactively
      expand); `resolveLinks` runs last over every file's accumulated `unresolvedRefs`. A single file's read or
      parse failure is caught and recorded in the summary's `skipped` list with a reason, not fatal to the run.
      **Refactored for testability before writing tests**: the script's logic lives in an exported
      `runIndexer(rootDir, projectId, schema)`; `main()` (arg parsing, DB lookups, printing) is guarded by
      `if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)` — the Node ESM equivalent of
      Python's `if __name__ == '__main__':` — so importing `runIndexer` from a test doesn't trigger a real run
      (including a real `pool.end()`) as a side effect of the import itself. Verified the guard against the
      real risk of a naive `` file://${process.argv[1]} `` string comparison silently failing on Windows
      (backslashes, missing the extra `file:///` slash) by using `pathToFileURL` instead and actually running
      the script directly (`npx tsx scripts/index-code-graph.ts`, no args) to confirm the usage message prints
      and it exits 1, rather than trusting the guard unverified.
      8 new tests (`tests/scripts/index-code-graph.test.ts`) — real temp directories via `fs.mkdtemp` (same
      convention `tests/services/parser.test.ts` already uses for filesystem-touching tests), with `storage.ts`/
      `linkResolver.ts`/the three parser modules/`db/pool.js` all mocked at their boundaries. Covers:
      `clearProjectGraph` runs first, correct per-extension dispatch including recursion into subdirectories,
      `node_modules` and `.gitignore`-listed files never reaching any parser, an unrecognized extension landing
      in `skipped` rather than counted as parsed, schema-aware dispatch when a schema is supplied, aggregation
      of nodes/edges/refs across multiple files into single batched writes, per-language counts in the summary,
      and one file's parse failure not stopping the rest of the run. One real test-fixture bug caught before
      shipping (not an implementation bug): an aggregation test initially used `mockResolvedValue` for
      `treeSitterExtractMock`, forgetting the fixture tree has *two* Python files, so the mock fired twice and
      duplicated the expected payload — fixed by differentiating the mock's response by file path. Full suite:
      80 files / 1285 passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] `analyzer/` — done 2026-08-13. `getCallers`/`getCallees`/`getImpactTree` were already fully implemented in
      `storage.ts` back in item 1 — `analyzer/index.ts` re-exports them unchanged as the public query surface
      routes should import from (so `server/routes/code-intel.ts`, next task, never reaches into `storage.ts`'s
      raw SQL directly). `getContext` is the genuinely new piece: fetches the entity, its immediate callers
      (`getIncomingEdgeDetails`, a new `storage.ts` read alongside the existing plain `getCallers` — keeps the
      edge's own `relationship_type`/`columns`, which a bare node list can't carry) and callees
      (`getOutgoingEdgeDetails`), reads the entity's own source by slicing its file on disk at `startLine`/
      `endLine` (nodes don't store full source text, only structural metadata — deliberately, to avoid
      duplicating a document store), and renders all of it as Markdown: source in a fenced code block tagged
      with the entity's language, callers/callees as a bulleted list with relationship type and column detail
      (e.g. "READS_TABLE — columns: id, balance") where present. This is the "LLM refactor context" output
      from the spec that originally kicked off this phase, reshaped as a plain Markdown string so
      `code-intel.ts` can serve it directly rather than it being a CLI-only feature. A `'table'` node (no file
      location) or a source file that's moved/been deleted since indexing both degrade to an explanatory
      placeholder instead of throwing.
      6 new tests (`tests/services/codeIntel/analyzer/index.test.ts`), `storage.ts` and `node:fs/promises`
      mocked at their boundaries — covering not-found handling, full Markdown assembly (docstring, sliced
      source, callers, callees with column detail), empty caller/callee sections, a table node correctly
      skipping the file-read attempt entirely, graceful degradation when the source file can't be read, and
      that the three re-exports genuinely pass through to `storage.ts` unchanged. Full suite: 80 files / 1285
      passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] `server/routes/code-intel.ts` + mounted in `index.ts` — done 2026-08-13. `nodes?search=`, `callers/:id`,
      `callees/:id`, `impact/:id?depth=` (default 3, capped at 10, falls back to the default on a non-integer
      value), `context/:id`, `unresolved` — all six from "Decided" plus the extra `unresolved` endpoint. No
      per-route auth middleware — the app-wide `app.use('/api', requireAuth)` in `index.ts` already covers
      every route mounted after it, same as `runbooks.ts`/`documents.ts`. Checked first whether this app has any
      project-membership ACL beyond that (grepped for it) — it doesn't; RBAC here is role-based, not
      per-project row-level, so this doesn't invent a new restriction beyond existing convention. It does add
      one real check: `callers`/`callees`/`impact`/`context` all fetch the entity via `getNodeById` first and
      404 if it doesn't exist *or* its `projectId` doesn't match the URL's `:projectId` — without this, the
      URL's own two params could silently disagree (query entity X from project A's URL, but X actually
      belongs to project B) and return the wrong project's data.
      Routes only import from `analyzer/index.ts` (added `getNodeById`/`searchNodes`/
      `getUnresolvedRefsForProject` there as re-exports of two new `storage.ts` reads), never reach into
      `storage.ts` directly — keeps the established routes → analyzer → storage layering intact.
      14 new tests (`tests/routes/code-intel.test.ts`), using this codebase's own existing route-testing
      convention (`tests/routes/runbooks.test.ts`) — extracting the handler function straight off the Express
      Router's stack and invoking it with fake req/res, `analyzer/index.js` mocked at the boundary this file
      directly touches. Covers the cross-project 404 check, all six endpoints' happy paths, depth
      default/clamp/invalid-value handling, and the 500 error-envelope path. Full suite: 81 files / 1299
      passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] Unit tests per parser — done 2026-08-13. The four scenarios named here map onto the *actual* shipped
      architecture, not the file names originally guessed before it existed — `python_parser.ts`/
      `bash_parser.ts` were never separate files (python/typescript/javascript/bash all share
      `treeSitterParser.ts`, with `bashParser.ts` layered on top for bash specifically):
      - **"A Python function calling another function in the same file + an import"** — already fully covered
        by `tests/services/codeIntel/treeSitterParser.test.ts` ([[item 3]]), no new file needed.
      - **"A Bash function sourcing another script"** — while writing this test, found that `bashParser.ts`
        had never actually implemented `source`/`.` handling, despite `treeSitterParser.ts`'s original
        comments ([[item 3]]) explicitly flagging it as deferred to this later work. Fixed now: `source foo.sh`
        / `. foo.sh` are extracted as `kind: 'script_invocation'` refs (same treatment as `psql -f`/`sqlplus
        @`, [[item 7]]), replacing the generic (and useless — `rawTargetName: 'source'` resolves to nothing)
        `call` ref the base extraction produces for the same line. 2 new tests in
        `tests/services/codeIntel/bashParser.test.ts` (now 10, from 8).
      - **"A Postgres SELECT/INSERT and an Oracle CREATE OR REPLACE PROCEDURE"** — new
        `tests/scripts/sql_bridge.test.ts`, real subprocess calls to the actual `sql_bridge.py` (not the mocked
        Node wrapper `pythonBridgeParser.test.ts` already covers) — deliberately the opposite mocking choice
        from that file, since the whole point here is exercising the real Python/sqlglot logic.
      - **"A Perl sub with a use and an embedded SQL string"** — new `tests/scripts/perl_bridge.test.ts`, same
        real-subprocess approach against the actual `perl_bridge.py`; also covers the plain-DML-embedded-SQL
        case (a `READS_TABLE` edge, not a `sql_exec` ref) since that path exists in the same script.
      Both new files detect Python/`sqlglot` availability via a synchronous `execSync` check at load time and
      `describe.skipIf(!available)` — skips gracefully (not fails) without it, same optional-dependency
      contract as `markitdown_bridge.py`. Ran for real in this environment (Python + `sqlglot` are installed
      here from items 4-5's development work) — all 4 pass. 6 new tests total. Full suite: 83 files / 1305
      passed + 1 skipped. `tsc --noEmit` and `eslint` both clean.
- [x] **Substitute smoke test done 2026-08-13** — the real NT Billing `fs_path` is still unset (`SELECT fs_path
      FROM projects WHERE short_name = 'ntbilling'` returned empty), so the literal live run against NT
      Billing's actual codebase remains genuinely pending — flagged to the user directly rather than silently
      skipped or faked. **Full pipeline still verified for real** against the real `ntbilling` project row
      (not mocked): a synthetic Perl/Bash/Oracle fixture tree — a `.spc` procedure writing to `accounts`, a
      Perl sub calling it via embedded `EXEC` SQL, a Bash function calling it via `psql -c "CALL ..."` —
      indexed with `index-code-graph.ts --project ntbilling --dir <synthetic tmp dir>` (the `--dir` override
      built for exactly this: exercising the real project id/DB without touching its stored `fs_path`).
      Confirmed via direct SQL against the resulting real rows, then via a live `getContext()` call, that the
      procedure's Markdown context shows **both** the Perl subroutine and the Bash function as `CALLS` callers
      (proving cross-language resolution — "which process calls this SQL procedure" — genuinely works, not
      just in mocked tests) and the `accounts` `WRITES_TABLE` edge with real column detail (`id, status`). The
      2 `use strict`/`use DBI` import refs correctly landed in `code_unresolved_refs` with `reason: 'no
      matching name'` rather than silently vanishing. All synthetic graph rows were deleted from `ntbilling`
      afterward (`code_nodes`/`code_unresolved_refs` confirmed back to 0 rows) so nothing fabricated was left
      in the real project's data. **Still open**: the actual NT Billing source needs `fs_path` linked (Settings
      → link folder, or `UPDATE projects SET fs_path = ...`) before the genuine run against real code can
      happen — nothing else is blocking it once that's done.
- [x] Done 2026-08-13. `README.md`: `server/scripts/` line now lists `sql_bridge.py`/`perl_bridge.py`/
      `index-code-graph.ts` alongside the existing three; added a `services/codeIntel/` sub-line; added a new
      **Code Intelligence graph** bullet under the existing "Code Tracking" features section, explicit that
      it's CLI + read-only API only for now, no client UI. `CLAUDE.md`'s Project Structure tree: added
      `routes/code-intel.ts`, `services/treeSitterLoader.ts`, and a `services/codeIntel/` subtree
      (`types.ts`/`storage.ts`/`parsers/`/`analyzer/`), plus a `scripts/` line (this tree didn't have one
      before this phase).

---

## Phase 41 — CI Coverage Gate & Security Audit Workflow Recovery (2026-08-14)

> The last three pushes to master (all [[Phase 40]]-adjacent bugfixes: oversized-chunk embedding, `/explain`
> truncation/hang, `markitdown_bridge.py`'s cwd bug) had gone green on every individual test but red on CI
> overall — `server/vitest.config.ts`'s coverage thresholds were failing, not any test assertion. Root cause:
> `services/codeIntel/storage.ts` ([[Phase 40]], item 1) had never gotten its own direct test file — it was
> only exercised indirectly through callers that mock it at the boundary — so it sat at flat 0% coverage and
> dragged the global average down, compounded by several pre-existing services/routes with never-exercised
> error-handling and scheduler branches. Separately, and unrelated to any code change, the weekly `Security
> Audit` workflow had failed 3 consecutive Monday runs (2026-07-27, 08-03, 08-10) purely on newly-published
> `npm audit` advisories landing upstream, not on anything in this repo.

### Tasks
- [x] `server/tests/services/codeIntel/storage.test.ts` — new, 21 tests covering every exported function
      (`upsertNodes`/`upsertEdges`/`insertUnresolvedRefs`/`clearProjectGraph`, all the `get*` reads,
      `getImpactTree`'s depth param + depth-sort, null-vs-populated column mapping), mocking `pool.query` the
      same way `tests/services/audit.test.ts` already does. Took the file from 0% to 100% coverage on all four
      metrics — closed the `lines`/`statements` gate (was 96.89%/95.69%, now 97.6%/96.35% against 97%/96%
      thresholds) but left `functions` (93.2% vs 94% required) and `branches` (92.65% vs 93%) still short,
      traced to gaps elsewhere, not this file.
- [x] Closed the `functions` gap (93.2%→94.85%) — new/extended tests exercising previously-dead closures:
      `routes/aitask.ts` (`.catch(() => {})` around a call proven to never reject — see next item, removed
      rather than tested), `routes/export.ts` (both routes' `archive.on('error', ...)` handler, via a real
      `archive.emit('error', ...)` from the mocked `addProjectToArchive`/`buildZipToStream`), `services/
      backup.ts` and `services/embeddingHealthSnapshot.ts` (their `startXScheduler()`'s hourly `setInterval`
      tick, and the case where the advisory-locked tick itself rejects — forced via `pool.connect()` rejecting
      once), and a new `services/issuesShared.test.ts` (`embedIssueAsync` had no direct test file at all;
      5 tests covering the success path and all three of its independent failure-swallowing branches).
- [x] Removed dead code found while chasing the `functions` gap, rather than writing a test for it:
      `routes/aitask.ts`'s two `.catch(() => {})` wrappers around `handleAiTaskDoneNotification(...)` — that
      function already has its own internal try/catch that never rethrows, so the outer `.catch()` could never
      fire under any real input; the two uncovered-function findings were genuinely unreachable code, not a
      test gap, per this project's own "don't add error handling for scenarios that can't happen" convention.
- [x] Closed the `branches` gap (92.65%→93.26%) — new `tests/lib/env.test.ts` (`lib/env.ts` had no test file;
      9 tests covering all four `superRefine` validation branches — missing `ANTHROPIC_API_KEY`/
      `GEMINI_API_KEY`/`AUTH_PASSWORD`, the invalid-env `process.exit(1)` path — plus the `TRUST_PROXY`/
      `CORS_ORIGINS` transform branches; took the file from 50%/45% to 100% branch coverage, the single
      biggest gain of this phase), `tests/lib/errors.test.ts` (production-mode message-masking branch, via
      `vi.mock('../../lib/env.js', ...)` since `env.NODE_ENV` is a load-time singleton), `tests/lib/
      xlsxCompat.test.ts` (both `.default`-fallback branches, via a mocked `xlsx` shape missing the top-level
      API), and `tests/services/tokenChunker.test.ts` (the whitespace-only-window-gets-dropped branch in
      `splitByTokenWindow`) — none of these four `lib`/`services` files had a test file before this phase.
- [x] Verified via a full `npx vitest run --coverage`: statements 96.67%, branches 93.26%, functions 94.99%,
      lines 97.79% — all four above `vitest.config.ts`'s thresholds with real margin, not a bare pass. 1380
      tests passed, 1 skipped, zero regressions. `tsc --noEmit` and `eslint .` both clean (the same 3
      pre-existing coverage-report-artifact and `documents-ai.ts` non-null-assertion warnings as before this
      phase, nothing new). Committed as `5d12bfb`; CI run 31788624622 confirmed all three jobs (Server, Client,
      E2E) green.
- [x] Fixed the weekly `Security Audit` workflow (3 consecutive failing runs, all on genuinely new findings —
      `audit-server`'s allowlist-checking `scripts/audit-check.mjs` flagged `brace-expansion`/`ip-address`/
      `js-yaml`/`nanoid` as high-severity and NOT in the accepted-risk list; `audit-client`'s plain `npm audit
      --audit-level=high` flagged `nanoid`/`undici`). Resolved both via plain `npm audit fix` in `server/` and
      `client/` — semver-compatible transitive bumps only, no `--force`, no direct `package.json` version
      changes (only the two `package-lock.json` files moved). Client fix also incidentally picked up
      `dompurify`/`fast-uri`/`js-yaml`/`mermaid`; only `react-router`/`react-router-dom`'s moderate advisories
      remain (below the client job's high-severity gate) — the workflow's existing accepted-risk comment
      calling that "a v6→v7 major bump, breaking API changes" turned out to be stale: `npm audit fix` resolved
      it inside the already-installed `^6.28.0` range, no major bump involved.
- [x] Verified server (`tsc --noEmit`, full `vitest run --coverage`, unchanged pass/threshold results) and
      client (`tsc --noEmit`, `npm test` — 101/101, `npm run build` — succeeds, output unchanged in shape)
      both still pass after the dependency bump, and that `eslint .` on the client shows the identical 64
      problems (4 pre-existing errors, 60 warnings) before and after via a `git stash`/re-run comparison — the
      bump touched neither eslint itself nor anything it lints. Committed as `74e3567`; manually triggered
      `workflow_dispatch` run 31789474837 confirmed both `audit-server` and `audit-client` jobs green (no need
      to wait for the next Monday schedule to find out).

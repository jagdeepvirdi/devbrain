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

## Known Issues

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

# V2 Roadmap

> Re-scoped 2026-07-17: audited the original "Fix → Test → Backup → Visibility → AI → Git →
> Integrations → Multi-user" pipeline against what's actually shipped. Most of it landed already
> (RBAC, LDAP/AD auto-provisioning, GitHub/Linear/Jira import, local git browsing + commit linking,
> Apprise external notifications, scheduled backup + zip/JSON restore, CI with server tests + client
> typecheck + Playwright e2e). What follows are the specific gaps found — not a full category rebuild.

## CI Coverage Gating

- [ ] Enforce a coverage threshold in `.github/workflows/*.yml`'s server job — `test:coverage`
      (`vitest run --coverage`) already exists but isn't run or gated in CI, so test-depth regressions
      pass silently. Pick a realistic baseline from a fresh coverage run rather than an arbitrary
      round number.

## Backup Retention & Offsite Destination

- [ ] Prune local backup files (older than N days, or keep-last-N) in `server/services/backup.ts` —
      `runBackup()` writes a new dated zip on every scheduled run forever with no cleanup, so
      `backupPath` grows unbounded.
- [ ] Optional remote backup destination (S3-compatible bucket, or an rsync/SFTP target) alongside the
      existing local-path-only scheduler — local-only means a disk failure loses DevBrain and its
      backups together.

## Trend & Visibility Dashboards

- [ ] Time-series view for issue throughput (opened/resolved per week) per project — `GET
      /api/dashboard/stats` only returns current-snapshot counts today, no history.
- [ ] Embedding health over time (pending/failed document trend, not just current counts) — would have
      made the 2026-07-15 GPU-thrashing regression (see Known Issues) visible sooner than a live
      incident did.

## Two-Way Integration Sync (GitHub / Linear / Jira)

- [ ] Webhook-based live sync as an alternative to the current manual `POST /api/integrations/:id/sync`
      pull-only trigger — investigate per-provider webhook setup (GitHub App vs. PAT scopes, Linear
      webhooks, Jira webhooks) before committing to one approach; biggest unknown of the four items here.
- [ ] Push-back: create/update the external issue from DevBrain, not just import — needs a design
      decision on conflict resolution once sync is bidirectional (simultaneous edits on both sides).

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


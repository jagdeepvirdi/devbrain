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

### Critical (fix immediately — showstoppers)

- [x] **Stored XSS via unescaped markdown rendering** (resolved 2026-07-24) — `client/src/pages/DocChat.tsx`'s `inlineMd()` regex-transformed text straight into `dangerouslySetInnerHTML` with zero HTML-escaping; the text is the AI's RAG answer, grounded in uploaded/URL-imported document content. Fixed by adding `escapeHtml()` (escapes `&`/`<`/`>`/`"`/`'`) and running it first, before any of the markdown regexes build their own literal HTML tags. Covers all four `dangerouslySetInnerHTML` call sites in the file (they all route through `inlineMd`); the code-block path was already safe (renders `{code}` as a React child, not raw HTML). Verified no other component in `client/src` reuses this pattern — the other two `dangerouslySetInnerHTML` uses in the codebase (`NotificationsPanel.tsx`'s hardcoded `<style>` string, `Commands.tsx`'s Shiki output) don't touch user/AI-controlled text unescaped.
- [x] **Crypto key reuse** (resolved 2026-07-24) — `server/services/crypto.ts` derived the AES-256-GCM key from `JWT_SECRET`. Added a dedicated `ENCRYPTION_KEY` env var (own Zod validation in `lib/env.ts`, required unconditionally like `JWT_SECRET`) and switched `crypto.ts`'s `key()` to derive from it instead. Threaded through everywhere `JWT_SECRET` was: `vitest.config.ts`'s test env, `crypto.test.ts`'s mock, `.env.example`, both real local `.env`/`server/.env` files, `docker-compose.yml`, `docker-compose.prod.yml` (also replaced a dead, never-wired-up `ENCRYPT_KEY` var that was silently doing nothing), the CI e2e job's env block, `devbrain.sh`/`devbrain.ps1`'s startup env checks (placeholder-value warning + hard fail if unset, mirroring the existing `JWT_SECRET`/`AUTH_PASSWORD` checks), and README/CONTRIBUTING/STARTUP_GUIDE's env var docs. **Note**: rotating this key going forward will make previously-encrypted secrets (LDAP bind password, S3/SFTP credentials, integration tokens) undecryptable — they'll need re-entering in Settings after a rotation, same as if `JWT_SECRET` changed before this fix. Full server suite still 1180/1180, both `tsc --noEmit` clean.
- [x] **Rate limiting covers ~9 of ~40 mutating routes** (resolved 2026-07-24) — added a baseline `apiLimiter` (300 req/min per client) applied to all of `/api` right after `requireAuth` in `server/index.ts`, so every authenticated route has *some* ceiling now, not just the hand-picked AI endpoints. The existing tighter `mutationLimiter` (60/min) still layers on top for the AI/mutation-heavy routes unchanged.
- [x] **No `helmet` security headers** (resolved 2026-07-24) — added `helmet` (`server/package.json`) with a CSP tuned to what the app actually needs: `style-src`/`font-src` allow Google Fonts (used in `client/index.html`) plus `'unsafe-inline'` for styles (the client uses inline `style={{}}` throughout — not a quick refactor, and `style-src`'s `unsafe-inline` is a far smaller risk than `script-src`'s), `script-src`/`object-src`/`frame-ancestors` locked down to `'self'`/`'none'`/`'none'`. Deliberately exempts `/api/docs` — swagger-ui-express's bundled UI needs a looser policy and isn't worth carving out directives for on a page with no user data. Verified server boots past env validation with the new middleware wired in (DB not running locally at test time, but `lib/env.js` didn't reject startup, confirming the CSP/limiter wiring itself is sound); full server suite 1180/1180, client 3/3, both `tsc --noEmit` clean.

### High Priority (refactoring & scalability)

- [ ] **Single-GPU AI bottleneck is the real scaling ceiling** — every RAG/chat/summarize/embed call funnels through one Ollama instance on one RTX 2060 6GB (`CLAUDE.md` hardware section); the Known Issues entry above (2026-07-15) already documents this thrashing into a 90s-hang degraded state under *single-user* interleaved load. Before any "handle N users" conversation makes sense, decide: (a) a real inference backend (vLLM/TGI on dedicated GPU(s), or a paid API tier) for anything beyond personal use, or (b) explicitly scope this as single-tenant/self-hosted-per-customer software and drop the market/SaaS framing.
- [ ] **In-process schedulers can't run on more than one instance** — `startBackupScheduler`, `startNotificationScheduler`, `startDigestScheduler`, `startEmbeddingHealthScheduler`, and the `chokidar`-based TASKS.md watcher (all wired in `server/index.ts:206-219`) are per-process singletons with no leader election or distributed lock. Running 2+ server instances (the standard way to scale Express) means duplicate backups, duplicate notifications, duplicate digests today. Needs a lock (a Postgres advisory lock is the cheapest fit given the existing DB) before horizontal scaling is possible.
- [ ] **SSE state is per-process, not shareable** — the `/tasks/watch` endpoints (`claude-projects.ts`, `antigravity-projects.ts`) and the tasks-watcher subscriber `Set` hold live-update subscribers in memory. A client pinned to instance B never hears about a change written via instance A. Needs Redis pub/sub (or Postgres `LISTEN/NOTIFY`, already available) before this survives a load balancer.
- [ ] **Client-side test coverage is a blind spot** — server hit 96%+ coverage; the client has one test file (`client/src/lib/api.test.ts`). Bring the highest-risk client logic (API client error handling, `FilterBar.tsx`'s filter-building, the Documents/Codes upload flows) under real unit tests, and add the client's `npm test` as an actual CI gate — right now `.github/workflows/ci.yml`'s `client` job only runs `tsc --noEmit`, never `npm test`.
- [ ] **God-files need splitting** — `client/src/pages/Settings.tsx` (3,002 lines), `server/routes/documents.ts` (942), `server/routes/settings.ts` (826), `server/routes/issues.ts` (764), `client/src/pages/Commands.tsx` (1,221). Each is a single-responsibility violation waiting to cause a bad merge; split by tab/concern (Settings.tsx already has natural seams — its own sidebar tab groups) before the next feature lands on top of them.
- [ ] **`bcryptjs` is pure-JS and CPU-blocking** — password hashing runs synchronously-ish on the same event loop serving every other request (`server/routes/auth.ts`, `server/routes/users.ts`). Swap for native `bcrypt` (or `argon2`) so concurrent logins don't stall unrelated requests.
- [ ] **Open CORS with no origin allowlist** — `cors()` is called with no options (`server/index.ts:35`). Low practical risk today (SameSite=Strict cookies protect the auth cookie specifically), but add an explicit origin allowlist driven by env before any non-same-origin deployment.
- [ ] **No dependency/vulnerability scanning in CI** — no `npm audit`, Dependabot, or CodeQL despite depending on `ldapjs`, `jsonwebtoken`, `archiver`, `xlsx` and other security-sensitive packages with real CVE history. Add at minimum a scheduled `npm audit --audit-level=high` CI job.

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

## CI Coverage Gating (resolved 2026-07-20)

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

## Zero-Coverage Service Tests (found via 2026-07-20 coverage baseline)

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

## Partially-Covered Service Tests (found via 2026-07-20 coverage baseline)

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

## Untested Route Handlers (found via 2026-07-20 audit — routes/** not yet in the coverage gate)

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

## Deepen Partially-Tested Route Handlers (found via 2026-07-21 `routes/**` coverage check)

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

## Bring `routes/**` Into the Coverage Gate (resolved 2026-07-22)

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

## Backup Retention & Offsite Destination

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

## Trend & Visibility Dashboards (resolved 2026-07-22)

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


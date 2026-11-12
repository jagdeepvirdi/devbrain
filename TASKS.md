# TASKS.md — DevBrain (Work Knowledge Base)

## Release Status

| Version | Date | Status |
|---|---|---|
| **v1.2.0** | 2026-06-15 | Released — Gemini API provider, restart/status scripts, Settings sidebar nav, font size scaling |
| **v1.1.0** | 2026-06-13 | Released — Antigravity integration, Feature Guide |
| **v1.0.0** | 2026-06-13 | Released — all phases complete, CI green |

Completed phases are archived in `TASKS_ARCHIVE.md`.
Pending work is grouped below, starting with **Pending Work — At a Glance**.

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically — **but see Phase 32.6 (Known Issues, resolved) in `TASKS_ARCHIVE.md`**: under sustained interleaved chat+embed calls (Phase 32.6's summarization step), this swapping was observed to degrade into a hung/thrashing state, not a clean automatic swap |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |
| Python environment missing | Parser includes JS fallbacks for all formats; markitdown is preferred but optional |

---

## Pending Work — At a Glance

> Single entry point for everything still open (reorganized 2026-11-12). Completed work lives in
> `TASKS_ARCHIVE.md`. Details and checkboxes are in the sections below, grouped by theme and ordered by priority.

| # | Group | Where | Needs |
|---|---|---|---|
| 1 | **Security & hardening** — `/api/notify` unauthenticated; shell injection in `routes/git.ts`; admin password rotation | [[Phase 46]] Step 1 · Maintenance → Security & credentials | Claude (code) + you (password) |
| 2 | **Phase 46 — activity feed, time tracking, browsing categorization** | [[Phase 46]] Steps 2–4 | Your inputs: repo paths, ActivityWatch decision, browsing categories + blocklist |
| 3 | **Dependencies & CI** — zod 4, E2E runner pin, optional major upgrades | Maintenance → Dependencies & CI | Claude |
| 4 | **Testing & code quality** — throwaway E2E DB, lint warnings, upload smoke test | Maintenance → Testing & quality | Claude (+ you for the UI smoke test) |
| 5 | **Data & indexing** — link projects, code graph, DB/backups checks | Maintenance → Data & indexing | You + Claude |
| 6 | **Feature backlog** — webhook sync, push-back sync | [[Phase 39]] Tier 3 | A design decision |
| 7 | **Market-readiness** — tenancy, billing, SSO, privacy docs | [[Phase 39]] Tier 4 | Only if DevBrain stops being a personal tool |

Task markers: `[ ]` todo · `[x]` done · `[~]` in progress · `[!]` blocked

---

## Phase 46 — Cross-Project Activity, Time Tracking & Browsing Categorization (2026-11-12)

> **Status: PLANNED — nothing built yet.** Extends DevBrain from "knowledge base" toward a personal
> activity hub: weekly git digests across repos, per-project time tracking, and categorized browsing
> history. **Hard constraint for every step: 100% local.** No uploads, no external API calls for personal
> data; Postgres/pgvector + Ollama only, no new infrastructure. Each step ships as its own reviewable
> commit(s) with tests (the server coverage gate in `vitest.config.ts` applies to `routes/**`,
> `services/**`, `lib/**`, so untested new code will fail CI).
>
> **Corrections to the original brief (found while reading the repo):**
> - The Notification Hub is **Phase 28.5** (archived in `TASKS_ARCHIVE.md`), not Phase 11 (that was AI
>   power features). Phase 28.5 is marked complete with every task checked; step 1 is therefore an
>   audit + hardening pass, not a build.
> - ActivityWatch has **no "one bucket per project folder"** concept: buckets are per *watcher*
>   (`aw-watcher-window_<host>`, `aw-watcher-afk_<host>`, browser/editor watchers). Per-project hours come
>   from *classifying events* (window title / app / editor `project` field) against per-project rules —
>   so step 3 builds a rule table instead of mapping buckets.
> - ActivityWatch is **not installed** on this machine (nothing under `%LOCALAPPDATA%`); Chrome and Edge are.
>
> **Safety guard (applies to steps 2–4):** `services/ai.ts` can route to Claude/Gemini when
> `AI_PROVIDER` is not `ollama`. Personal-data features (browsing history and window titles especially)
> must refuse to run unless `AI_PROVIDER=ollama`.

### Step 1 — Notification Hub audit & hardening (prerequisite for Outpost → `/notify` + `/issues`)
Current state (read 2026-11-12): `POST /api/notify` (zod-validated, rate-limited, looks up project by
`short_name`, fans out to Apprise channels), `/send-digest` (loopback only), `/log`, `/test`, `/retry/:id`,
`/channels*`, `/project-prefs`; Claude Code `session-end.ps1/.sh` POST to `/api/notify` fire-and-forget (3s
timeout); `POST /api/issues` requires `member` role (Outpost needs an API token, minted under Settings →
Account → API Tokens); daily digest via `scripts/digest_scheduler.py` (APScheduler, spawned by the server).
- [ ] **`POST /api/notify` is unauthenticated** (only the rate limiter protects it): anyone who can reach the
      port can send notifications to every channel of every user on any project. Decide + implement: accept
      loopback callers without a token (existing hooks keep working), require a valid `dbrn_` token for
      non-loopback callers (Outpost runs on a remote host). Add tests for both paths.
- [ ] **Shell injection in `routes/git.ts`**: `GET /:projectId/compare` interpolates `base`/`head` and
      `GET /:projectId/diff/:sha` interpolates `sha` straight into an `exec()` shell string, and `/commits`
      interpolates `limit` the same way (clamped, but still a shell string). Any logged-in user could run
      arbitrary commands on the server host. Switch to `execFile('git', [args…])` and validate refs against
      `^[A-Za-z0-9._/-]+$`. Fix **before** step 2 reuses git execution.
- [ ] Verify Outpost-style callers are idempotent against `POST /api/issues`: confirm whether repeated
      identical reports create duplicate issues; if so add a dedupe key (e.g. `external_ref` +
      unique-per-project index) and a test.
- [ ] Add route-level tests for `/api/notify` happy path, unknown project (404), validation (400),
      and token enforcement (above); keep the coverage gate green.

### Step 2 — Cross-project weekly git digest (reuse the release-notes summarizer)
Reuse the `POST /api/releases/import-git` approach (`aiChat` + strict-JSON prompt → parsed arrays) rather
than inventing a new pipeline; all Ollama calls already go through the serialized `withOllamaQueue`.
- [ ] **BLOCKED ON USER:** list of local clone paths (+ which DevBrain project each belongs to). Prefer the
      existing `projects.fs_path` column; 6 projects currently have none (`devbrain`, `playcru`,
      `quantcru`, `musicplayer`, `ntbilling`, `general`).
- [ ] Migration `add_activity_digests.ts`: `activity_digests(id, project_id, week_start DATE, week_end DATE,
      commit_count INT, branches JSONB, stats JSONB, summary JSONB, model TEXT, generated_at)` with
      `UNIQUE(project_id, week_start)` so regeneration is an upsert.
- [ ] `services/gitDigest.ts`: collect per-project `git log --since/--until` (via `execFile`, never a shell
      string) + recent branches + `--shortstat`; cap input size and map-reduce (summarize chunks of ~40
      commits, then merge) so a busy week can't blow the model context.
- [ ] Summarization prompt mirrors `import-git`: JSON `{ highlights[], features[], fixes[], risks[],
      summary }`; tolerate malformed JSON (regex-extract + retry once, as the release importer does).
- [ ] `GET /api/activity/digest?week=YYYY-MM-DD`, `POST /api/activity/digest/generate` (member+).
- [ ] Weekly generation scheduled through the existing digest scheduler; deliver a short message through the
      Notification Hub (Apprise) when generated. Dashboard widget + per-project drill-down.
- [ ] Tests: git collector (temp repo fixture), chunking/merge, malformed-JSON handling, route validation.

### Step 3 — Time tracking (ActivityWatch import + git-timestamp backfill)
- [ ] **DECISION NEEDED:** read ActivityWatch via its local REST API (`http://localhost:5600/api/0/...`,
      still 100% local, no lock/schema coupling) **or** directly from its SQLite file
      (`%LOCALAPPDATA%\activitywatch\activitywatch\aw-server\peewee-sqlite.v2.db` by default — confirm).
      Recommendation: REST by default, SQLite read-only fallback. Needs ActivityWatch installed first.
- [ ] Migration `add_time_tracking.ts`: `time_entries(id, project_id, source TEXT, day DATE, seconds INT,
      detail JSONB, created_at)` with `UNIQUE(project_id, source, day)` (idempotent re-imports);
      `time_mapping_rules(id, project_id, kind TEXT, pattern TEXT, priority INT)` where `kind` is one of
      `path | title | app | editor_project`.
- [ ] Importer (Python bridge, matching `markitdown_bridge.py` / `sql_bridge.py`, stdlib only): pull window +
      afk events, drop afk time, merge adjacent heartbeats, classify each event to a project via the rules
      (VS Code watcher's `project` field and terminal cwd are the most reliable signals), roll up to
      per-project hours per day. Unclassified time goes to an "Unassigned" bucket the UI can show.
- [ ] Free extra source: Claude Code/Antigravity session start/end times already in `sessions/*/SESSION.md`
      frontmatter + `sessions/index.md` -> `source='claude-session'` entries (no new tracker needed).
- [ ] One-off backfill `scripts/estimate-hours-from-git.ts`: per project, sort commit timestamps; gap <= 2h =
      same session; session length = last - first + 30 min first-commit credit (git-hours heuristic; both
      constants configurable); writes `source='git-estimate'`, never overwrites ActivityWatch days.
- [ ] API + UI: `GET /api/time?from&to&project`, project/week/month rollups, source breakdown; tests for
      event merging, rule priority, idempotent re-import, and the git-gap clustering.

### Step 4 — Browsing history, categorized (scheduled batch job, no extension)
Chrome and Edge profiles both exist locally (`%LOCALAPPDATA%\Google\Chrome\User Data\<Profile>\History`,
`%LOCALAPPDATA%\Microsoft\Edge\User Data\<Profile>\History`).
- [ ] **DECISION NEEDED:** your category list (name + short description each) and a domain blocklist
      (banking, health, email, anything that must never be stored or sent to the model — even locally).
- [ ] Migration `add_browsing_history.ts`: `browsing_categories(id, name, description, color)`,
      `browsing_domain_rules(domain, category_id)`, `browsing_visits(id, browser, profile, domain, title,
      visit_time, category_id, confidence, classified_at)`, plus a `last_visit_time` cursor in `app_settings`.
- [ ] Reader (Python bridge, stdlib `sqlite3`): **copy `History` (+ `-wal`/`-shm` if present) to a temp
      dir and open the copy read-only** — Chrome/Edge hold the file locked while running, and a bare copy can
      still fail. If the copy fails, the job logs a clear "close <browser> and re-run" message and skips that
      profile (**flag:** a fully reliable read needs the browser closed). Convert WebKit timestamps
      (microseconds since 1601-01-01) to UTC; incremental import from the saved cursor.
- [ ] Privacy at the boundary: store `domain` + title only; **strip query string/fragment and never store full
      URLs**; drop blocklisted domains before anything is written or sent to Ollama; configurable retention.
- [ ] Classification: domain -> category rule table first (most visits never touch the model); only unknown
      domains go to `gemma3:4b` in batches with strict-JSON output constrained to the user's category list
      ("Uncategorized" allowed); successful results seed `browsing_domain_rules` so each domain is classified once.
- [ ] Scheduling (**flag:** needs setup): either extend `digest_scheduler.py` (only runs while the server is
      up) or a Windows Task Scheduler entry running `scripts/browsing-import.ps1` nightly. Document both;
      do not ship a live browser extension in this phase.
- [ ] Tests: timestamp conversion, copy-failure path, URL sanitization, blocklist enforcement, batch
      classifier JSON parsing, and the `AI_PROVIDER=ollama` guard.

### Cross-cutting
- [ ] `requireLocalAI()` guard (see Safety guard above) with a test that cloud providers are rejected.
- [ ] Update `docs/FEATURE_GUIDE.md`, `CLAUDE.md` project structure, and `CHANGELOG.md` per step.
- [ ] Each step lands as its own commit(s); CI must be green before starting the next step.

---

## Maintenance Backlog (carried over from Phase 45 and the 2026-11-12 health audit)

> Open items found while recovering CI and auditing the codebase/database on 2026-11-12, regrouped by theme.
> Completed Phase 45 work is archived in `TASKS_ARCHIVE.md`.

### Security & credentials
- [ ] **Rotate the admin password** *(owner action)* — it was stored in plaintext inside `.claude/settings.local.json`
      allow-rules until 2026-11-12 (those rules are removed) and appeared in a session transcript. The matching
      `dbrn_` API token (`Temp-Claude`) was revoked 2026-11-12 (its `api_tokens` row deleted).
- [ ] *(optional)* Trim the remaining over-broad allow rules in `.claude/settings.local.json` — e.g. `Bash(git *)`
      (includes force-push), `Bash(grep *)`, `Bash(python *)`, `Bash(docker exec *)`, `PowerShell(Remove-Item *)`,
      `Bash(Remove-Item *)`. Replace with narrower prefixes or run `/fewer-permission-prompts`.

### Dependencies & CI
- [ ] **Migrate `zod` 3 → 4** (26 files under `server/` and `client/src/`) and drop the `GHSA-mrhx-c7xc-m3w5`
      entry from `.github/workflows/security-audit.yml`'s allowlists (both jobs).
- [ ] Revert the `e2e` job in `ci.yml` from `ubuntu-24.04` back to `ubuntu-latest` once Playwright supports
      Ubuntu 26.04 (error was: "Playwright does not support chromium on ubuntu26.04-x64").
- [ ] *(optional)* Major upgrades currently parked: Express 5, React 19 (+ `@types/react*`), Tailwind 4,
      `marked` 18, `pdf-parse` 2 (or drop it if `@firecrawl/pdf-inspector` fully covers PDFs),
      `vitest` / `@vitest/coverage-v8` 5, TypeScript 7.
- [ ] *(optional)* Moderate `npm audit` findings that only clear with `--force` (below the CI gate, which fails on
      high/critical only): `deepmerge` (via `vite-plugin-pwa` / `workbox`), `glob`, `minimatch`, `katex`.
      Revisit together with the major upgrades above.

### Testing & code quality
- [ ] **Run local E2E against a throwaway database**, not the `.env` one — local Playwright runs hit the real DB
      and a killed run left test users/projects behind (cleaned up 2026-11-12). CI already uses its own Postgres.
- [ ] Clear lint warnings: client 60 (38 `react-hooks/set-state-in-effect`, 6 `refs`, 5 `exhaustive-deps`,
      4 `only-export-components`, 3 `preserve-manual-memoization`, 1 `purity`, 3 other) and server 5
      (non-null assertions). Warnings will become errors as the react-hooks rules tighten.
- [ ] Manual smoke test of a document upload through the running UI (`multer` 2.x was verified by unit tests and a
      live upload / no-file / size-limit smoke test, but not against the running app).

### Data & indexing
- [ ] Link the `devbrain` project to `D:/Project/devbrain` (Projects page) and run
      `npx tsx scripts/index-code-graph.ts --project devbrain` from `server/` so `code_nodes` / `code_edges`
      (empty today) are populated. Note: the session hook's node count comes from the separate
      `.code-review-graph` tool, not these tables.
- [ ] Six projects have no `fs_path` (`devbrain`, `playcru`, `quantcru`, `musicplayer`, `ntbilling`, `general`) —
      link the ones with local repos (also required by [[Phase 46]] Step 2).
- [ ] Investigate the one document with no chunks, and verify `embedding_health_snapshots` is written while the
      server runs (latest row dated 2026-08-11).
- [ ] Verify a recent scheduled backup exists (`backup_settings` is configured; not checked 2026-11-12).

---

## Phase 39 — Consolidated Priority Backlog (2026-08-07) — open items only

> Tier 1 (correctness & reliability) and Tier 2 (code quality / maintainability) are complete and archived in
> `TASKS_ARCHIVE.md`. Only the feature-enhancement and market-readiness tiers remain open; original wording is
> preserved from the source sections ([[Phase 33]] review and the V2 Roadmap's Two-Way Integration Sync).

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

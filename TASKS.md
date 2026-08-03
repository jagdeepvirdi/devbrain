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

- [ ] **Rate Limiter IP Spoofing via Unconfigured `trust proxy`** — `server/index.ts` does not set `app.set('trust proxy', ...)`, allowing spoofed `X-Forwarded-For` headers behind reverse proxies to bypass rate limiting or trigger shared IP denial of service.
- [ ] **60 Non-null Assertion (`!`) Warnings in Server Routes** — ESLint flags 60 instances of `@typescript-eslint/no-non-null-assertion` across `aitask.ts`, `auth.ts`, `chat.ts`, `documents.ts`, `users.ts`, `ai.ts`. Refactor to strict guards to prevent uncaught runtime type errors.
- [ ] **Event Loop Blocking in Duplicate Document Line Similarity** — `POST /api/documents/find-duplicates` computes multiset Dice-similarity on full raw text synchronously on the main event thread. Add string length caps or async yielding for large contents.
- [ ] **God-File Modularization (`documents.ts`, `Settings.tsx`, `settings.ts`)** — Split monolithic route and page files into isolated domain modules and sub-controllers now that baseline test coverage exists.

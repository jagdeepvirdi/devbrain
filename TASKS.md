# TASKS.md — DevBrain (Work Knowledge Base)

## Phase 13 — Security Hardening ✅ COMPLETE

### Authentication & Token Security
- [x] Rate-limit `/api/auth/login` — `express-rate-limit`: max 10 attempts per 15 min per IP; return 429 with `Retry-After` header
- [x] Remove legacy token admin fallback — tokens missing `userId` must return 401, not grant admin; force re-login
- [x] Add `iss` and `aud` claims to JWT signing and verification — prevents tokens from other services being accepted
- [x] Move JWT from localStorage to HttpOnly cookie — eliminates XSS token theft; update `requireAuth` to read from cookie; keep `Authorization` header as fallback for API clients
- [x] Fix timing attack on login — run `bcrypt.compare` even when user is not found (compare against a dummy hash) so response time doesn't leak username existence

### Authorization & Audit
- [x] Audit log: add `logAudit()` to `POST /api/auth/change-password` — password changes must be visible in audit trail
- [x] Admin password reset confirmation — require admin to re-enter their own password before resetting another user's; add `logAudit()` with `action: 'update'` on the affected user
- [x] Add HTTPS enforcement option — env var `FORCE_HTTPS=true` adds HSTS header + HTTP→HTTPS redirect middleware; document in `.env.example`

### Input & SQL Safety
- [x] Replace `Object.keys(updates)` with explicit column allowlists in all dynamic `PUT`/`PATCH` handlers — `commands.ts`, `documents.ts`, `issues.ts`, `users.ts`; use a `const UPDATABLE_COLS = new Set([...])` guard before building the `SET` clause
- [x] Fix manual SQL parameter index counting — replaced with `buildSetClause(cols, vals)` helper in `server/lib/db.ts`; used across commands, documents, issues, users
- [x] SSRF protection on URL document import — validate that the resolved host is not a private/loopback IP (`10.x`, `192.168.x`, `172.16–31.x`, `127.x`, `::1`) before fetching; return 422 with clear error

### Infrastructure Secrets
- [x] Move Docker Compose credentials to env file — replaced hardcoded `POSTGRES_PASSWORD`/`POSTGRES_USER`/`DATABASE_URL` with `${VAR:-default}` references; `JWT_SECRET` now required (no default); documented in `.env.example`
- [x] Add resource limits to Docker Compose — postgres capped at 512 MB / 1 CPU; app at 1 GB / 2 CPU

---

## Phase 14 — Architecture & Code Quality ✅ COMPLETE
> Baseline review scores: Architecture **5/10**, Code **5/10**. Structural debt that compounds with every feature added.

### Routing — Replace Custom Event System with React Router
- [x] Install `react-router-dom` v6 — wrap `App` in `<BrowserRouter>`
- [x] Map all current routes to URL paths: `/`, `/projects`, `/documents`, `/chat`, `/issues`, `/commands`, `/releases`, `/runbooks`, `/tasks`, `/settings`
- [x] Add project scoping to URLs — dropped in favour of `?project=:id` which achieves the same UX goal (refresh/history) without a full router restructure
- [x] Replace `window.dispatchEvent('devbrain:navigate')` with `useNavigate()` — remove all custom event listeners from `App.tsx`
- [x] Replace `window.dispatchEvent('devbrain:open-issue')` with URL param: `/issues?open=:id` — `IssuesPage` uses `useSearchParams`; `Releases.tsx` now calls `navigate('/issues?open=' + id)`
- [x] Persist selected project in URL (`?project=:id`) — `App.tsx` reads on mount; `ProjectSwitcher` updates URL on pick; `setRoute` preserves param across navigation
- [x] Add `<Link>` on all clickable cards — `IssueRow` and `CommandCard` use `<a href>` with Ctrl+click passthrough; `Commands.tsx` adds `?open=:id` URL param support

### Schema — Single Source of Truth
- [x] Consolidate all migrations into `schema.sql` — folds org-v2, phase12, tasks, FlowForge/NTBilling, embedding additions into one idempotent file; `npx tsx db/setup.ts` produces a complete DB on fresh install
- [x] Add `updated_at TIMESTAMPTZ` column to all tables (`projects`, `documents`, `issues`, `commands`, `releases`, `runbooks`, `tasks`, `users`) with `set_updated_at()` trigger; migration in `db/migrations/add_updated_at_and_embedding_status.ts`
- [x] Write `db/setup.ts` — single idempotent setup script that runs `schema.sql` then calls `runSeed()`; replaces the multi-script setup dance

### Data Integrity — Fix JSONB Race Conditions
- [x] Normalize `investigation_steps` into `issue_steps` table — schema added; migration script `db/migrations/normalize_issue_jsonb.ts`; all routes use new table
- [x] Normalize `notes` into `issue_notes` table — same; `POST /notes` is now a plain INSERT; `DELETE /notes/:id` is a row DELETE; no more JSONB race condition
- [x] Update `server/routes/issues.ts` to use new tables; GET list+detail join `issue_steps`/`issue_notes` with `json_agg`; client types unchanged (same response shape)

### Reliability — Embeddings & AI
- [x] Add `AbortController` with 30s timeout to all Ollama `fetch()` calls in `services/ai.ts` — prevents connection pool starvation on hung Ollama process
- [x] Replace fire-and-forget embed calls with tracked async — `embedding_status: 'pending'|'processing'|'done'|'failed'` column on `documents` and `issues`; `embedIssueAsync` updates status; status dot indicator in Documents list and preview panel
- [x] Add embedding retry endpoint `POST /api/documents/:id/reembed` and `POST /api/issues/:id/reembed` — allows manual repair of failed embeddings; "Re-embed" button shown in document preview panel when status is failed/pending

### Code Quality
- [x] Split `Issues.tsx` (1,318 lines) into: `IssuesList.tsx`, `IssueDetail.tsx`, `NewIssueModal.tsx`, `IssueRow.tsx`, `StepText.tsx`, `issueConstants.ts` — `Issues.tsx` root is now 63 lines
- [~] Replace manual SQL parameter index counting with `buildWhereClause` — utility exists in `server/lib/db.ts` but list routes use custom SQL (table aliases, tsv @@, IS NULL, namespace logic) that the simple equality utility can't replace without making code less readable; left as-is
- [x] Add `useCallback` + `useMemo` to `IssuesList` and `CommandsPage` — `toggleSelect`, `toggleSelectAll`, open count memoized; `selected`, `availableLangs`, update/delete/fav handlers wrapped
- [x] Add `AbortController` to debounced search inputs — `IssuesList` and `CommandsPage` cancel in-flight load on new search; `AbortError` silently swallowed
- [x] Add drag-and-drop bounds validation in `IssueDetail` — `onDrop` guards `splice(fromIdx,1)` with full bounds check
- [x] Add `<ErrorBoundary>` around each route in `App.tsx` — catches component crashes; shows "Something went wrong" with a reload button instead of blank white screen

### Search & Pagination
- [x] Make search result limit configurable — backend `?limit=N` (default 10, max 50); `GlobalSearch.tsx` passes limit, starts at 10, "Show more" button increments by 10 up to 50
- [x] Add request deduplication in `client/src/lib/api.ts` — in-flight map keyed by URL path; GET requests without a signal share the same promise; requests with signal (search/AbortController) bypass the cache

---

## Phase 15 — Design, Accessibility & Usability ✅ COMPLETE
> Baseline review scores: Design **6/10**, UI **4/10**, Usability **6/10**.

### Accessibility (A11y)
- [x] Add `aria-label` to all icon-only buttons (star/favorite toggle, delete, close ✕, mark-used ✓) — IssueDetail, IssueRow, CommandCard, CommandDetail, RunbookCard, NewIssueModal, ProjectModal, NewCommandModal, NewRunbookModal, GlobalSearch
- [x] Add `role="dialog"` + `aria-modal="true"` + `aria-labelledby` to all modals — NewIssueModal, ProjectModal, NewCommandModal, NewRunbookModal, GlobalSearch, shortcuts modal; `aria-pressed` on toggle buttons
- [x] Fix `cursor: 'default'` on all `<button>` elements — global `cursor: pointer` in index.css; removed inline `cursor: 'default'` overrides
- [x] Add `tabIndex` and `onKeyDown` to all interactive card rows — IssueRow (`<a>` gets keyboard nav free), CommandCard (`<a>`), RunbookCard (div → `tabIndex={0}` + `onKeyDown` Enter/Space)
- [x] Add visible focus ring — `outline: 2px solid var(--accent)` on `:focus-visible` in index.css

### Responsive Layout
- [~] Make sidebar panels resizable — too complex for v1; deferred
- [x] Add responsive breakpoint at 900px — `@media (max-width: 900px)` in index.css; sidebar collapses to 56px, min touch targets 44px
- [x] Add mobile viewport meta tag and basic touch targets — already in `client/index.html`; 44px touch targets added

### URL-Driven State & Deep Links
- [~] Canonical URL per entity — uses `?open=:id` param which achieves same UX goal as path params
- [x] Add "Copy link" button on issue detail and command detail — copies `window.location.origin + /issues?open=:id` / `/commands?open=:id` to clipboard
- [x] Restore last-visited route and project from URL — already handled by React Router + `?project=` param (Phase 14)

### Design System Migration
- [x] Extract design tokens to `client/src/styles/tokens.css` — `:root {}` block + density/tint variants moved out of index.css; `@import './styles/tokens.css'` at top of index.css
- [~] Shared style constants `shared.ts` — too large a refactor for v1; deferred
- [x] Add enter/exit animations to modals — `modal-in` + `overlay-in` keyframes in index.css; `.modal-panel` / `.modal-overlay` classes applied to all dialogs

### Usability Improvements
- [x] Add runbook print/export view — `?print=1` URL param on RunbooksPage renders clean white print view; "⎙ Print" button opens in new tab from RunbookDetail
- [x] Increase ⌘K search to show 10 results by default + "show more" — done in Phase 14; verified
- [x] Add onboarding empty states — Issues (icon + CTA button), Commands (icon + CTA button), Documents (icon + helper text) all show helpful empty states
- [x] Add "recently viewed" trail — `useRecentlyViewed` hook in `client/src/hooks/`; tracked on IssueDetail + CommandDetail open; shown in Dashboard (section) and GlobalSearch (empty-query results)
- [x] Add keyboard shortcuts for primary actions — `N` opens new item on Issues, Commands, Runbooks pages; `G D/I/C/R` navigate to sections; shown in ? shortcuts modal

---

## Phase 16 — Testing & Reliability (New - From Review)

### Testing Infrastructure
- [ ] Set up **Vitest** for server-side and client-side unit/integration tests
- [ ] Set up **Playwright** or **Cypress** for E2E testing of critical workflows (Login, Document Upload, DocChat)
- [ ] Configure `package.json` with `test` and `test:coverage` scripts
- [ ] Implement a basic CI check (e.g., GitHub Action or local script) to run tests and typecheck

### Unit & Integration Tests
- [ ] Test `server/services/ai.ts`: Mock Ollama/Claude and verify request/response handling
- [ ] Test `server/services/parser.ts`: Verify parsing for PDF, DOCX, and MD with sample files
- [ ] Test `server/services/rag.ts`: Verify retrieval logic and prompt construction
- [ ] Test `server/lib/db.ts`: Verify `buildSetClause` and other DB utilities

### Reliability
- [ ] Implement health check endpoints for Ollama connectivity
- [ ] Add request timeout and retry logic for embedding operations

---

## Phase 17 — Documentation & Developer Experience (New - From Review)

### Documentation
- [ ] Integrate **Swagger/OpenAPI** for the Express server to document all endpoints
- [ ] Create a `CONTRIBUTING.md` with setup instructions and coding standards (referencing `GEMINI.md`)
- [ ] Add inline JSDoc/TSDoc to complex service functions

### Developer Experience
- [ ] Set up **ESLint** and **Prettier** with strict rules to match `GEMINI.md` mandates
- [ ] Add a `scripts/validate.ps1` to run lint, typecheck, and tests in one go

---

## Known Risks & Mitigations

| Risk | Mitigation |
|---|---|
| mistral:7b + nomic-embed-text both loaded → exceeds 6GB VRAM | Ollama swaps models automatically; nomic is tiny (~300MB) so co-exists fine |
| Large PDFs (100+ pages) slow to embed | Show progress; process synchronously for now (v1 acceptable for personal use) |
| pgvector slow past ~500k chunks | HNSW index live from day one |
| Ollama streaming cut off mid-response | SSE parser handles partial lines; `[DONE]` sentinel closes stream cleanly |
| Port 5432 conflict (local PG14 on Windows) | Docker postgres mapped to 5433; DATABASE_URL updated accordingly |

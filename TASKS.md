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

> Phases ordered by priority: fix existing gaps first, build the safety net, protect data, then grow features.
> Fix → Test → Backup → Visibility → AI → Git → Integrations → Multi-user.

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


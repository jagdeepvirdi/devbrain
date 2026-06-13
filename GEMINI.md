# GEMINI.md — DevBrain Project Instructions

## Foundational Mandates
- **Local AI First**: All primary AI features must run locally via Ollama. Use `mistral:7b` for generation, `gemma3:4b` for fast classification/tagging, and `nomic-embed-text` for embeddings.
- **Structured Parsing**: Use Microsoft MarkItDown (Python) for high-quality file-to-markdown conversion to improve RAG accuracy.
- **Zero Cost**: Avoid external API dependencies unless explicitly requested by the user. Claude API is supported as an opt-in for high-quality chat/RAG.
- **Privacy**: No data should leave the local environment without explicit action.

## Engineering Standards

### TypeScript & Type Safety
- **Strict Mode**: `strict: true` must be maintained in all `tsconfig.json` files.
- **No `any`**: Explicitly type everything. Use `unknown` if the type is truly dynamic, then narrow it.
- **Zod Validation**: Always use Zod for validating API requests (incoming) and configuration/environment variables.

### Architecture
- **Service Layer**: Keep business logic in `server/services/`. Routes should be thin and handle only request/response orchestration.
- **Unified AI Client**: All AI interactions must go through `server/services/ai.ts`. Never call Ollama or Claude APIs directly from routes.
- **State Management**: Use Zustand for client-side state. Use React Query for server-state synchronization and caching.
- **Routing**: Use `react-router-dom` for navigation. Avoid custom event systems for routing.
- **Zero-dependency Analytics**: Visualization widgets (charts/heatmaps) must use Vanilla CSS/HTML. Avoid external charting libraries to keep the bundle lean and maintainable.

### AI & Data
- **Streaming**: AI responses must be streamed via Server-Sent Events (SSE) for a better UX.
- **Embeddings**: Ensure all documents and issues have valid embeddings for semantic search and recommendations.
- **RAG Integrity**: Cite sources accurately using document titles and chunk references.

### Security
- **JWT Security**: Store JWTs in `HttpOnly` cookies to prevent XSS.
- **Audit Logging**: Log all mutations (create/update/delete) and security-sensitive events (login/password change) using the `audit_events` system.
- **Encryption**: sensitive external tokens (GitHub PATs, API keys) must be stored encrypted using AES-256-GCM in `server/services/crypto.ts`.

### Users & Roles
- **Roles**: `admin` (full access), `member` (create/edit), `viewer` (read-only).
- **Enforcement**: Role check middleware must be applied to all mutating routes.

### Testing
- **Test-Driven Development (TDD)**: New features should include unit tests.
- **Testing Stack**: Use Vitest for server/client unit tests and Playwright for E2E tests.
- **Coverage Areas**: 
  - **Services**: Full coverage for `crypto.ts`, `integrations.ts`, `ai.ts`, and `parser.ts`.
  - **Routes**: Unit tests for complex route logic (e.g., `git.ts`).
  - **E2E**: Critical flows including Auth, Project Management, and External Sync.

## Workflows
- **Database Migrations**: Add new migrations to `server/db/migrations/` and ensure `schema.sql` is updated to reflect the current source of truth.
- **Task Tracking**: Maintain `TASKS.md` as the primary source of truth for phase-based progress.
- **Session Logging**: Use the `reviews/` directory for significant architectural reviews or session summaries.
- **Commit Style**: Use descriptive, atomic commits. Gather context from `git status` and `git diff` before proposing commit messages.

## Antigravity Integration

This project uses the **DevBrain × Antigravity** integration (`integrations/antigravity/`), which hooks into Gemini CLI / Antigravity's SessionStart and SessionEnd lifecycle events.

**Install (Windows):** `powershell -ExecutionPolicy Bypass -File integrations\antigravity\install.ps1`  
**Install (macOS/Linux/WSL):** `cd integrations/antigravity && ./install.sh`

### What the Hooks Do
- **SessionStart** — scaffolds `TASKS.md` if absent, archives `[x]` tasks stamped `<!-- done: YYYY-MM-DD -->` older than 7 days into `TASKS_ARCHIVE.md`, creates a timestamped session folder under `sessions/`, and prints per-phase task progress + the last session summary to stdout so this model has full context at session open.
- **SessionEnd** — writes the completion timestamp and appends a row to `sessions/index.md`.

### Responsibilities at Session End
1. Update `TASKS.md` checkboxes: `[x]` done · `[~]` in-progress · `[!]` blocked. Stamp completed items with `<!-- done: YYYY-MM-DD -->` so the archive job can clean them up automatically.
2. Fill in the active `SESSION.md`: Goals, Work Done, Decisions, Open Items — bullets only, max 5 each.

Trigger manually at any point: `/devbrain` — or say "update tasks", "write session summary", or "mark X as done".

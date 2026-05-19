# GEMINI.md — DevBrain Project Instructions

## Foundational Mandates
- **Local AI First**: All primary AI features must run locally via Ollama. Use `mistral:7b` for chat/RAG and `nomic-embed-text` for embeddings.
- **Zero Cost**: Avoid external API dependencies unless explicitly requested by the user.
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

### AI & Data
- **Streaming**: AI responses must be streamed via Server-Sent Events (SSE) for a better UX.
- **Embeddings**: Ensure all documents and issues have valid embeddings for semantic search and recommendations.
- **RAG Integrity**: Cite sources accurately using document titles and chunk references.

### Security
- **JWT Security**: Store JWTs in `HttpOnly` cookies to prevent XSS.
- **Audit Logging**: Log all mutations (create/update/delete) and security-sensitive events (login/password change) using the `audit_events` system.
- **SSRF Protection**: Always validate hostnames for URL imports to prevent SSRF against the local network.

### Testing (New Mandate)
- **Test-Driven Development (TDD)**: New features should include unit tests.
- **Testing Stack**: Use Vitest for server/client unit tests and Playwright for E2E tests.
- **Coverage**: Aim for high coverage on critical service logic (`ai.ts`, `parser.ts`, `rag.ts`).

## Workflows
- **Database Migrations**: Add new migrations to `server/db/migrations/` and ensure `schema.sql` is updated to reflect the current source of truth.
- **Task Tracking**: Maintain `TASKS.md` with phase-based progress.
- **Session Logging**: Use the `reviews/` directory for significant architectural reviews or session summaries.

# Contributing to DevBrain

DevBrain is a private developer knowledge base — currently at **v1.2.0**. This guide covers local setup, the branching model, and coding standards for contributors.

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 20+ |
| PostgreSQL | 16 (via Docker) |
| Ollama | latest |
| Docker + Docker Compose | latest |

## Local Setup

```bash
# 1. Clone and install dependencies
git clone <repo>
cd devbrain
cd server && npm install && cd ..
cd client && npm install && cd ..

# 2. Start infrastructure (PostgreSQL + Ollama)
docker compose up -d

# 3. Pull required Ollama models (one-time)
docker exec -it devbrain-ollama-1 ollama pull mistral:7b
docker exec -it devbrain-ollama-1 ollama pull gemma3:4b
docker exec -it devbrain-ollama-1 ollama pull nomic-embed-text

# 4. Configure environment
cp .env.example .env
# Edit .env — set JWT_SECRET to any 32+ character random string

# 5. Start dev servers (two terminals)
cd server && npm run dev
cd client && npm run dev
```

The app is available at http://localhost:5173 (frontend proxies API calls to port 3001).

## Validation

Run all checks before committing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\validate.ps1
```

This runs: server typecheck → server lint → server tests with coverage → client typecheck → client lint.

Or run steps individually:

```bash
cd server && npm run typecheck && npm run lint && npm run test:coverage
cd client && npm run typecheck && npm run lint
```

CI gates on `npm run test:coverage`, not just `npm test` — `server/vitest.config.ts`'s `coverage.thresholds` (covering `lib/**`, `services/**`, and `routes/**`) must pass, so run the coverage variant locally before pushing rather than the plain one.

## Branch Model

- `main` — stable, deployable
- `master` — active development
- Feature branches: `feat/<short-name>`
- Bug fixes: `fix/<short-name>`

## Code Standards

These apply in addition to what ESLint and TypeScript enforce automatically.

### TypeScript
- `strict: true` in all tsconfig files — no exceptions
- No `any` — use `unknown` + type narrowing if the shape is truly dynamic
- Zod for all API request validation and env var parsing

### Architecture
- Business logic lives in `server/services/` — routes are thin (request parsing → service call → response)
- All AI calls go through `server/services/ai.ts` — never call Ollama or Claude APIs directly from routes or other services
- Client state: Zustand for app state, React Query for server state

### AI / Local First
- All primary AI features run via Ollama (local, zero cost)
- Claude API is opt-in only — behind an explicit user action, never automatic
- Embeddings always use `nomic-embed-text` on Ollama

### Security
- JWTs in `HttpOnly` cookies only — never `localStorage`
- Validate all URL imports against an allowlist to prevent SSRF
- Log mutations and auth events via the `audit_events` system

### Style
- Formatting: Prettier (`npm run format` — see `.prettierrc`)
- Linting: ESLint with `typescript-eslint` strict rules
- No comments explaining *what* code does — only *why* when the reason is non-obvious
- No trailing summaries or task references in commit messages

### Testing
- Test files go in `server/tests/` (server) and `client/src/test/` (client)
- Use `vi.mock` to isolate the unit under test from DB and network
- Integration tests that hit a real DB are acceptable; mock the DB only when you have a specific reason
- Server coverage (`lib/**`, `services/**`, `routes/**`) is gated in CI via `server/vitest.config.ts`'s `coverage.thresholds` — new code should keep coverage at or above the current baseline, not just pass functionally

## Environment Variables

See `.env.example` for the full list. Required variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | ≥32 character secret for signing tokens |
| `OLLAMA_URL` | Ollama base URL (default: `http://localhost:11434`) |

Optional:

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `ollama` (default) \| `claude` \| `gemini` — selects the AI backend for chat and RAG |
| `ANTHROPIC_API_KEY` | Required when `AI_PROVIDER=claude` |
| `GEMINI_API_KEY` | Required when `AI_PROVIDER=gemini` (free tier: 1500 RPD, 1M TPM) |
| `GEMINI_CHAT_MODEL` | Gemini model name (default: `gemini-2.0-flash`) |
| `FORCE_HTTPS` | Set to `true` behind a reverse proxy to redirect HTTP → HTTPS |

## API Reference

Interactive Swagger UI is available at `/api/docs` when the server is running.

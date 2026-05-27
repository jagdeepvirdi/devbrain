# DevBrain

A private developer knowledge base for organizing work artifacts across all active projects. Supports document Q&A via RAG, issue investigation workflows, a commands/snippets library, release notes, and runbooks — all powered by local AI with zero API cost.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black)
![Ollama](https://img.shields.io/badge/AI-Ollama%20%28local%29-000000?logo=ollama&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

- **Document Q&A (RAG)** — upload PDFs, DOCX, Markdown, spreadsheets, or URLs and ask questions against them. Answers stream in real time with citations.
- **Issue Investigation** — structured investigation flow with steps, notes, linked docs, and resolution tracking.
- **Commands Library** — searchable snippets across all your projects with syntax highlighting and one-click copy.
- **Release Notes** — version timeline with features, fixes, and breaking changes per project.
- **Runbooks** — step-by-step operational playbooks with optional commands per step.
- **Global Search (⌘K)** — hybrid semantic + full-text search across all projects simultaneously.
- **Multi-project** — switch between projects with a top-bar dropdown; all views scope to the selected project or show global across all.
- **100% local AI** — all inference runs on your GPU via Ollama. No cloud AI costs.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, Zustand, React Query |
| Backend | Node.js + Express (TypeScript) |
| Database | PostgreSQL 16 + pgvector |
| AI — RAG / chat | `mistral:7b` via Ollama |
| AI — classification | `gemma3:4b` via Ollama |
| AI — embeddings | `nomic-embed-text` via Ollama |
| AI — optional | Anthropic Claude API (manual opt-in only, never auto-called) |
| Search | pgvector cosine similarity + PostgreSQL tsvector hybrid |
| File parsing | `pdf-parse`, `mammoth`, `marked`, `xlsx` |
| Code highlighting | Shiki |
| Auth | bcrypt + JWT |
| Infrastructure | Docker Compose |

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with NVIDIA GPU support for Ollama)
- [Node.js](https://nodejs.org/) 20+
- An NVIDIA GPU with 4GB+ VRAM (tested on RTX 2060 Max-Q 6GB)

> CPU-only mode works but RAG responses will be slower (~30s instead of ~3s).

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/jagdeepvirdi/devbrain.git
cd devbrain
cp .env.example .env
cp .env.example server/.env   # edit server/.env — set AUTH_PASSWORD and JWT_SECRET
```

Edit `server/.env` at minimum:

```env
JWT_SECRET=<random 32-char string>   # openssl rand -base64 32
AUTH_PASSWORD=<your login password>
```

### 2. Start everything

**Windows (PowerShell):**
```powershell
.\devbrain.ps1
```

**macOS / Linux:**
```bash
./devbrain.sh
```

This starts Docker (Postgres + Ollama), pulls AI models on first run, installs dependencies, and launches the dev server.

### 3. Pull AI models (first run only)

```bash
docker exec -it devbrain-ollama-1 ollama pull mistral:7b
docker exec -it devbrain-ollama-1 ollama pull gemma3:4b
docker exec -it devbrain-ollama-1 ollama pull nomic-embed-text
```

### 4. Open the app

```
http://localhost:5173
```

Log in with the `AUTH_PASSWORD` you set in `server/.env`.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://devbrain:devbrain@localhost:5432/devbrain` | Postgres connection string |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `OLLAMA_CHAT_MODEL` | `mistral` | Model used for RAG chat |
| `PORT` | `3001` | Express server port |
| `JWT_SECRET` | — | **Required** — min 32 chars |
| `AUTH_PASSWORD` | — | Login password (required in production) |
| `ANTHROPIC_API_KEY` | — | Optional — only used when `USE_CLAUDE=true` |
| `USE_CLAUDE` | `false` | Route AI calls through Claude API instead of Ollama |

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser  (React + Vite, port 5173)             │
│  Global search · Project switcher · ⌘K          │
└───────────────────┬─────────────────────────────┘
                    │ REST + SSE
┌───────────────────▼─────────────────────────────┐
│  Express API  (Node.js, port 3001)              │
│  /documents · /issues · /commands               │
│  /releases · /runbooks · /search · /chat        │
└──────────┬──────────────────────┬───────────────┘
           │                      │
┌──────────▼──────────┐  ┌───────▼───────────────┐
│  PostgreSQL 16      │  │  Ollama (local GPU)   │
│  + pgvector         │  │  mistral:7b  (RAG)    │
│  Documents, chunks, │  │  gemma3:4b  (classify)│
│  embeddings, issues │  │  nomic-embed-text      │
└─────────────────────┘  └───────────────────────┘
```

### RAG Query Flow

1. User question → embed with `nomic-embed-text` (~50ms)
2. pgvector cosine similarity → top 5 relevant chunks
3. Chunks + question → `mistral:7b` prompt
4. Stream answer via SSE → typewriter render
5. Source citations shown as collapsible cards

## Performance (RTX 2060 Max-Q, 6GB VRAM)

| Task | Time |
|---|---|
| RAG answer (mistral:7b) | ~3–5 s |
| Embed a doc chunk | ~50 ms |
| Command explanation (gemma3:4b) | ~1 s |
| Full-text search | <50 ms |
| Semantic search (pgvector) | <100 ms |

## Project Structure

```
devbrain/
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── components/  # issues, docs, commands, search, releases
│   │   ├── pages/       # Dashboard, Documents, Issues, Commands, Releases
│   │   └── lib/         # api.ts, ai.ts, streaming.ts
│   └── e2e/             # Playwright end-to-end tests
├── server/              # Express + TypeScript backend
│   ├── routes/          # REST endpoints
│   ├── services/        # ai, ollama, rag, parser, embedder, backup, exporter
│   ├── lib/             # errors, utilities
│   └── db/              # schema.sql, seed, migrations
├── shared/
│   └── types.ts         # Shared TypeScript types
├── docker-compose.yml
├── devbrain.ps1         # Windows start script
└── devbrain.sh          # macOS/Linux start script
```

## Optional: Claude API

All AI features run locally by default. To route chat through the Claude API instead:

```env
ANTHROPIC_API_KEY=sk-ant-...
USE_CLAUDE=true
```

The "Enhance with Claude" button in the UI is the only place the Claude API is ever called automatically — all other AI calls always go through Ollama.

## License

MIT — see [LICENSE](LICENSE).

# DevBrain

A private developer knowledge base for organizing work artifacts across all active projects. Supports document Q&A via RAG, issue investigation workflows, a commands/snippets library, release notes, and runbooks — all powered by local AI with zero API cost.

![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-Vite-61DAFB?logo=react&logoColor=black)
![Ollama](https://img.shields.io/badge/AI-Ollama%20%28local%29-000000?logo=ollama&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Knowledge Base
- **Document Q&A (RAG)** — upload PDFs, DOCX, Markdown, spreadsheets, or URLs and ask questions against them. Answers stream in real time with source citations.
- **Issue Investigation** — structured investigation flow with steps, notes, linked docs, linked commands, and resolution tracking.
- **Commands Library** — searchable snippets with syntax highlighting and one-click copy; usage tracking, favorites, and AI explanation on demand.
- **Release Notes** — semver timeline with features, fixes, and breaking changes per project; AI drafting from resolved issues.
- **Runbooks** — step-by-step operational playbooks with optional commands and notes per step.
- **Templates** — built-in Bug Report, Investigation, Deployment Runbook, and Postmortem templates; create custom templates scoped per-project.
- **Multi-project** — top-bar project switcher; all views scope to the selected project or show a unified global view across all.

### AI (100% local via Ollama — zero cost)
- **RAG document Q&A** — `mistral:7b` answers questions using only your documents; cites sources.
- **Auto-tagging** — `gemma3:4b` suggests tags on upload and issue creation.
- **Command explanation** — `gemma3:4b` explains any command snippet on demand.
- **Issue summarization** — `mistral:7b` generates a 3-bullet TL;DR for any issue.
- **AI release drafting** — `mistral:7b` drafts release notes from a date range of resolved issues.

### Search & Filtering
- **Global Search (⌘K)** — hybrid pgvector semantic + PostgreSQL full-text search across all projects.
- **Advanced filters** — issues and documents filterable by status, priority, tags, date range, project, and file type.
- **Saved filter presets** — named filter presets stored per-user and applied in one click.
- **Search history** — last 20 queries surfaced in ⌘K.

### Multi-user & Org Sharing
- **RBAC** — three roles: admin (full access), member (create/edit), viewer (read-only).
- **User management** — invite by email (one-time token), deactivate/reactivate, admin password reset.
- **LDAP / AD** — configure and test LDAP; auto-provisions users on first bind; falls back to local bcrypt.
- **Per-project access control** — members see only their assigned projects.
- **Audit log** — paginated mutation history in Settings with entity-type filter and CSV export.

### Git & External Sync
- **Local git** — browse commit history and branches per project.
- **Commit linking** — link commit SHAs to issues directly from the Git tab.
- **External issue sync** — import from GitHub, Linear, and Jira with source badge chips.

### Notifications & Apprise Hub
- **In-app notifications** — bell icon with unread badge; slide-in panel with Today / Earlier grouping.
- **Stale issue alerts** — background job notifies you of issues open past a configurable threshold.
- **External delivery** — send notifications to any Apprise-compatible channel (Telegram, Slack, Discord, and 80+ others).
- **Daily digest** — scheduled Python job summarises open issues and stale projects each morning.
- **`POST /api/notify`** — public endpoint so your other projects can push notifications into DevBrain.

### Bulk Operations
- **Multi-select** — checkbox column on Issues, Documents, and Commands.
- **Floating action bar** — bulk tag, status change, re-embed, favorite, or delete.
- **Triage view** — dedicated Issues tab showing stale and high-priority open items sorted by urgency.

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
| File parsing | MarkItDown (Python bridge) with JS fallbacks (`pdf-parse`, `mammoth`, `marked`, `xlsx`) |
| Notifications | Apprise (Python) — Telegram, Slack, Discord, and 80+ channels |
| Code highlighting | Shiki |
| Auth | bcrypt + JWT (local); LDAP/AD with auto-provisioning |
| Credentials at rest | AES-256-GCM encryption for OAuth tokens and LDAP bind passwords |
| Infrastructure | Docker Compose (PostgreSQL); Ollama runs natively for direct GPU access |

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
├── client/                   # React + Vite frontend
│   ├── src/
│   │   ├── components/       # issues, docs, commands, search, releases, notifications
│   │   ├── pages/            # Dashboard, Documents, Issues, Commands, Releases,
│   │   │                     # Runbooks, Settings, NotificationLog
│   │   └── lib/              # api.ts, ai.ts, streaming.ts
│   └── e2e/                  # Playwright end-to-end tests
├── server/                   # Express + TypeScript backend
│   ├── routes/               # REST endpoints
│   ├── services/             # ai, ollama, rag, parser, embedder, notifier,
│   │                         # ldap, crypto, backup, exporter, integrations
│   ├── scripts/              # apprise_client.py, digest_scheduler.py, markitdown_bridge.py
│   ├── lib/                  # env, errors, utilities
│   └── db/                   # schema.sql, seed, migrations
├── integrations/
│   ├── claude-code/          # SessionStart/End hooks + /devbrain skill for Claude Code
│   └── antigravity/          # SessionStart/End hooks + /devbrain skill for Antigravity/Gemini CLI
├── shared/
│   └── types.ts              # Shared TypeScript types
├── docker-compose.yml
├── devbrain.ps1              # Windows start script
└── devbrain.sh               # macOS/Linux start script
```

## Optional: Claude API

All AI features run locally by default. To route chat through the Claude API instead:

```env
ANTHROPIC_API_KEY=sk-ant-...
USE_CLAUDE=true
```

The "Enhance with Claude" button in the UI is the only place the Claude API is ever called automatically — all other AI calls always go through Ollama.

## Optional: Apprise Notifications

To enable Telegram (or any other channel) notifications:

```env
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

Or configure channels via Settings > Notification Hub. See `server/scripts/requirements.txt` for Python dependencies (`pip install apprise apscheduler`).

## AI Assistant Integrations

DevBrain ships hooks for two AI CLI tools. Both follow the same pattern: `TASKS.md` for phase-based task tracking, `SESSION.md` per session, and a `/devbrain` skill that lets the model update tasks and write session summaries on demand.

### Claude Code

The `integrations/claude-code/` directory hooks into Claude Code's SessionStart/SessionEnd lifecycle.

**Install (Windows):** `powershell -ExecutionPolicy Bypass -File integrations\claude-code\install.ps1`  
**Install (macOS/Linux):** `cd integrations/claude-code && ./install.sh`

See [integrations/claude-code/README.md](integrations/claude-code/README.md) for full details.

### Antigravity / Gemini CLI

The `integrations/antigravity/` directory hooks into the Gemini CLI / Antigravity SessionStart/SessionEnd lifecycle. Adds automatic archival of completed tasks older than 7 days to `TASKS_ARCHIVE.md`.

**Install (Windows):** `powershell -ExecutionPolicy Bypass -File integrations\antigravity\install.ps1`  
**Install (macOS/Linux):** `cd integrations/antigravity && ./install.sh`

In DevBrain, configure the scan root under **Settings → Antigravity Integration** to surface all your Antigravity-tracked projects in the Projects view with live task and session sync.

See [integrations/antigravity/README.md](integrations/antigravity/README.md) for full details.

## Documentation

- [Feature Guide](docs/FEATURE_GUIDE.md) — complete walkthrough of every feature with step-by-step test instructions
- [Changelog](CHANGELOG.md) — full release history
- [Startup Guide](STARTUP_GUIDE.md) — how to run DevBrain from scratch or after a reboot
- [Contributing](CONTRIBUTING.md) — local setup, branching model, and code standards

## License

MIT — see [LICENSE](LICENSE).

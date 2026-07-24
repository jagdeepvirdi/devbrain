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

### Code Tracking
- **Codes tab** — track source files (`.ts`, `.py`, `.dart`, `.sql`, and 20+ other languages) as their own tracked type, separate from Documents; language-aware chunking via tree-sitter for embedding and search.
- **AI explain & diagrams** — one-click AI explanation of any tracked code file, plus an AI-generated Mermaid diagram of its functions/classes and how they call each other.
- **Staleness detection** — explanations and diagrams are hash-stamped against the file's content; re-uploading a changed file flags them stale instead of silently going out of date.
- **Component overview** — generate one combined architecture doc from every code file tagged to the same component.
- **Duplicate detection** — two-phase (embedding shortlist + line-similarity scoring) scan for near-duplicate code files across a project.
- **Links Graph View** — force-directed visualization of every cross-entity link (docs, issues, commands, releases, runbooks, code) as a companion to the chip-list Linked Items view.

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

### Dashboard & Analytics
- **Issue Throughput** — per-project weekly opened-vs-resolved bar chart over a 12-week window.
- **Embedding Health Trend** — 30-day trend of pending/failed embedding counts, backed by an hourly snapshot scheduler — surfaces the kind of Ollama GPU-thrashing regression documented in `TASKS.md`'s Known Issues before it silently piles up.

### Backups
- **Scheduled local backups** — daily or weekly, with automatic pruning to a configurable retention count (default: keep the last 30).
- **Optional offsite mirror** — every backup can also be pushed to an S3-compatible bucket (AWS S3, MinIO, Backblaze B2, Cloudflare R2) or an SFTP server, with the same retention policy applied remotely. Test the connection before saving; credentials are AES-256-GCM encrypted at rest.
- **Manual export/import** — full JSON export/import and per-project zip export/import, independent of the scheduler.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite + TypeScript, Tailwind CSS, Zustand, React Query |
| Backend | Node.js + Express (TypeScript) |
| Database | PostgreSQL 16 + pgvector |
| AI — RAG / chat | `mistral:7b` via Ollama |
| AI — classification | `gemma3:4b` via Ollama |
| AI — embeddings | `nomic-embed-text` via Ollama |
| AI — optional | Anthropic Claude API or Google Gemini (`AI_PROVIDER` env — `ollama` default) |
| Search | pgvector cosine similarity + PostgreSQL tsvector hybrid |
| File parsing | MarkItDown (Python bridge) with JS fallbacks (`pdf-parse`, `mammoth`, `marked`, `xlsx`) |
| Notifications | Apprise (Python) — Telegram, Slack, Discord, and 80+ channels |
| Code highlighting | Shiki |
| Auth | bcrypt + JWT (local); LDAP/AD with auto-provisioning |
| Credentials at rest | AES-256-GCM encryption for OAuth tokens, LDAP bind passwords, and offsite backup credentials |
| Offsite backups (optional) | `@aws-sdk/client-s3` (S3-compatible buckets) or `ssh2-sftp-client` (SFTP) |
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
cp .env.example server/.env   # edit server/.env — set AUTH_PASSWORD, JWT_SECRET, ENCRYPTION_KEY
```

Edit `server/.env` at minimum:

```env
JWT_SECRET=<random 32-char string>       # openssl rand -base64 32
ENCRYPTION_KEY=<a different random 32-char string>   # openssl rand -base64 32
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
| `OLLAMA_CHAT_MODEL` | `mistral` | Model used for RAG chat (Ollama provider) |
| `PORT` | `3001` | Express server port |
| `JWT_SECRET` | — | **Required** — min 32 chars, signs session tokens |
| `ENCRYPTION_KEY` | — | **Required** — min 32 chars, encrypts stored secrets at rest (LDAP/S3/SFTP/integration credentials); keep distinct from `JWT_SECRET` |
| `AUTH_PASSWORD` | — | Login password (required in production) |
| `AI_PROVIDER` | `ollama` | AI backend: `ollama` \| `claude` \| `gemini` |
| `ANTHROPIC_API_KEY` | — | Required when `AI_PROVIDER=claude` |
| `GEMINI_API_KEY` | — | Required when `AI_PROVIDER=gemini` |
| `GEMINI_CHAT_MODEL` | `gemini-2.0-flash` | Gemini model (free-tier default) |

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
│   │   ├── pages/            # Dashboard, Documents, Codes, Issues, Commands, Releases,
│   │   │                     # Runbooks, Graph, Settings, NotificationLog
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

## Optional: Alternative AI Providers

All AI features run locally via Ollama by default. To switch providers, set `AI_PROVIDER` in `server/.env`:

**Claude API:**
```env
AI_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
```

**Google Gemini (free tier — 1500 RPD / 1M TPM):**
```env
AI_PROVIDER=gemini
GEMINI_API_KEY=AIza...
GEMINI_CHAT_MODEL=gemini-2.0-flash
```

Embeddings always remain on local Ollama (`nomic-embed-text`) regardless of the `AI_PROVIDER` setting. The active provider and model are shown in **Settings → General → AI Backend**.

## Optional: Apprise Notifications

Configure channels via **Settings → Notification Hub** — paste any Apprise URL (Telegram, Slack,
Discord, Pushover, email, 80+ others) or use the built-in Telegram bot-token/chat-id quick form. No
`.env` setup required. See `server/scripts/requirements.txt` for Python dependencies (`pip install
apprise apscheduler`).

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

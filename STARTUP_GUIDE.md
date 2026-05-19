# DevBrain — Startup Guide

How to run DevBrain from scratch on a fresh machine or after a reboot.
Two modes are covered: **Development** (hot-reload, recommended during active work)
and **Production** (Docker-managed server, for stable daily use).

---

## Prerequisites

Make sure the following are installed before you start:

| Tool | Purpose | Check |
|------|---------|-------|
| Docker Desktop | Runs PostgreSQL (and app container in prod) | `docker --version` |
| Node.js 20+ | Client + server dev mode | `node --version` |
| Ollama (native) | Local AI — GPU inference on RTX 2060 Max-Q | `ollama --version` |

> **Why Ollama is NOT in Docker:** Running Ollama as a native process gives direct GPU access.
> The Docker container cannot reliably use the NVIDIA RTX 2060 Max-Q on this machine.
> Never run a containerised Ollama alongside the native one — they will fight over VRAM.

---

## Step 1 — Start Ollama (native, always required)

Ollama must be running before the server starts, or RAG and AI features will fail silently.

```powershell
# Start Ollama in the background (it binds to port 11434)
ollama serve
```

Open a new terminal and verify it's up:

```powershell
curl http://localhost:11434/api/tags
```

### One-time model pull (first run only)

```powershell
ollama pull mistral        # RAG Q&A — ~4.5 GB
ollama pull gemma3:4b      # Classification / summarization — ~3.5 GB
ollama pull nomic-embed-text  # Embeddings — ~300 MB
```

---

## Step 2 — Start Docker (PostgreSQL)

The `docker-compose.yml` at the repo root manages PostgreSQL with the pgvector extension.

```powershell
# From the devbrain/ root directory
docker compose up -d postgres
```

PostgreSQL will be available at `localhost:5433` (host port 5433 → container port 5432).

Verify it's healthy:

```powershell
docker compose ps
# postgres should show "healthy"
```

> **Port note:** The host port is **5433**, not 5432. This avoids conflicts if you have
> another Postgres instance running locally. The `DATABASE_URL` in `server/.env` already
> reflects this: `postgresql://devbrain:devbrain@localhost:5433/devbrain`

---

## Step 3A — Development Mode (recommended)

Run the backend and frontend as separate hot-reload dev servers.

### Backend (Express + tsx watch)

```powershell
cd server
npm install        # first time only
npm run dev
```

The server starts on **http://localhost:3001**.
On first run it auto-creates all tables and seeds the 5 default projects.

### Frontend (Vite)

Open a second terminal:

```powershell
cd client
npm install        # first time only
npm run dev
```

The client starts on **http://localhost:5173**.

### Verify

Open `http://localhost:5173` in your browser.
The Overview dashboard should load with the 5 seeded projects (PlayCru, WealthView Pro, etc.).

---

## Step 3B — Production Mode (Docker app container)

This builds and runs the compiled server inside Docker alongside Postgres.
The frontend must still be built separately.

```powershell
# Build and start both postgres + app container
docker compose up -d --build
```

The API will be available at **http://localhost:3001**.

To serve the frontend in production, build it first:

```powershell
cd client
npm run build
# Serve the dist/ folder via any static server, e.g.:
npx serve dist -p 5173
```

---

## Environment Variables

The server reads from `server/.env`. The file is already configured for local development:

```env
DATABASE_URL=postgresql://devbrain:devbrain@localhost:5433/devbrain
OLLAMA_URL=http://localhost:11434
OLLAMA_CHAT_MODEL=mistral
PORT=3001
JWT_SECRET=devbrain-dev-secret-change-in-production
ANTHROPIC_API_KEY=
USE_CLAUDE=false
NODE_ENV=development
```

To enable Claude API (optional, manual only):
```env
ANTHROPIC_API_KEY=sk-ant-...
USE_CLAUDE=true
```

---

## Full Startup Checklist

```
[ ] 1. ollama serve                        (terminal 1 — keep running)
[ ] 2. docker compose up -d postgres       (from devbrain/ root)
[ ] 3. cd server && npm run dev            (terminal 2 — keep running)
[ ] 4. cd client && npm run dev            (terminal 3 — keep running)
[ ] 5. Open http://localhost:5173
```

---

## Stopping Everything

```powershell
# Stop Docker containers (data is preserved in pg_data volume)
docker compose down

# Stop Ollama
# Close the terminal running `ollama serve`, or:
taskkill /IM ollama.exe /F   # Windows

# Stop dev servers
# Ctrl+C in each terminal
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `ECONNREFUSED localhost:5433` | Postgres container not running | `docker compose up -d postgres` |
| `ECONNREFUSED localhost:11434` | Ollama not running | `ollama serve` |
| AI responses return errors | Model not pulled | `ollama pull mistral` |
| Port 5173 already in use | Another Vite dev server | Kill it or change port in `vite.config.ts` |
| Port 3001 already in use | Previous server still running | `netstat -ano \| findstr 3001` then kill the PID |
| Blank dashboard on first load | DB seeding in progress | Wait 5s and refresh |
| `pgvector` extension error | Wrong Postgres image | Ensure `pgvector/pgvector:pg16` in compose file |

---

## Port Reference

| Service | URL | Notes |
|---------|-----|-------|
| Frontend (dev) | http://localhost:5173 | Vite dev server |
| Backend API | http://localhost:3001 | Express server |
| PostgreSQL | localhost:5433 | Host port (container uses 5432 internally) |
| Ollama API | http://localhost:11434 | Native process |

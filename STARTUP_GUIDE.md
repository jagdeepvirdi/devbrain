# DevBrain — Startup Guide

How to run DevBrain from scratch on a fresh machine or after a reboot.
The unified `devbrain.ps1` (Windows) / `devbrain.sh` (macOS/Linux) scripts handle
Ollama, Postgres, migrations, and the app servers in a single command.

---

## Prerequisites

Install all of the following before running the scripts for the first time.

| Tool | Purpose | Check |
|------|---------|-------|
| **Node.js 20+** | Client + server | `node --version` |
| **Docker Desktop** | Runs PostgreSQL via Compose | `docker --version` |
| **Ollama (native)** | Local AI inference on RTX 2060 Max-Q | `ollama --version` |
| **npm deps installed** | `server/` and `client/` node_modules | see below |

> **Why Ollama is NOT in Docker:** Running Ollama as a native process gives direct GPU
> access. A containerised Ollama cannot reliably use the NVIDIA RTX 2060 Max-Q on this
> machine. Never run a containerised Ollama alongside the native one — they will fight
> over VRAM.

### First-time dependency install

```powershell
# Windows
cd server; npm install; cd ..
cd client; npm install; cd ..
```

```bash
# macOS / Linux
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### First-time `.env` setup

```powershell
# Windows — copy the example and fill in required values
Copy-Item .env.example server\.env
```

```bash
# macOS / Linux
cp .env.example server/.env
```

Minimum required changes in `server/.env`:

| Variable | What to set |
|----------|------------|
| `JWT_SECRET` | Any 32+ char random string. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AUTH_PASSWORD` | Required in **prod** mode. Leave blank in dev to skip the login gate. |

### First-time Ollama model pull

```bash
ollama pull mistral          # RAG Q&A — ~4.5 GB VRAM
ollama pull gemma3:4b        # Classification / summarisation — ~3.5 GB VRAM
ollama pull nomic-embed-text # Embeddings — ~300 MB VRAM
```

---

## Running the scripts

### Windows — `devbrain.ps1`

```powershell
# Development (hot-reload — recommended during active work)
.\devbrain.ps1 dev start

# Stop development
.\devbrain.ps1 dev stop

# Production (build + start)
.\devbrain.ps1 prod start

# Production — restart without rebuilding (fast)
.\devbrain.ps1 prod start -SkipBuild

# Stop production
.\devbrain.ps1 prod stop
```

If PowerShell blocks the script with an execution-policy error:

```powershell
powershell -ExecutionPolicy Bypass -File .\devbrain.ps1 dev start
```

### macOS / Linux — `devbrain.sh`

```bash
# Development (hot-reload — recommended during active work)
./devbrain.sh dev start

# Development with live log streaming
./devbrain.sh dev start --follow

# Stop development
./devbrain.sh dev stop

# Production (build + start)
./devbrain.sh prod start

# Production — restart without rebuilding (fast)
./devbrain.sh prod start --skip-build

# Production with live log streaming
./devbrain.sh prod start --follow

# Stop production
./devbrain.sh prod stop
```

If the script is not executable:

```bash
chmod +x devbrain.sh
```

---

## What the scripts do automatically

Every `start` command runs these prechecks and steps in order.

### Dev start

| Step | What happens |
|------|-------------|
| **Ollama check** | Probes `localhost:11434`. If Ollama is not running, starts `ollama serve` in the background and waits up to 4 s. Fails fast if Ollama is not installed. |
| **Postgres start** | Runs `docker compose up -d postgres`. Polls the Docker healthcheck every 2 s for up to 50 s. |
| **Auth warning** | Warns (does not fail) if `AUTH_PASSWORD` is missing from `server/.env` — dev mode runs without a login gate. |
| **Migrations** | Runs `node server/db/migrate-org-v2.mjs`. Fails if the DB is unreachable or schema errors. |
| **Server** | Opens `npm run dev` (tsx watch on `:3001`) in a new window (PS) / background log file (sh). |
| **Client** | Opens `npm run dev` (Vite on `:5174`) in a new window (PS) / background log file (sh). |
| **PID tracking** | Writes process IDs to `.devbrain-pids` so `dev stop` can kill them cleanly. |

### Prod start (additional steps)

| Step | What happens |
|------|-------------|
| **Env check** | Fails if `server/.env` is missing. Warns if `JWT_SECRET` is still the dev default. **Fails** if `AUTH_PASSWORD` is not set. |
| **Build** | Runs `tsc` for the server, then `vite build` for the client. Copies `client/dist` → `server/public`. Skipped with `-SkipBuild` / `--skip-build` (verifies artifacts exist first). |
| **Server** | Opens `npm run start` (compiled `node dist/index.js` on `:3001`). Client is served as static files from `server/public`. |

### Stop

`dev stop` / `prod stop` kills all tracked PIDs (and their process trees), then runs
`docker compose stop postgres`. Data in the `pg_data` Docker volume is preserved.

---

## URLs after start

### Dev mode

| Service | URL |
|---------|-----|
| Frontend (Vite) | http://localhost:5174 |
| Backend API | http://localhost:3001 |
| PostgreSQL | `localhost:5435` (host) |
| Ollama API | http://localhost:11434 |

### Prod mode

| Service | URL |
|---------|-----|
| App (API + static client) | http://localhost:3001 |
| PostgreSQL | `localhost:5435` (host) |
| Ollama API | http://localhost:11434 |

> **Port note:** The Docker Compose host port is **5435**, not 5432. This avoids conflicts
> with any local Postgres instance. `DATABASE_URL` in `server/.env` already reflects this.

---

## Log files (macOS / Linux only)

The `.sh` script writes all process output to `logs/` at the repo root:

| File | Contents |
|------|----------|
| `logs/server.log` | Express server stdout/stderr |
| `logs/client.log` | Vite dev server stdout/stderr |
| `logs/ollama.log` | Ollama stdout/stderr (only when the script starts Ollama) |

Tail live:

```bash
tail -f logs/server.log logs/client.log
```

On Windows, each process opens in its own PowerShell window.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `Ollama failed to start — is it installed?` | Ollama binary not on PATH | Install from https://ollama.com/download or `winget install Ollama.Ollama` |
| `Docker Compose failed — is Docker Desktop running?` | Docker not started | Open Docker Desktop and wait for the engine to be ready |
| `Postgres did not become healthy in time` | Slow disk or image not pulled | Run `docker compose pull postgres` then retry |
| `Migration failed` | DB unreachable or schema mismatch | Confirm Postgres is healthy: `docker compose ps` |
| `AUTH_PASSWORD not set` (prod) | Missing `.env` value | Add `AUTH_PASSWORD=your-strong-password` to `server/.env` |
| `server/dist/index.js not found` | Used `-SkipBuild` without a prior build | Run `.\devbrain.ps1 prod start` (without `-SkipBuild`) once |
| `ECONNREFUSED localhost:5435` | Postgres container not running | `docker compose up -d postgres` |
| `ECONNREFUSED localhost:11434` | Ollama not running | `ollama serve` |
| AI features return errors | Model not pulled | `ollama pull mistral` |
| Port 5174 already in use | Another Vite server running | Kill it or change the port in `vite.config.ts` |
| Port 3001 already in use | Previous server still running | `netstat -ano \| findstr 3001` then kill the PID |
| Blank dashboard on first load | DB seeding in progress | Wait 5 s and refresh |
| PowerShell execution policy error | Script unsigned | `powershell -ExecutionPolicy Bypass -File .\devbrain.ps1 dev start` |

---

## Manual startup (fallback — no scripts)

If the scripts are unavailable, start each component individually.

```powershell
# 1. Ollama (terminal 1 — keep running)
ollama serve

# 2. Postgres
docker compose up -d postgres

# 3. Server (terminal 2)
cd server
npm run dev   # dev mode
# or: npm run start   # prod (requires prior build)

# 4. Client (terminal 3 — dev only)
cd client
npm run dev
```

Stop:

```powershell
docker compose stop postgres
# Ctrl+C in each terminal, or:
taskkill /IM ollama.exe /F   # Windows
```

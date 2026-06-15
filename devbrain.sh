#!/usr/bin/env bash
# devbrain.sh — Unified dev/prod start, stop, restart, and status (macOS / Linux)
#
# Usage:
#   ./devbrain.sh dev  start [--follow]              # hot-reload dev environment
#   ./devbrain.sh dev  stop                          # stop dev servers and Postgres
#   ./devbrain.sh dev  restart [--follow]            # stop then start dev
#   ./devbrain.sh dev  status                        # show running status of all services
#   ./devbrain.sh prod start [--skip-build]          # build + start production
#   ./devbrain.sh prod start --follow                # build, start, then tail logs
#   ./devbrain.sh prod stop                          # stop prod server and Postgres
#   ./devbrain.sh prod restart [--skip-build]        # stop, build, then start prod
#   ./devbrain.sh prod restart --follow              # restart then tail logs
#   ./devbrain.sh prod status                        # show running status of all services

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$ROOT/.devbrain-pids"
LOG_DIR="$ROOT/logs"

MODE="${1:-}"
ACTION="${2:-}"
SKIP_BUILD=false
FOLLOW=false

for arg in "${@:3}"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
        --follow)     FOLLOW=true ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

if [[ -z "$MODE" || -z "$ACTION" ]]; then
    echo "Usage: $0 <dev|prod> <start|stop|restart|status> [--skip-build] [--follow]"
    exit 1
fi

# ── Helpers ───────────────────────────────────────────────────────────────────
step() { printf "\n\033[36m==> %s\033[0m\n" "$*"; }
ok()   { printf "    \033[32m[OK]\033[0m %s\n" "$*"; }
warn() { printf "    \033[33m[!!]\033[0m %s\n" "$*"; }
fail() { printf "    \033[31m[!!]\033[0m %s\n" "$*"; exit 1; }

# ── Ollama ────────────────────────────────────────────────────────────────────
start_ollama() {
    step "Checking Ollama on port 11434..."
    if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        ok "Ollama already running"; return
    fi
    command -v ollama > /dev/null 2>&1 || fail "Ollama not found — install from https://ollama.com/download"
    printf "    Starting Ollama...\n"
    ollama serve >> "$LOG_DIR/ollama.log" 2>&1 &
    echo $! >> "$PID_FILE"
    sleep 4
    curl -sf http://localhost:11434/api/tags > /dev/null 2>&1 || fail "Ollama failed to start — check logs/ollama.log"
    ok "Ollama started"
}

# ── Postgres ──────────────────────────────────────────────────────────────────
start_postgres() {
    step "Starting Postgres via Docker Compose..."
    cd "$ROOT"
    docker compose up -d postgres || fail "Docker Compose failed — is Docker running?"

    printf "    Waiting for Postgres healthcheck"
    local i=0
    while true; do
        sleep 2
        local id; id=$(docker compose ps -q postgres 2>/dev/null || true)
        if [[ -n "$id" ]]; then
            local h; h=$(docker inspect --format "{{.State.Health.Status}}" "$id" 2>/dev/null || true)
            if [[ "$h" == "healthy" ]]; then printf " ready!\n"; break; fi
        fi
        printf "."
        i=$((i + 1))
        [[ $i -gt 25 ]] && fail "Postgres did not become healthy in time"
    done
}

stop_postgres() {
    step "Stopping Postgres..."
    cd "$ROOT"
    docker compose stop postgres
    ok "Postgres stopped"
}

# ── Migrations ────────────────────────────────────────────────────────────────
run_migrations() {
    step "Running database migrations..."
    cd "$ROOT/server"
    node db/migrate-org-v2.mjs || fail "Migration failed — check DB connection and schema"
    ok "Migrations up to date"
}

# ── Env check (prod only) ─────────────────────────────────────────────────────
assert_prod_env() {
    step "Checking environment..."
    local env_file="$ROOT/server/.env"
    [[ -f "$env_file" ]] || fail "server/.env not found — copy .env.example and fill in values"
    if grep -qE "JWT_SECRET\s*=\s*devbrain-dev-secret" "$env_file"; then
        warn "JWT_SECRET is still the dev default — change it before exposing to a network"
        printf "    Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"\n"
    fi
    grep -qE "AUTH_PASSWORD\s*=\s*.+" "$env_file" || \
        fail "AUTH_PASSWORD not set in server/.env — add: AUTH_PASSWORD=your-strong-password"
    ok "Environment checks passed"
}

# ── PID tracking ──────────────────────────────────────────────────────────────
stop_pids() {
    if [[ ! -f "$PID_FILE" ]]; then
        warn "No PID file found — nothing to stop"; return
    fi
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        if kill -0 "$pid" 2>/dev/null; then
            pkill -P "$pid" 2>/dev/null || true   # children first
            kill "$pid" 2>/dev/null || true
            ok "Stopped process $pid"
        else
            warn "Process $pid already gone"
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
}

# ── Build (prod only) ─────────────────────────────────────────────────────────
build_all() {
    if $SKIP_BUILD; then
        printf "    [SKIP] Build skipped (--skip-build)\n"
        [[ -f "$ROOT/server/dist/index.js" ]]     || fail "server/dist/index.js not found — run without --skip-build first"
        [[ -f "$ROOT/server/public/index.html" ]] || fail "server/public/index.html not found — run without --skip-build first"
        ok "Using existing build artifacts"; return
    fi

    step "Building server (tsc)..."
    cd "$ROOT/server"; npm run build
    ok "Server compiled to server/dist"

    step "Building client (vite build)..."
    cd "$ROOT/client"; npm run build
    ok "Client built to client/dist"

    step "Copying client build → server/public..."
    rm -rf "$ROOT/server/public"
    cp -r "$ROOT/client/dist" "$ROOT/server/public"
    ok "Client assets in server/public"
}

# ══════════════════════════════════════════════════════════════════════════════
# DEV
# ══════════════════════════════════════════════════════════════════════════════
dev_start() {
    mkdir -p "$LOG_DIR"
    : > "$PID_FILE"   # reset

    start_ollama
    start_postgres

    local env_file="$ROOT/server/.env"
    if [[ -f "$env_file" ]] && ! grep -qE "AUTH_PASSWORD\s*=\s*.+" "$env_file"; then
        warn "AUTH_PASSWORD not set — running without login gate (dev mode)"
    fi

    run_migrations

    step "Starting Express server (tsx watch on :3001)..."
    cd "$ROOT/server"
    npm run dev >> "$LOG_DIR/server.log" 2>&1 &
    echo $! >> "$PID_FILE"
    ok "Server PID $! → logs/server.log"

    step "Starting Vite dev server (:5174)..."
    cd "$ROOT/client"
    npm run dev >> "$LOG_DIR/client.log" 2>&1 &
    echo $! >> "$PID_FILE"
    ok "Client PID $! → logs/client.log"

    printf "\n  \033[32mDevBrain DEV started\033[0m\n"
    printf "  ─────────────────────────────────────────\n"
    printf "  Frontend  http://localhost:5174\n"
    printf "  Backend   http://localhost:3001\n"
    printf "  Postgres  localhost:5435\n"
    printf "  Ollama    http://localhost:11434\n"
    printf "\n"
    printf "  Logs:  tail -f logs/server.log logs/client.log\n"
    printf "  Stop:  ./devbrain.sh dev stop\n"
    printf "\n"

    $FOLLOW && exec tail -f "$LOG_DIR/server.log" "$LOG_DIR/client.log"
}

dev_stop() {
    step "Stopping dev servers..."
    stop_pids
    stop_postgres
    printf "\n  \033[32mDevBrain DEV stopped.\033[0m\n\n"
}

# ══════════════════════════════════════════════════════════════════════════════
# PROD
# ══════════════════════════════════════════════════════════════════════════════
prod_start() {
    mkdir -p "$LOG_DIR"
    : > "$PID_FILE"   # reset

    assert_prod_env
    start_ollama
    build_all
    start_postgres
    run_migrations

    step "Starting Express server (node dist/index.js on :3001)..."
    cd "$ROOT/server"
    npm run start >> "$LOG_DIR/server.log" 2>&1 &
    echo $! >> "$PID_FILE"
    ok "Server PID $! → logs/server.log"

    sleep 2

    printf "\n  \033[32mDevBrain PROD started\033[0m\n"
    printf "  ─────────────────────────────────────────\n"
    printf "  App       http://localhost:3001  (API + static client)\n"
    printf "  Postgres  localhost:5435\n"
    printf "  Ollama    http://localhost:11434\n"
    printf "\n"
    printf "  Logs:  tail -f logs/server.log\n"
    printf "  Stop:  ./devbrain.sh prod stop\n"
    printf "  Tip:   ./devbrain.sh prod start --skip-build  (restart without rebuilding)\n"
    printf "\n"

    $FOLLOW && exec tail -f "$LOG_DIR/server.log"
}

prod_stop() {
    step "Stopping production server..."
    stop_pids
    stop_postgres
    printf "\n  \033[32mDevBrain PROD stopped.\033[0m\n\n"
}

# ── Status ────────────────────────────────────────────────────────────────────
show_status() {
    local include_client="${1:-false}"
    step "DevBrain status..."

    # Ollama
    if curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
        ok "Ollama        running   http://localhost:11434"
    else
        warn "Ollama        NOT running"
    fi

    # Postgres
    local id; id=$(docker compose ps -q postgres 2>/dev/null || true)
    if [[ -n "$id" ]]; then
        local h; h=$(docker inspect --format "{{.State.Health.Status}}" "$id" 2>/dev/null || true)
        if [[ "$h" == "healthy" ]]; then
            ok "Postgres      healthy   localhost:5435"
        else
            warn "Postgres      $h"
        fi
    else
        warn "Postgres      NOT running"
    fi

    # Server
    if nc -z localhost 3001 2>/dev/null; then
        ok "Server        running   http://localhost:3001"
    else
        warn "Server        NOT running"
    fi

    # Vite client (dev only)
    if [[ "$include_client" == "true" ]]; then
        if nc -z localhost 5174 2>/dev/null; then
            ok "Client        running   http://localhost:5174"
        else
            warn "Client        NOT running"
        fi
    fi

    # Tracked PIDs
    if [[ -f "$PID_FILE" ]]; then
        printf "\n    Tracked PIDs: %s\n" "$(tr '\n' ' ' < "$PID_FILE")"
    else
        printf "\n    No PID file (servers may not be managed by this script)\n"
    fi
    printf "\n"
}

# ── Restart ───────────────────────────────────────────────────────────────────
dev_restart()  { dev_stop;  dev_start; }
prod_restart() { prod_stop; prod_start; }

# ── Dispatch ──────────────────────────────────────────────────────────────────
case "$MODE/$ACTION" in
    dev/start)    dev_start ;;
    dev/stop)     dev_stop ;;
    dev/restart)  dev_restart ;;
    dev/status)   show_status true ;;
    prod/start)   prod_start ;;
    prod/stop)    prod_stop ;;
    prod/restart) prod_restart ;;
    prod/status)  show_status false ;;
    *) printf "Unknown command: %s %s\nUsage: %s <dev|prod> <start|stop|restart|status>\n" "$MODE" "$ACTION" "$0"; exit 1 ;;
esac

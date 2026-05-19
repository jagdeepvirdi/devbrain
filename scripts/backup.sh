#!/usr/bin/env bash
# backup.sh — Dump PostgreSQL to a timestamped file
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILE="$BACKUP_DIR/devbrain_${TIMESTAMP}.sql.gz"

# Load env if .env present
if [ -f "$ROOT/server/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$ROOT/server/.env"; set +a
fi

DB_URL="${DATABASE_URL:-postgresql://devbrain:devbrain@localhost:5433/devbrain}"

echo "Backing up database to $FILE..."

# Use pg_dump via docker if running in production (postgres container)
if docker compose -f "$ROOT/docker-compose.prod.yml" ps postgres 2>/dev/null | grep -q "Up"; then
  docker compose -f "$ROOT/docker-compose.prod.yml" exec -T postgres \
    pg_dump -U "${POSTGRES_USER:-devbrain}" "${POSTGRES_DB:-devbrain}" \
    | gzip > "$FILE"
else
  pg_dump "$DB_URL" | gzip > "$FILE"
fi

echo "Backup saved: $FILE ($(du -sh "$FILE" | cut -f1))"

# Keep last 30 backups
ls -t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n +31 | xargs -r rm --
echo "Old backups pruned (keeping 30)."

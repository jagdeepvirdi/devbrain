#!/usr/bin/env bash
# restore.sh — Restore a backup dump into the database
# Usage: ./restore.sh backups/devbrain_20240519_120000.sql.gz
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Usage: $0 <backup_file.sql.gz>"
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "Error: file not found: $FILE"
  exit 1
fi

# Load env if .env present
if [ -f "$ROOT/server/.env" ]; then
  set -a; source "$ROOT/server/.env"; set +a
fi

DB_URL="${DATABASE_URL:-postgresql://devbrain:devbrain@localhost:5433/devbrain}"

echo "WARNING: This will overwrite the current database."
read -rp "Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

echo "Restoring from $FILE..."

if docker compose -f "$ROOT/docker-compose.prod.yml" ps postgres 2>/dev/null | grep -q "Up"; then
  gunzip -c "$FILE" | docker compose -f "$ROOT/docker-compose.prod.yml" exec -T postgres \
    psql -U "${POSTGRES_USER:-devbrain}" "${POSTGRES_DB:-devbrain}"
else
  gunzip -c "$FILE" | psql "$DB_URL"
fi

echo "Restore complete."

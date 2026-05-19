#!/usr/bin/env bash
# deploy.sh — Build client, rebuild app container, restart stack
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "DevBrain deploy starting..."

# Build client
cd "$ROOT/client"
echo "  Building client..."
npm run build

# Bring stack up / rebuild
cd "$ROOT"
echo "  Starting production stack..."
docker compose -f docker-compose.prod.yml up -d --build

echo "  Deploy complete."
echo "  Check logs: docker compose -f docker-compose.prod.yml logs -f app"

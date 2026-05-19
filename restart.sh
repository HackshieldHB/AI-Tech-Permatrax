#!/bin/bash
# PermaTrax — rebuild + migrate + PM2 reload (after code updates)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
cd "$ROOT_DIR"

# shellcheck source=scripts/production-common.sh
source "$ROOT_DIR/scripts/production-common.sh"

GREEN='\033[0;32m'
NC='\033[0m'

echo "Restarting PermaTrax services..."

# Optional: pull latest code
# git pull origin main

production_load_env "$ROOT_DIR"

echo "Ensuring PostgreSQL and Redis are up..."
production_start_data_services "$ROOT_DIR" false
production_wait_container_healthy permatrax-postgres PostgreSQL 30 || exit 1
production_wait_container_healthy permatrax-redis Redis 30 || exit 1

echo "Rebuilding API..."
(
  cd "$ROOT_DIR/apps/api"
  pnpm build
)

echo "Rebuilding Web..."
(
  cd "$ROOT_DIR/apps/web"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.permatrax.tech/api}"
  export NEXT_PUBLIC_MAPBOX_TOKEN="${NEXT_PUBLIC_MAPBOX_TOKEN:-}"
  pnpm build
)

echo "Running database migrations..."
(
  cd "$ROOT_DIR/packages/db"
  production_load_env "$ROOT_DIR"
  npx prisma migrate deploy
  npx prisma generate
)

if command -v pm2 &>/dev/null; then
  pm2 reload ecosystem.config.js --env production --update-env
  pm2 save
else
  echo "PM2 not found — run ./start.sh instead"
  exit 1
fi

echo -e "${GREEN}✅ Restart complete${NC}"
pm2 status

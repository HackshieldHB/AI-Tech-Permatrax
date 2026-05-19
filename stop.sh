#!/bin/bash
# PermaTrax — stop PM2 apps; optionally stop Docker (Postgres + Redis)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

# shellcheck source=scripts/production-common.sh
source "$ROOT_DIR/scripts/production-common.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

production_load_env "$ROOT_DIR"

echo "Stopping PermaTrax services..."

if command -v pm2 &>/dev/null; then
  pm2 stop permatrax-api 2>/dev/null && echo -e "  ${GREEN}✅ API stopped${NC}" || echo -e "  ${YELLOW}⚠️  API was not running${NC}"
  pm2 stop permatrax-web 2>/dev/null && echo -e "  ${GREEN}✅ Web stopped${NC}" || echo -e "  ${YELLOW}⚠️  Web was not running${NC}"
  pm2 save 2>/dev/null || true
else
  echo -e "  ${YELLOW}⚠️  PM2 not installed — skipping${NC}"
fi

fuser -k 3001/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true

echo ""
read -r -p "Stop PostgreSQL and Redis too? (y/N): " STOP_DATA
if [[ "$STOP_DATA" =~ ^[Yy]$ ]]; then
  if command -v docker &>/dev/null || sudo docker info &>/dev/null 2>&1; then
    production_docker_compose "$ROOT_DIR" stop postgres redis
    echo -e "  ${GREEN}✅ PostgreSQL and Redis stopped${NC}"
    echo -e "  ${YELLOW}⚠️  Data is preserved in Docker volumes${NC}"
  else
    echo -e "  ${YELLOW}⚠️  Docker not available — skipped data services${NC}"
  fi
else
  echo -e "  ${YELLOW}ℹ️  PostgreSQL and Redis still running (data preserved)${NC}"
fi

echo ""
echo -e "${GREEN}All stopped.${NC} Run ./start.sh to start again."

#!/bin/bash
# PermaTrax — start data services (Docker) + API/Web (PM2)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"

# shellcheck source=scripts/production-common.sh
source "$ROOT_DIR/scripts/production-common.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC} $*"; }

production_load_env "$ROOT_DIR"
mkdir -p "$ROOT_DIR/logs"

if ! command -v docker &>/dev/null && ! sudo docker info &>/dev/null 2>&1; then
  echo -e "${RED}❌ Docker not installed. Run ./full-setup.sh first.${NC}"
  exit 1
fi

if ! command -v pm2 &>/dev/null; then
  echo -e "${RED}❌ PM2 not installed. Run ./full-setup.sh first.${NC}"
  exit 1
fi

API_MAIN="$ROOT_DIR/apps/api/dist/apps/api/src/main.js"
if [[ ! -f "$API_MAIN" ]]; then
  echo -e "${RED}❌ API build missing. Run ./full-setup.sh or: cd apps/api && pnpm build${NC}"
  exit 1
fi

if [[ ! -d "$ROOT_DIR/apps/web/.next" ]]; then
  echo -e "${RED}❌ Web build missing. Run ./full-setup.sh or: cd apps/web && pnpm build${NC}"
  exit 1
fi

log_info "Starting PostgreSQL and Redis..."
production_start_data_services "$ROOT_DIR" false

log_info "Waiting for PostgreSQL (30s timeout)..."
production_wait_container_healthy permatrax-postgres PostgreSQL 30 || exit 1
log_ok "PostgreSQL ready"

log_info "Waiting for Redis (30s timeout)..."
production_wait_container_healthy permatrax-redis Redis 30 || exit 1
log_ok "Redis ready"
log_ok "Data services ready"

echo "Starting PermaTrax (PM2)..."
fuser -k 3001/tcp 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true
sleep 1

cd "$ROOT_DIR"
production_load_env "$ROOT_DIR"

if pm2 describe permatrax-api &>/dev/null; then
  pm2 reload ecosystem.config.js --env production --update-env
else
  pm2 start ecosystem.config.js --env production
fi

pm2 save

sleep 3

pm2_app_status() {
  local name="$1"
  pm2 jlist 2>/dev/null | node -e "
    const apps = JSON.parse(require('fs').readFileSync(0, 'utf8'));
    const a = apps.find((x) => x.name === process.argv[1]);
    console.log(a?.pm2_env?.status || 'unknown');
  " "$name" 2>/dev/null || echo "unknown"
}

API_STATUS="$(pm2_app_status permatrax-api)"
WEB_STATUS="$(pm2_app_status permatrax-web)"

echo ""
echo "=================================="
if [[ "$API_STATUS" == "online" ]]; then
  echo -e "  API  ${GREEN}✅ online${NC}"
else
  echo -e "  API  ${RED}❌ ${API_STATUS}${NC}"
fi
if [[ "$WEB_STATUS" == "online" ]]; then
  echo -e "  Web  ${GREEN}✅ online${NC}"
else
  echo -e "  Web  ${RED}❌ ${WEB_STATUS}${NC}"
fi
echo ""
echo "  https://permatrax.tech"
echo "  https://api.permatrax.tech"
echo ""
echo "  pm2 logs        — live logs"
echo "  pm2 monit       — monitor"
echo "  ./stop.sh       — stop all"
echo "=================================="

if [[ "$API_STATUS" != "online" ]] || [[ "$WEB_STATUS" != "online" ]]; then
  exit 1
fi

#!/usr/bin/env bash
# PermaTrack production — start API + Web from project root (Linux/macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

API_PID_FILE="$ROOT/.pids/api.pid"
WEB_PID_FILE="$ROOT/.pids/web.pid"
API_LOG="$ROOT/logs/api.log"
WEB_LOG="$ROOT/logs/web.log"

mkdir -p "$ROOT/logs" "$ROOT/.pids"

is_running() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  rm -f "$pid_file"
  return 1
}

start_api() {
  if is_running "$API_PID_FILE"; then
    echo -e "${YELLOW}[API] Already running (PID $(cat "$API_PID_FILE")) — skipped${NC}"
    return 0
  fi

  if [[ ! -f "$ROOT/apps/api/dist/apps/api/src/main.js" ]]; then
    echo -e "${RED}[API] Build not found. Run: cd apps/api && pnpm build${NC}"
    return 1
  fi

  (
    cd "$ROOT/apps/api"
    nohup node dist/apps/api/src/main >>"$API_LOG" 2>&1 &
    echo $! >"$API_PID_FILE"
  )

  echo -e "${GREEN}[API] Started (PID $(cat "$API_PID_FILE")) → $API_LOG${NC}"
}

start_web() {
  if is_running "$WEB_PID_FILE"; then
    echo -e "${YELLOW}[Web] Already running (PID $(cat "$WEB_PID_FILE")) — skipped${NC}"
    return 0
  fi

  (
    cd "$ROOT/apps/web"
    nohup pnpm start >>"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID_FILE"
  )

  echo -e "${GREEN}[Web] Started (PID $(cat "$WEB_PID_FILE")) → $WEB_LOG${NC}"
}

echo "Starting PermaTrack services from $ROOT"
echo ""

start_api || true
start_web || true

echo ""
echo "Waiting 3s for services to bind ports..."
sleep 3

echo ""
echo "=== Status ==="

if is_running "$API_PID_FILE"; then
  echo -e "${GREEN}[API] Running${NC}  (PID $(cat "$API_PID_FILE"))"
else
  echo -e "${RED}[API] Not running${NC}  (see $API_LOG)"
fi

if is_running "$WEB_PID_FILE"; then
  echo -e "${GREEN}[Web] Running${NC}  (PID $(cat "$WEB_PID_FILE"))"
else
  echo -e "${RED}[Web] Not running${NC}  (see $WEB_LOG)"
fi

echo ""
echo "  API → http://localhost:3001"
echo "  Web → http://localhost:3000"
echo ""
echo "To stop: ./stop.sh"

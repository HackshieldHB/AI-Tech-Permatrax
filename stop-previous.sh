#!/usr/bin/env bash
# PermaTrack production — stop API + Web from project root (Linux/macOS)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

API_PID_FILE="$ROOT/.pids/api.pid"
WEB_PID_FILE="$ROOT/.pids/web.pid"

stop_service() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "$pid_file" ]]; then
    echo -e "${YELLOW}[$name] Not running (no PID file)${NC}"
    return 0
  fi

  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"

  if [[ -z "$pid" ]]; then
    rm -f "$pid_file"
    echo -e "${YELLOW}[$name] Not running (empty PID file removed)${NC}"
    return 0
  fi

  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$pid_file"
    echo -e "${YELLOW}[$name] Not running (stale PID $pid removed)${NC}"
    return 0
  fi

  echo "[$name] Stopping PID $pid..."
  kill -TERM "$pid" 2>/dev/null || true

  local waited=0
  while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 5 ]]; do
    sleep 1
    waited=$((waited + 1))
  done

  if kill -0 "$pid" 2>/dev/null; then
    echo -e "${RED}[$name] Still running after 5s — force kill (SIGKILL)${NC}"
    kill -9 "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      echo -e "${RED}[$name] Failed to stop PID $pid${NC}"
      return 1
    fi
    rm -f "$pid_file"
    echo -e "${YELLOW}[$name] Force killed${NC}"
    return 0
  fi

  rm -f "$pid_file"
  echo -e "${GREEN}[$name] Stopped${NC}"
  return 0
}

echo "Stopping PermaTrack services..."
echo ""

stop_service "API" "$API_PID_FILE" || true
stop_service "Web" "$WEB_PID_FILE" || true

echo ""
echo "Done."

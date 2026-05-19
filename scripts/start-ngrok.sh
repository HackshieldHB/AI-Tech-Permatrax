#!/usr/bin/env bash
# scripts/start-ngrok.sh
# ---------------------------------------------------------------------------
# IMPORTANT: Canonical flow is scripts/start-ngrok.ps1 (single tunnel model).
# This script is a minimal Unix helper aligned with that model:
#   - ONLY: ngrok http 3000  (no tunnel to 3001)
#   - API is reached via Next.js /api/* rewrites to localhost:3001
# ---------------------------------------------------------------------------
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT" || exit 1

echo ""
echo "================================================"
echo "  PermaTrax - Ngrok (frontend only, port 3000)"
echo "================================================"

echo -n "[1/4] Checking backend (Nest on :3001)... "
if curl -sf "http://localhost:3001/api/health" > /dev/null; then
  echo "OK"
else
  echo "NOT RUNNING"
  echo "  Start backend first (e.g. pnpm --filter @permatrack/api start:dev)"
  exit 1
fi

echo -n "[2/4] Stopping existing ngrok... "
if pkill -f "[n]grok" 2>/dev/null; then echo "stopped"; else echo "(not running)"; fi
sleep 1

echo "[3/4] Starting ngrok http 3000 (region ap)..."
ngrok http 3000 --region ap --log=stdout >"${PROJECT_ROOT}/ngrok-stderr.log" 2>&1 &
sleep 4

echo "[4/4] Resolving public URL + syncing env..."
TUNNELS_JSON=$(curl -sf "http://127.0.0.1:4040/api/tunnels" || true)
FRONTEND_PUBLIC="$(printf '%s' "$TUNNELS_JSON" | python3 -c "
import json, sys
raw = sys.stdin.read()
if not raw.strip():
    sys.exit(1)
data = json.loads(raw)
for t in data.get('tunnels', []):
    addr = str(t.get('config', {}).get('addr', ''))
    if addr.endswith(':3000') or addr.endswith('3000') or ':3000' in addr:
        print(str(t.get('public_url', '')).rstrip('/'))
        break
" 2>/dev/null || true)"

if [ -z "${FRONTEND_PUBLIC:-}" ]; then
  echo "ERROR: Could not read ngrok public URL for port 3000 (is ngrok running? http://127.0.0.1:4040)"
  exit 1
fi

{
  echo "NEXT_PUBLIC_API_URL="
  echo "NEXT_PUBLIC_FILES_URL="
} >apps/web/.env.local

FILE_BASE_URL="${FRONTEND_PUBLIC}/api/files"
FRONTEND_URLS="http://localhost:3000,${FRONTEND_PUBLIC}"

if [ -f "apps/api/.env" ]; then
  if grep -q '^FRONTEND_URL=' apps/api/.env; then
    sed -i.bak "s#^FRONTEND_URL=.*#FRONTEND_URL=${FRONTEND_URLS}#" apps/api/.env && rm -f apps/api/.env.bak
  else
    printf '\nFRONTEND_URL=%s\n' "$FRONTEND_URLS" >>apps/api/.env
  fi
  if grep -q '^FILE_BASE_URL=' apps/api/.env; then
    sed -i.bak "s#^FILE_BASE_URL=.*#FILE_BASE_URL=${FILE_BASE_URL}#" apps/api/.env && rm -f apps/api/.env.bak
  else
    printf '\nFILE_BASE_URL=%s\n' "$FILE_BASE_URL" >>apps/api/.env
  fi
fi

echo ""
echo "================================================"
echo "  Tunnel active"
echo "================================================"
echo "  Public app : ${FRONTEND_PUBLIC}"
echo "  Health     : ${FRONTEND_PUBLIC}/api/health   (via Next.js)"
echo "  Inspector  : http://127.0.0.1:4040"
echo ""
echo "  Restart \"next dev\" once so it picks up apps/web/.env.local changes."
echo ""

#!/bin/bash
# Fix aitech-website — rebuild + restart clean

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()      { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

WEBSITE_DIR="/var/www/aitech-website/website"
PERMATRAX_DIR="/var/www/permatrax-dev"

# ─── Step 1: Pull latest code ─────────────────────────────────────────────────
log_info "Pulling latest website code..."
cd /var/www/aitech-website
git pull origin main
log_ok "Code updated"

# ─── Step 2: Install dependencies ────────────────────────────────────────────
log_info "Installing dependencies..."
cd "$WEBSITE_DIR"
npm install --legacy-peer-deps
log_ok "Dependencies installed"

# ─── Step 3: Clean old build ──────────────────────────────────────────────────
log_info "Cleaning old build..."
rm -rf "$WEBSITE_DIR/.next"
log_ok "Old build removed"

# ─── Step 4: Rebuild ──────────────────────────────────────────────────────────
log_info "Building website..."
cd "$WEBSITE_DIR"
NODE_OPTIONS="--max-old-space-size=2048" npm run build

[[ -d "$WEBSITE_DIR/.next" ]] || die "Build failed — .next not found"
log_ok "Website built"

# ─── Step 5: Restart PM2 clean ───────────────────────────────────────────────
log_info "Restarting aitech-website..."
pm2 delete aitech-website 2>/dev/null || true

cd "$PERMATRAX_DIR"
pm2 start ecosystem.dev.config.js --only aitech-website
log_ok "PM2 started"

# ─── Step 6: Health check ─────────────────────────────────────────────────────
log_info "Waiting for website to be ready..."
for i in $(seq 1 15); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 2>/dev/null || echo "0")
    if [[ "$STATUS" == "200" || "$STATUS" == "304" ]]; then
        log_ok "Website responding HTTP $STATUS ✅"
        break
    fi
    echo -n "."
    sleep 2
    [[ $i -eq 15 ]] && { log_warn "Timeout — check: pm2 logs aitech-website"; }
done

# ─── Step 7: Check static assets ─────────────────────────────────────────────
log_info "Checking static assets..."
STATIC_CHECK=$(curl -s -o /dev/null -w "%{http_code}" \
    "http://localhost:3000/_next/static/$(ls $WEBSITE_DIR/.next/static/ | head -1)/" 2>/dev/null || echo "0")

if [[ "$STATIC_CHECK" != "0" ]]; then
    log_ok "Static assets accessible"
else
    log_warn "Static assets might have issues"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
pm2 status
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Test:  curl -I https://aitech-ilt.co.id    ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

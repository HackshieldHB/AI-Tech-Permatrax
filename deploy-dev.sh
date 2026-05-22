#!/bin/bash
# =============================================================================
# AI Tech DEV VPS — Deploy & Fix Script
#
# Bisa dijalankan kapanpun:
#   - First time setup (setelah setup-dev-vps.sh)
#   - Fix kalau ada error
#   - Re-deploy setelah git pull
#
# Usage: sudo ./deploy-dev.sh
# =============================================================================

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
log_ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
log_step()    { echo -e "\n${CYAN}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
die()         { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ─── Credentials (simple untuk dev) ──────────────────────────────────────────
DOMAIN="aitech-ilt.co.id"
PERMATRAX_DIR="/var/www/permatrax-dev"
WEBSITE_DIR="/var/www/aitech-website"

DB_NAME="permatrax_dev"
DB_USER="permatrax"
DB_PASS="permatrax123"
REDIS_PASS="redis123"
JWT_SECRET="permatrax_jwt_dev_secret_aitech_2025_very_long_string"
JWT_REFRESH_SECRET="permatrax_jwt_refresh_dev_secret_aitech_2025_very_long_string"

WEBSITE_PORT=3000
WEB_PORT=3002
API_PORT=3003

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5"
REDIS_URL="redis://:${REDIS_PASS}@127.0.0.1:6379"

# ─── Check root ───────────────────────────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo ./deploy-dev.sh"

# ─── Step 1: Create .env files ────────────────────────────────────────────────
log_step "STEP 1: Create .env Files"

# Root .env
cat > "$PERMATRAX_DIR/.env" << EOF
# PermaTrax DEV VPS — $(date '+%Y-%m-%d')
NODE_ENV=production
PORT=${API_PORT}

# Database
POSTGRES_USER=${DB_USER}
POSTGRES_PASSWORD=${DB_PASS}
POSTGRES_DB=${DB_NAME}
DATABASE_URL=${DATABASE_URL}

# Redis
REDIS_PASSWORD=${REDIS_PASS}
REDIS_URL=${REDIS_URL}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_EXPIRES_IN=8h
REFRESH_TOKEN_EXPIRES_IN=7d

# URLs
FRONTEND_URL=https://${DOMAIN}/Permatrax
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://www.${DOMAIN}

# Files
UPLOAD_DIR=${PERMATRAX_DIR}/uploads
FILE_BASE_URL=https://${DOMAIN}/Permatrax/api/files
MAX_FILE_SIZE=52428800

# Next.js
BASE_PATH=/Permatrax
NEXT_PUBLIC_API_URL=https://${DOMAIN}/Permatrax/api
NEXT_PUBLIC_FILES_URL=https://${DOMAIN}/Permatrax/api/files
NEXT_PUBLIC_APP_NAME=PermaTrax
NEXT_PUBLIC_APP_VERSION=1.0.0-dev
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=

PROCUREMENT_FROM_EMAIL=procurement@aitech-ilt.co.id
CERTBOT_EMAIL=admin@aitech-ilt.co.id
EOF

# Copy ke tempat yang dibutuhkan
cp "$PERMATRAX_DIR/.env" "$PERMATRAX_DIR/apps/api/.env"
cp "$PERMATRAX_DIR/.env" "$PERMATRAX_DIR/packages/db/.env"

# Web .env.local
cat > "$PERMATRAX_DIR/apps/web/.env.local" << EOF
NODE_ENV=production
PORT=${WEB_PORT}
BASE_PATH=/Permatrax
API_URL=http://127.0.0.1:${API_PORT}
NEXT_PUBLIC_API_URL=https://${DOMAIN}/Permatrax/api
NEXT_PUBLIC_FILES_URL=https://${DOMAIN}/Permatrax/api/files
NEXT_PUBLIC_APP_NAME=PermaTrax
NEXT_PUBLIC_APP_VERSION=1.0.0-dev
NEXT_PUBLIC_MAPBOX_TOKEN=
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_DSN=
EOF

log_ok ".env files created"

# ─── Step 2: Reset Docker (PostgreSQL + Redis) ────────────────────────────────
log_step "STEP 2: Reset Docker Containers"

# Update docker-compose.dev.yml dengan credentials baru
cat > "$PERMATRAX_DIR/docker-compose.dev.yml" << EOF
version: '3.8'
services:
  postgres-dev:
    image: postgis/postgis:15-3.3
    container_name: permatrax-dev-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASS}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - permatrax_dev_postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - permatrax-dev-net

  redis-dev:
    image: redis:7-alpine
    container_name: permatrax-dev-redis
    restart: unless-stopped
    command: redis-server --requirepass ${REDIS_PASS} --appendonly yes
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - permatrax_dev_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASS}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - permatrax-dev-net

volumes:
  permatrax_dev_postgres:
  permatrax_dev_redis:

networks:
  permatrax-dev-net:
    driver: bridge
EOF

# Stop PM2 dulu
pm2 delete all 2>/dev/null || true

# Reset Docker containers + volumes
cd "$PERMATRAX_DIR"
docker compose -f docker-compose.dev.yml down -v 2>/dev/null || true
docker compose -f docker-compose.dev.yml up -d

# Tunggu PostgreSQL ready
log_info "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
    if docker exec permatrax-dev-postgres pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
        log_ok "PostgreSQL ready"; break
    fi
    echo -n "."
    sleep 2
    [[ $i -eq 30 ]] && die "PostgreSQL timeout — cek: docker logs permatrax-dev-postgres"
done

# Tunggu Redis ready
log_info "Waiting for Redis..."
for i in $(seq 1 15); do
    if docker exec permatrax-dev-redis redis-cli -a "$REDIS_PASS" ping 2>/dev/null | grep -q "PONG"; then
        log_ok "Redis ready"; break
    fi
    sleep 2
    [[ $i -eq 15 ]] && die "Redis timeout — cek: docker logs permatrax-dev-redis"
done

# ─── Step 3: Install Dependencies ─────────────────────────────────────────────
log_step "STEP 3: Install Dependencies"

export PNPM_HOME="/root/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

# Permatrax monorepo
cd "$PERMATRAX_DIR"
pnpm install --frozen-lockfile
log_ok "Permatrax dependencies installed"

# Website
if [[ -d "$WEBSITE_DIR/website" ]]; then
    cd "$WEBSITE_DIR/website"
    npm install --legacy-peer-deps
    log_ok "Website dependencies installed"
fi

# ─── Step 4: Prisma Generate + Migrate ────────────────────────────────────────
log_step "STEP 4: Database Migration"

cd "$PERMATRAX_DIR/packages/db"
DATABASE_URL="$DATABASE_URL" npx prisma generate
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

log_ok "Database migrated"

# ─── Step 5: Build API ────────────────────────────────────────────────────────
log_step "STEP 5: Build API (NestJS)"

cd "$PERMATRAX_DIR/apps/api"
pnpm build

[[ -f "$PERMATRAX_DIR/apps/api/dist/apps/api/src/main.js" ]] \
    || die "API build failed — dist/apps/api/src/main.js not found"

log_ok "API built"

# ─── Step 6: Build Permatrax Web ──────────────────────────────────────────────
log_step "STEP 6: Build Permatrax Web (Next.js)"

cd "$PERMATRAX_DIR/apps/web"

BASE_PATH=/Permatrax \
API_URL=http://127.0.0.1:${API_PORT} \
NEXT_PUBLIC_API_URL=https://${DOMAIN}/Permatrax/api \
NEXT_PUBLIC_FILES_URL=https://${DOMAIN}/Permatrax/api/files \
NEXT_PUBLIC_APP_NAME=PermaTrax \
NODE_OPTIONS="--max-old-space-size=4096" \
pnpm build

[[ -d "$PERMATRAX_DIR/apps/web/.next" ]] \
    || die "Web build failed — .next not found"

log_ok "Permatrax Web built"

# ─── Step 7: Build Website ────────────────────────────────────────────────────
log_step "STEP 7: Build AI Tech Website (Next.js)"

if [[ -d "$WEBSITE_DIR/website" ]]; then
    cd "$WEBSITE_DIR/website"
    NODE_OPTIONS="--max-old-space-size=2048" npm run build
    log_ok "Website built"
else
    log_warn "Website directory not found — skipping"
fi

# ─── Step 8: Start PM2 ────────────────────────────────────────────────────────
log_step "STEP 8: Start PM2"

cd "$PERMATRAX_DIR"
pm2 start ecosystem.dev.config.js
pm2 save

log_ok "PM2 started"

# ─── Step 9: Reload Nginx ─────────────────────────────────────────────────────
log_step "STEP 9: Reload Nginx"

nginx -t && systemctl reload nginx
log_ok "Nginx reloaded"

# ─── Step 10: Health Check ────────────────────────────────────────────────────
log_step "STEP 10: Health Check"

sleep 5

check_port() {
    local port=$1 name=$2
    nc -z 127.0.0.1 "$port" 2>/dev/null \
        && log_ok "$name → port $port ✅" \
        || log_warn "$name → port $port ❌ (cek: pm2 logs)"
}

check_port $WEBSITE_PORT "AI Tech Website"
check_port $WEB_PORT     "Permatrax Web"
check_port $API_PORT     "Permatrax API"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          ✅  Deploy Complete!                            ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Website   →  https://${DOMAIN}              ║${NC}"
echo -e "${GREEN}║  Permatrax →  https://${DOMAIN}/Permatrax    ║${NC}"
echo -e "${GREEN}║  API       →  https://${DOMAIN}/Permatrax/api║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  DB   : ${DB_USER} / ${DB_PASS}                  ║${NC}"
echo -e "${GREEN}║  Redis: ${REDIS_PASS}                                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  pm2 status           — cek semua proses"
echo "  pm2 logs             — lihat logs"
echo "  pm2 restart all      — restart semua"
echo "  ./deploy-dev.sh      — re-deploy (setelah git pull)"
echo ""

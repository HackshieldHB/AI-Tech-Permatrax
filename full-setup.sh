#!/bin/bash
# PermaTrax — full production setup (AlmaLinux)
# Hybrid: Docker (Postgres + Redis) + PM2 (API + Web) + Nginx + SSL
# Deploy: git clone …/AI-Tech-Permatrax.git /var/www/Permatrax && cd /var/www/Permatrax && ./full-setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR"
cd "$ROOT_DIR"

# shellcheck source=scripts/production-common.sh
source "$ROOT_DIR/scripts/production-common.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

API_MAIN="$ROOT_DIR/apps/api/dist/apps/api/src/main.js"
API_PORT="${PORT:-3001}"
WEB_PORT=3000
DOMAIN="permatrax.tech"
CERT_PATH="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@permatrax.tech}"

log_info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_err()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

die() { log_err "$1"; exit 1; }

run_sudo() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# STEP 0 — System check
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 0: System check (AlmaLinux)"

if ! command -v node &>/dev/null; then
  die "Node.js is not installed. Install Node.js 20 LTS and retry."
fi

NODE_MAJOR="$(node -p "parseInt(process.versions.node.split('.')[0], 10)")"
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  die "Node.js must be >= 18 (found: $(node --version))"
fi
log_ok "Node $(node --version)"

if ! command -v pnpm &>/dev/null; then
  log_warn "pnpm not found — installing globally..."
  npm install -g pnpm
fi
log_ok "pnpm $(pnpm --version)"

if [[ ! -f "$ROOT_DIR/.env" ]]; then
  die ".env file missing at project root. Copy .env.example and fill in values."
fi

production_load_env "$ROOT_DIR"
API_PORT="${PORT:-3001}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@permatrax.tech}"
log_ok "Loaded $ROOT_DIR/.env"

if ! command -v fuser &>/dev/null; then
  log_warn "fuser not found — install: sudo dnf install -y psmisc"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1.5 — Docker
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 1.5: Install Docker (if needed)"
if ! command -v docker &>/dev/null; then
  log_info "Installing Docker..."
  run_sudo dnf install -y yum-utils
  run_sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  run_sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  run_sudo systemctl enable docker
  run_sudo systemctl start docker
  run_sudo usermod -aG docker "$USER"
  log_warn "Added $USER to docker group. Re-login may be required for non-sudo docker."
fi
log_ok "Docker $(docker --version 2>/dev/null || sudo docker --version)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1.6 — Validate .env
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 1.6: Validate required .env variables"
if ! production_validate_env "$ROOT_DIR"; then
  die "Fix missing variables in .env (see errors above)"
fi
log_ok "Required .env variables present"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1.7 — Docker Compose (Postgres + Redis)
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 1.7: Start PostgreSQL and Redis (Docker Compose)"
production_start_data_services "$ROOT_DIR" true

log_info "Waiting for PostgreSQL to be healthy..."
production_wait_container_healthy permatrax-postgres PostgreSQL 60 || \
  die "PostgreSQL health check failed"
log_ok "PostgreSQL healthy"

log_info "Waiting for Redis to be healthy..."
production_wait_container_healthy permatrax-redis Redis 60 || \
  die "Redis health check failed"
log_ok "Redis healthy"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — PM2
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 1: Install PM2 (global)"
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi
log_ok "PM2 $(pm2 --version)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Nginx
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 2: Install Nginx"
if ! command -v nginx &>/dev/null; then
  run_sudo dnf install -y nginx
  run_sudo systemctl enable nginx
fi
log_ok "Nginx installed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Certbot
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 3: Install Certbot"
if ! command -v certbot &>/dev/null; then
  run_sudo dnf install -y epel-release
  run_sudo dnf install -y certbot python3-certbot-nginx
fi
log_ok "Certbot ready"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Directories
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 4: Create logs/, nginx/, and local upload storage"
mkdir -p "$ROOT_DIR/logs" "$ROOT_DIR/nginx"
mkdir -p "$ROOT_DIR/apps/api/dist"
mkdir -p "$ROOT_DIR/apps/api/uploads"
touch "$ROOT_DIR/apps/api/uploads/.gitkeep" 2>/dev/null || true
run_sudo mkdir -p /var/www/certbot
log_ok "Directories ready (including apps/api/uploads for local file storage)"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — pnpm install
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 5: pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile
log_ok "Dependencies installed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — Build API + Web
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 6: Build API (nest build)"
(
  cd "$ROOT_DIR/apps/api"
  pnpm build
)
[[ -f "$API_MAIN" ]] || die "API build failed: $API_MAIN not found"
log_ok "API built"

log_info "Step 6: Build Web (next build)"
(
  cd "$ROOT_DIR/apps/web"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-https://api.permatrax.tech/api}"
  export NEXT_PUBLIC_MAPBOX_TOKEN="${NEXT_PUBLIC_MAPBOX_TOKEN:-}"
  pnpm build
)
[[ -d "$ROOT_DIR/apps/web/.next" ]] || die "Web build failed: apps/web/.next not found"
log_ok "Web built"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Database
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 7: Database (migrate deploy, generate, seed)"
(
  cd "$ROOT_DIR/packages/db"
  production_load_env "$ROOT_DIR"
  npx prisma migrate deploy
  npx prisma generate
  npx prisma db seed
)
log_ok "Database migrated and seeded"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8 — Nginx config
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 8: Setup Nginx config"

if [[ ! -f "$CERT_PATH" ]]; then
  log_warn "SSL cert not found — using HTTP bootstrap config for Certbot"
  run_sudo cp "$ROOT_DIR/nginx/permatrax-http.bootstrap.conf" /etc/nginx/conf.d/permatrax.conf
else
  run_sudo cp "$ROOT_DIR/nginx/permatrax.conf" /etc/nginx/conf.d/permatrax.conf
fi

if ! run_sudo nginx -t; then
  die "nginx -t failed — fix nginx/permatrax.conf and retry"
fi
log_ok "Nginx config test passed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9 — SSL (Let's Encrypt)
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 9: SSL certificate"

if [[ ! -f "$CERT_PATH" ]]; then
  log_info "Requesting certificate for ${DOMAIN}..."
  run_sudo systemctl restart nginx || run_sudo systemctl start nginx

  run_sudo certbot --nginx \
    -d permatrax.tech \
    -d www.permatrax.tech \
    -d api.permatrax.tech \
    --non-interactive \
    --agree-tos \
    --email "$CERTBOT_EMAIL" \
    --redirect || die "Certbot failed — check DNS points to this server and port 80 is open"

  if ! crontab -l 2>/dev/null | grep -q 'certbot renew'; then
    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
  fi
  log_ok "SSL certificate installed + auto-renewal cron configured"
else
  log_ok "SSL certificate already exists — skipping certbot"
fi

run_sudo cp "$ROOT_DIR/nginx/permatrax.conf" /etc/nginx/conf.d/permatrax.conf
run_sudo nginx -t || die "nginx -t failed after installing permatrax.conf"
log_ok "Production Nginx config installed"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 10 — Nginx start/reload
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 10: Start/reload Nginx"
run_sudo systemctl restart nginx
run_sudo systemctl enable nginx
run_sudo systemctl status nginx --no-pager || true
log_ok "Nginx running"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 11 — Clear ports
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 11: Clear ports ${WEB_PORT} and ${API_PORT}"
fuser -k "${WEB_PORT}/tcp" 2>/dev/null || true
fuser -k "${API_PORT}/tcp" 2>/dev/null || true
sleep 1
log_ok "Ports cleared"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 12 — PM2
# ─────────────────────────────────────────────────────────────────────────────
log_info "Step 12: Start applications with PM2"

pm2 delete permatrax-api 2>/dev/null || true
pm2 delete permatrax-web 2>/dev/null || true

cd "$ROOT_DIR"
production_load_env "$ROOT_DIR"
pm2 start ecosystem.config.js --env production
pm2 save

STARTUP_LINE="$(pm2 startup systemd -u "$USER" --hp "$HOME" 2>&1 | grep -E '^sudo env' || true)"
if [[ -n "$STARTUP_LINE" ]]; then
  log_warn "Enable PM2 on boot — run this command once:"
  echo -e "${YELLOW}  $STARTUP_LINE${NC}"
fi

log_ok "PM2 apps started"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   ✅  PermaTrax Production Ready!        ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║   Web   → https://permatrax.tech         ║${NC}"
echo -e "${GREEN}║   API   → https://api.permatrax.tech     ║${NC}"
echo -e "${GREEN}║   PM2   → pm2 status                     ║${NC}"
echo -e "${GREEN}║   Logs  → pm2 logs                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Docker (Postgres + Redis):${NC}"
production_docker_compose "$ROOT_DIR" ps || sudo docker compose -f "$ROOT_DIR/docker-compose.prod.yml" ps
echo ""
pm2 status || true
echo ""

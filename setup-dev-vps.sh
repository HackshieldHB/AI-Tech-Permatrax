#!/bin/bash
# =============================================================================
# AI Tech DEV VPS — Full Auto Setup (Ubuntu)
#
# Sets up ONE VPS to serve:
#   aitech-ilt.co.id/           → AI Tech Website        (port 3000)
#   aitech-ilt.co.id/Permatrax  → Permatrax DEV web      (port 3002)
#   aitech-ilt.co.id/Permatrax/api → Permatrax DEV API   (port 3003)
#
# Usage:
#   chmod +x setup-dev-vps.sh
#   sudo ./setup-dev-vps.sh
# =============================================================================

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC}    $*"; }
log_success() { echo -e "${GREEN}[OK]${NC}      $*"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC}    $*"; }
log_error()   { echo -e "${RED}[ERROR]${NC}   $*" >&2; }
log_step()    { echo -e "\n${CYAN}━━━ $* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }
die()         { log_error "$1"; exit 1; }

# ─── Configuration ─────────────────────────────────────────────────────────
DOMAIN="aitech-ilt.co.id"
WWW_DOMAIN="www.aitech-ilt.co.id"
ADMIN_EMAIL="admin@aitech-ilt.co.id"

PERMATRAX_REPO="https://github.com/HackshieldHB/AI-Tech-Permatrax.git"
PERMATRAX_BRANCH="dev"
PERMATRAX_DIR="/var/www/permatrax-dev"

WEBSITE_REPO="https://github.com/HackshieldHB/AI-Tech-Website.git"
WEBSITE_DIR="/var/www/aitech-website"

# Ports
WEBSITE_PORT=3000
PERMATRAX_WEB_PORT=3002
PERMATRAX_API_PORT=3003

# Database
DB_NAME="permatrax_dev"
DB_USER="permatrax_dev_user"
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
REDIS_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)"
JWT_SECRET="$(openssl rand -base64 64)"
JWT_REFRESH_SECRET="$(openssl rand -base64 64)"

# ─── Step 0: Pre-flight checks ─────────────────────────────────────────────
log_step "STEP 0: Pre-flight Checks"

# Must run as root
[[ "$(id -u)" -eq 0 ]] || die "Run as root: sudo ./setup-dev-vps.sh"

# Must be Ubuntu
if ! grep -qi "ubuntu" /etc/os-release 2>/dev/null; then
  die "This script is Ubuntu only. Detected: $(grep PRETTY_NAME /etc/os-release | cut -d= -f2)"
fi

UBUNTU_VERSION=$(grep VERSION_ID /etc/os-release | cut -d'"' -f2)
log_success "Ubuntu $UBUNTU_VERSION detected"

# Check internet connectivity
if ! curl -sf --max-time 5 https://google.com > /dev/null; then
  die "No internet connection. Check network settings."
fi
log_success "Internet connection OK"

# Warn if WEBSITE_REPO is not set
if [[ -z "$WEBSITE_REPO" ]]; then
  log_warn "WEBSITE_REPO is not set — website will be copied from local path if available."
  log_warn "Set WEBSITE_REPO at the top of this script once you push the website to GitHub."
fi

# ─── Step 1: System packages ───────────────────────────────────────────────
log_step "STEP 1: System Packages"

export DEBIAN_FRONTEND=noninteractive

apt-get update -y
apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"

apt-get install -y \
  curl \
  git \
  build-essential \
  nginx \
  ufw \
  certbot \
  python3-certbot-nginx \
  software-properties-common \
  apt-transport-https \
  ca-certificates \
  gnupg \
  lsb-release \
  htop \
  vim \
  unzip \
  netcat-openbsd \
  openssl

log_success "System packages installed"

# ─── Step 2: Node.js 20 ────────────────────────────────────────────────────
log_step "STEP 2: Node.js 20"

CURRENT_NODE_MAJOR=0
if command -v node &>/dev/null; then
  CURRENT_NODE_MAJOR=$(node -e "process.stdout.write(process.versions.node.split('.')[0])")
fi

if [[ "$CURRENT_NODE_MAJOR" -lt 20 ]]; then
  log_info "Installing Node.js 20 via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
else
  log_info "Node.js $CURRENT_NODE_MAJOR already installed, skipping"
fi

log_success "Node.js $(node -v)"

# ─── Step 3: pnpm ──────────────────────────────────────────────────────────
log_step "STEP 3: pnpm"

if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm@9
fi

# Ensure pnpm is in PATH
export PNPM_HOME="/root/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

log_success "pnpm $(pnpm -v)"

# ─── Step 4: PM2 ───────────────────────────────────────────────────────────
log_step "STEP 4: PM2"

if ! command -v pm2 &>/dev/null; then
  npm install -g pm2
fi

log_success "PM2 $(pm2 -v)"

# ─── Step 5: Docker ────────────────────────────────────────────────────────
log_step "STEP 5: Docker (for PostgreSQL + Redis)"

if ! command -v docker &>/dev/null; then
  log_info "Installing Docker..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg

  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable docker
  systemctl start docker
fi

log_success "Docker $(docker --version)"

# ─── Step 6: Firewall (UFW) ────────────────────────────────────────────────
log_step "STEP 6: Firewall (UFW)"

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'

# Block internal ports from external access
ufw deny 3000/tcp   # website (internal)
ufw deny 3002/tcp   # permatrax web (internal)
ufw deny 3003/tcp   # permatrax api (internal)
ufw deny 5432/tcp   # postgres (internal)
ufw deny 6379/tcp   # redis (internal)

echo "y" | ufw enable
ufw reload

log_success "UFW configured — ports 22, 80, 443 open. Internal ports blocked."

# ─── Step 7: Directory structure ───────────────────────────────────────────
log_step "STEP 7: Directory Structure"

mkdir -p "$PERMATRAX_DIR"/{uploads,logs}
mkdir -p "$WEBSITE_DIR"
mkdir -p /var/log/pm2
mkdir -p /var/www/certbot

log_success "Directories created"

# ─── Step 8: Clone / Update Repositories ──────────────────────────────────
log_step "STEP 8: Clone Repositories"

# Permatrax DEV (branch: dev)
if [[ -d "$PERMATRAX_DIR/.git" ]]; then
  log_info "Permatrax repo exists — pulling latest from branch '$PERMATRAX_BRANCH'..."
  cd "$PERMATRAX_DIR"
  git fetch origin
  git checkout "$PERMATRAX_BRANCH"
  git reset --hard "origin/$PERMATRAX_BRANCH"
else
  log_info "Cloning Permatrax (branch: $PERMATRAX_BRANCH)..."
  git clone --branch "$PERMATRAX_BRANCH" "$PERMATRAX_REPO" "$PERMATRAX_DIR"
fi
log_success "Permatrax DEV ready at $PERMATRAX_DIR"

# AI Tech Website
if [[ -n "$WEBSITE_REPO" ]]; then
  if [[ -d "$WEBSITE_DIR/.git" ]]; then
    log_info "Website repo exists — pulling latest..."
    cd "$WEBSITE_DIR"
    git pull origin main || git pull origin master
  else
    log_info "Cloning AI Tech Website..."
    git clone "$WEBSITE_REPO" "$WEBSITE_DIR"
  fi
  log_success "AI Tech Website ready at $WEBSITE_DIR"
else
  log_warn "WEBSITE_REPO not set — skipping website clone."
  log_warn "Deploy website manually to: $WEBSITE_DIR/website"
fi

# ─── Step 9: Docker Compose — PostgreSQL + Redis (DEV) ────────────────────
log_step "STEP 9: PostgreSQL + Redis (Docker)"

COMPOSE_FILE="$PERMATRAX_DIR/docker-compose.dev.yml"

cat > "$COMPOSE_FILE" << EOF
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
      - permatrax-dev-network

  redis-dev:
    image: redis:7-alpine
    container_name: permatrax-dev-redis
    restart: unless-stopped
    command: >
      sh -c '
        echo "requirepass ${REDIS_PASS}" > /tmp/redis.conf &&
        echo "appendonly yes" >> /tmp/redis.conf &&
        echo "bind 127.0.0.1" >> /tmp/redis.conf &&
        redis-server /tmp/redis.conf
      '
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
      - permatrax-dev-network

volumes:
  permatrax_dev_postgres:
  permatrax_dev_redis:

networks:
  permatrax-dev-network:
    driver: bridge
EOF

log_info "Starting PostgreSQL and Redis containers..."
cd "$PERMATRAX_DIR"
docker compose -f docker-compose.dev.yml up -d

# Wait for PostgreSQL
log_info "Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T postgres-dev \
      pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
    log_success "PostgreSQL is ready"
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && die "PostgreSQL failed to start within 60s"
done

# Wait for Redis
log_info "Waiting for Redis..."
for i in $(seq 1 30); do
  if docker compose -f docker-compose.dev.yml exec -T redis-dev \
      redis-cli -a "$REDIS_PASS" ping 2>/dev/null | grep -q "PONG"; then
    log_success "Redis is ready"
    break
  fi
  sleep 2
  [[ $i -eq 30 ]] && die "Redis failed to start within 60s"
done

# ─── Step 10: Environment Files ────────────────────────────────────────────
log_step "STEP 10: Environment Files"

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public"
REDIS_URL="redis://:${REDIS_PASS}@127.0.0.1:6379"

# Backup helper
backup_env() {
  [[ -f "$1" ]] && cp "$1" "${1}.backup.$(date +%Y%m%d_%H%M%S)"
}

# Root .env (Permatrax)
backup_env "$PERMATRAX_DIR/.env"
cat > "$PERMATRAX_DIR/.env" << EOF
# PermaTrax DEV VPS — Generated $(date)
NODE_ENV=production

# Database
DATABASE_URL=${DATABASE_URL}

# Redis
REDIS_URL=${REDIS_URL}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# URLs
FRONTEND_URL=https://${DOMAIN}/Permatrax
API_URL=https://${DOMAIN}/Permatrax/api
CORS_ALLOWED_ORIGINS=https://${DOMAIN}

# File storage
UPLOAD_DIR=${PERMATRAX_DIR}/uploads
FILE_BASE_URL=https://${DOMAIN}/Permatrax/api/files
MAX_FILE_SIZE=52428800

# Ports
PORT=${PERMATRAX_API_PORT}

# Email — fill these in
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=noreply@${DOMAIN}
EOF

# API .env
backup_env "$PERMATRAX_DIR/apps/api/.env"
cp "$PERMATRAX_DIR/.env" "$PERMATRAX_DIR/apps/api/.env"

# Web .env.local
backup_env "$PERMATRAX_DIR/apps/web/.env.local"
cat > "$PERMATRAX_DIR/apps/web/.env.local" << EOF
# Permatrax DEV Web — Generated $(date)
NODE_ENV=production
BASE_PATH=/Permatrax
PORT=${PERMATRAX_WEB_PORT}
API_URL=http://localhost:${PERMATRAX_API_PORT}

# Public env vars (exposed to browser)
NEXT_PUBLIC_API_URL=https://${DOMAIN}/Permatrax/api
NEXT_PUBLIC_FILES_URL=https://${DOMAIN}/Permatrax/api/files
EOF

log_success "Environment files created"

# ─── Step 11: Install Dependencies ────────────────────────────────────────
log_step "STEP 11: Install Dependencies"

cd "$PERMATRAX_DIR"
export PNPM_HOME="/root/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"

pnpm install --frozen-lockfile
log_success "Permatrax dependencies installed"

if [[ -d "$WEBSITE_DIR/website" ]]; then
  cd "$WEBSITE_DIR/website"
  npm install --legacy-peer-deps
  log_success "Website dependencies installed"
fi

# ─── Step 12: Database Migration ──────────────────────────────────────────
log_step "STEP 12: Database Migration"

cd "$PERMATRAX_DIR/packages/db"
DATABASE_URL="$DATABASE_URL" npx prisma generate
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

log_success "Prisma migrations applied"

# ─── Step 13: Build Applications ──────────────────────────────────────────
log_step "STEP 13: Build Applications"

# Build Permatrax API (NestJS)
log_info "Building Permatrax API..."
cd "$PERMATRAX_DIR/apps/api"
pnpm build
[[ -f "$PERMATRAX_DIR/apps/api/dist/apps/api/src/main.js" ]] \
  || die "API build failed — dist/apps/api/src/main.js not found"
log_success "Permatrax API built"

# Build Permatrax Web (Next.js)
log_info "Building Permatrax Web (basePath=/Permatrax)..."
cd "$PERMATRAX_DIR/apps/web"
BASE_PATH=/Permatrax \
API_URL=http://localhost:${PERMATRAX_API_PORT} \
NEXT_PUBLIC_API_URL=https://${DOMAIN}/Permatrax/api \
NODE_OPTIONS="--max-old-space-size=4096" \
  pnpm build
[[ -d "$PERMATRAX_DIR/apps/web/.next" ]] \
  || die "Web build failed — .next directory not found"
log_success "Permatrax Web built"

# Build AI Tech Website
if [[ -d "$WEBSITE_DIR/website" ]]; then
  log_info "Building AI Tech Website..."
  cd "$WEBSITE_DIR/website"
  NODE_OPTIONS="--max-old-space-size=2048" npm run build
  log_success "AI Tech Website built"
else
  log_warn "Website source not found at $WEBSITE_DIR/website — skipping build"
fi

# ─── Step 14: PM2 Config + Start ──────────────────────────────────────────
log_step "STEP 14: PM2 Start"

# Stop existing processes
pm2 delete all 2>/dev/null || true

# Use ecosystem.dev.config.js from repo
cd "$PERMATRAX_DIR"

# Patch ecosystem.dev.config.js paths if needed
# (file already points to /var/www paths from earlier setup)
pm2 start ecosystem.dev.config.js
pm2 save

# Generate and run the startup command automatically
PM2_STARTUP=$(pm2 startup systemd -u root --hp /root 2>&1 | grep -E '^sudo env' || true)
if [[ -n "$PM2_STARTUP" ]]; then
  eval "$PM2_STARTUP"
  log_success "PM2 startup on boot configured"
fi

log_success "PM2 started — $(pm2 list 2>/dev/null | grep -c 'online') processes online"

# ─── Step 15: Nginx Config ────────────────────────────────────────────────
log_step "STEP 15: Nginx Configuration"

# Disable default site
rm -f /etc/nginx/sites-enabled/default

# Install our aitech config (bootstrap — HTTP only for Certbot)
cat > /etc/nginx/sites-available/aitech-ilt.co.id << 'NGINXEOF'
# Bootstrap config — HTTP only, used for Certbot domain validation
# Will be replaced by the full HTTPS config after SSL is issued
server {
    listen 80;
    listen [::]:80;
    server_name aitech-ilt.co.id www.aitech-ilt.co.id;

    # Certbot webroot challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Permatrax DEV — API
    location /Permatrax/api/ {
        rewrite ^/Permatrax(.*)$ $1 break;
        proxy_pass http://localhost:3003;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_set_header X-Real-IP  $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Permatrax DEV — Web
    location /Permatrax {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_cache_bypass $http_upgrade;
    }

    # AI Tech Website
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host       $host;
        proxy_cache_bypass $http_upgrade;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/aitech-ilt.co.id /etc/nginx/sites-enabled/aitech-ilt.co.id

nginx -t || die "Nginx config test failed"
systemctl restart nginx
systemctl enable nginx

log_success "Nginx running (HTTP bootstrap)"

# ─── Step 16: SSL (Let's Encrypt) ─────────────────────────────────────────
log_step "STEP 16: SSL Certificate (Let's Encrypt)"

if [[ ! -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]]; then
  log_info "Requesting SSL certificate for $DOMAIN..."

  if certbot --nginx \
      -d "$DOMAIN" -d "$WWW_DOMAIN" \
      --non-interactive \
      --agree-tos \
      --email "$ADMIN_EMAIL" \
      --redirect; then

    log_success "SSL certificate installed"

    # Now install the full HTTPS config from the repo
    cp "$PERMATRAX_DIR/nginx/aitech-ilt.co.id.conf" \
       /etc/nginx/sites-available/aitech-ilt.co.id

    nginx -t || die "nginx -t failed after SSL install"
    systemctl reload nginx
    log_success "Full HTTPS Nginx config activated"

    # Auto-renewal cron
    if ! crontab -l 2>/dev/null | grep -q 'certbot renew'; then
      (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
    fi
    log_success "Certbot auto-renewal configured"

  else
    log_warn "SSL request failed — DNS may not be pointing to this server yet."
    log_warn "Once DNS is ready, run: certbot --nginx -d $DOMAIN -d $WWW_DOMAIN"
    log_warn "Then copy: cp $PERMATRAX_DIR/nginx/aitech-ilt.co.id.conf /etc/nginx/sites-available/aitech-ilt.co.id && nginx -t && systemctl reload nginx"
  fi
else
  log_info "SSL certificate already exists — skipping Certbot"
fi

# ─── Step 17: Health Checks ───────────────────────────────────────────────
log_step "STEP 17: Health Checks"

sleep 5

check_port() {
  local port=$1
  local name=$2
  if nc -z localhost "$port" 2>/dev/null; then
    log_success "$name is listening on port $port"
  else
    log_warn "$name NOT responding on port $port — check: pm2 logs"
  fi
}

check_port $WEBSITE_PORT      "AI Tech Website"
check_port $PERMATRAX_WEB_PORT "Permatrax DEV Web"
check_port $PERMATRAX_API_PORT "Permatrax DEV API"

if curl -sf http://localhost/Permatrax > /dev/null 2>&1; then
  log_success "Nginx routing /Permatrax → OK"
else
  log_warn "Nginx /Permatrax not responding yet (app may still be starting)"
fi

# ─── Step 18: Save Credentials + Summary ─────────────────────────────────
log_step "STEP 18: Summary"

CREDS_FILE="$PERMATRAX_DIR/.setup-credentials.txt"
cat > "$CREDS_FILE" << EOF
AI Tech DEV VPS — Setup Credentials
=====================================
Generated: $(date)

Domain:       https://${DOMAIN}
Permatrax:    https://${DOMAIN}/Permatrax
API:          https://${DOMAIN}/Permatrax/api

Database:
  Name:       ${DB_NAME}
  User:       ${DB_USER}
  Password:   ${DB_PASS}
  URL:        ${DATABASE_URL}

Redis:
  Password:   ${REDIS_PASS}
  URL:        ${REDIS_URL}

JWT:
  Secret:        ${JWT_SECRET}
  Refresh Secret: ${JWT_REFRESH_SECRET}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT: Store securely then delete this file!
  rm ${CREDS_FILE}
EOF

chmod 600 "$CREDS_FILE"

SERVER_IP=$(curl -sf ifconfig.me 2>/dev/null || echo "YOUR_SERVER_IP")

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           ✅  AI Tech DEV VPS Setup Complete!            ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}║  Website     →  https://${DOMAIN}              ║${NC}"
echo -e "${GREEN}║  Permatrax   →  https://${DOMAIN}/Permatrax    ║${NC}"
echo -e "${GREEN}║  API         →  https://${DOMAIN}/Permatrax/api║${NC}"
echo -e "${GREEN}║                                                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Credentials saved to:${NC} $CREDS_FILE"
echo -e "${RED}⚠  Delete this file after noting the credentials!${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "  1. Point DNS A records to this server:"
echo "       ${DOMAIN}     → ${SERVER_IP}"
echo "       ${WWW_DOMAIN} → ${SERVER_IP}"
echo ""
echo "  2. Fill in SMTP settings:"
echo "       nano $PERMATRAX_DIR/.env"
echo ""
echo "  3. If SSL failed (DNS not ready yet):"
echo "       certbot --nginx -d ${DOMAIN} -d ${WWW_DOMAIN}"
echo ""
echo "  4. Push AI Tech Website to GitHub, set WEBSITE_REPO, re-run script"
echo "     OR deploy website files manually to: $WEBSITE_DIR/website"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo "  pm2 status                  — check all processes"
echo "  pm2 logs                    — stream all logs"
echo "  pm2 logs permatrax-dev-web  — specific app logs"
echo "  pm2 restart all             — restart everything"
echo "  docker compose -f $PERMATRAX_DIR/docker-compose.dev.yml ps"
echo ""

#!/bin/bash

# =============================================================================
# PermaTrack Production VPS Setup Script (Ubuntu/Debian Version)
# Domain: permatrax.tech
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOMAIN="permatrax.tech"
WWW_DOMAIN="www.permatrax.tech"
APP_DIR="/var/www/Permatrax"
GITHUB_REPO="https://github.com/HackshieldHB/AI-Tech-Permatrax.git"
DB_NAME="permatrax"
DB_USER="permatrax_user"
DB_PASS="StrongPassword123"
REDIS_PASSWORD="$(openssl rand -base64 32)"
JWT_SECRET="$(openssl rand -base64 64)"
JWT_REFRESH_SECRET="$(openssl rand -base64 64)"
ADMIN_EMAIL="admin@permatrax.tech"

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# =============================================================================
# STEP 1: System Updates & Dependencies
# =============================================================================
log_info "Step 1: Updating system and installing dependencies..."

apt-get update -y
apt-get upgrade -y

# Install essential packages
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
    tree

log_success "System dependencies installed"

# =============================================================================
# STEP 2: Install Node.js 20
# =============================================================================
log_info "Step 2: Installing Node.js 20..."

if ! command -v node &> /dev/null || [[ "$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" != "20" ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

log_success "Node.js $(node -v) installed"

# =============================================================================
# STEP 3: Install pnpm
# =============================================================================
log_info "Step 3: Installing pnpm..."

if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm@9
    # Setup pnpm environment
    export PNPM_HOME="/root/.local/share/pnpm"
    export PATH="$PNPM_HOME:$PATH"
    pnpm setup
fi

log_success "pnpm $(pnpm -v) installed"

# =============================================================================
# STEP 4: Install PM2
# =============================================================================
log_info "Step 4: Installing PM2..."

if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
fi

log_success "PM2 installed"

# =============================================================================
# STEP 5: Install Docker & Docker Compose
# =============================================================================
log_info "Step 5: Installing Docker and Docker Compose..."

if ! command -v docker &> /dev/null; then
    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker
fi

# Ensure docker compose plugin is available
if ! docker compose version &> /dev/null; then
    log_error "Docker Compose plugin not found"
    exit 1
fi

log_success "Docker $(docker --version) and Docker Compose installed"

# =============================================================================
# STEP 6: Configure Firewall
# =============================================================================
log_info "Step 6: Configuring UFW firewall..."

ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow OpenSSH

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Explicitly deny database and app ports from external access
ufw deny 5432/tcp    # PostgreSQL
ufw deny 6379/tcp    # Redis
ufw deny 3000/tcp    # Next.js dev (not used in prod but safety)
ufw deny 3001/tcp    # API (internal only, proxied by Nginx)

# Enable UFW if not already enabled
if ! ufw status | grep -q "Status: active"; then
    echo "y" | ufw enable
fi

ufw reload

log_success "UFW configured - Ports 22, 80, 443 open. DB/Redis/Apps blocked externally."

# =============================================================================
# STEP 7: Create Application Directory Structure
# =============================================================================
log_info "Step 7: Creating application directory structure..."

mkdir -p "$APP_DIR"
mkdir -p "$APP_DIR/uploads"
mkdir -p "$APP_DIR/logs"
mkdir -p "$APP_DIR/nginx"

# Set proper permissions
chown -R www-data:www-data "$APP_DIR/uploads"
chmod -R 755 "$APP_DIR/uploads"

log_success "Directory structure created at $APP_DIR"

# =============================================================================
# STEP 8: Setup Docker Compose for Database and Redis
# =============================================================================
log_info "Step 8: Setting up PostgreSQL and Redis with Docker Compose..."

DOCKER_COMPOSE_FILE="$APP_DIR/docker-compose.prod.yml"

cat > "$DOCKER_COMPOSE_FILE" << 'EOF'
version: '3.8'

services:
  postgres:
    image: postgis/postgis:15-3.3
    container_name: permatrax-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${DB_NAME:-permatrax}
      POSTGRES_USER: ${DB_USER:-permatrax_user}
      POSTGRES_PASSWORD: ${DB_PASS:-StrongPassword123}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-permatrax_user} -d ${DB_NAME:-permatrax}"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - permatrax-network

  redis:
    image: redis:7-alpine
    container_name: permatrax-redis
    restart: unless-stopped
    command: >
      sh -c '
        echo "requirepass ${REDIS_PASSWORD}" > /usr/local/etc/redis/redis.conf &&
        echo "appendonly yes" >> /usr/local/etc/redis/redis.conf &&
        echo "appendfsync everysec" >> /usr/local/etc/redis/redis.conf &&
        echo "bind 127.0.0.1" >> /usr/local/etc/redis/redis.conf &&
        redis-server /usr/local/etc/redis/redis.conf
      '
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - permatrax-network

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local

networks:
  permatrax-network:
    driver: bridge
EOF

# Create environment file for Docker Compose
DOCKER_ENV_FILE="$APP_DIR/.docker.env"
cat > "$DOCKER_ENV_FILE" << EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
REDIS_PASSWORD=$REDIS_PASSWORD
EOF

log_success "Docker Compose configuration created"

# Start database services
log_info "Starting PostgreSQL and Redis containers..."
cd "$APP_DIR"
docker compose -f docker-compose.prod.yml --env-file .docker.env up -d

# Wait for PostgreSQL to be ready
log_info "Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
    if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "$DB_USER" -d "$DB_NAME" > /dev/null 2>&1; then
        log_success "PostgreSQL is ready"
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        log_error "PostgreSQL failed to start within 60 seconds"
        exit 1
    fi
done

# Wait for Redis to be ready
log_info "Waiting for Redis to be ready..."
for i in {1..30}; do
    if docker compose -f docker-compose.prod.yml exec -T redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q "PONG"; then
        log_success "Redis is ready"
        break
    fi
    sleep 2
    if [ $i -eq 30 ]; then
        log_error "Redis failed to start within 60 seconds"
        exit 1
    fi
done

# =============================================================================
# STEP 9: Clone or Update Repository
# =============================================================================
log_info "Step 9: Setting up application code..."

if [ -d "$APP_DIR/.git" ]; then
    log_info "Repository exists, pulling latest changes..."
    cd "$APP_DIR"
    git fetch origin
    git reset --hard origin/main || git reset --hard origin/master
else
    log_info "Cloning repository..."
    git clone "$GITHUB_REPO" "$APP_DIR"
    cd "$APP_DIR"
fi

log_success "Repository ready at $APP_DIR"

# =============================================================================
# STEP 10: Create Environment Files
# =============================================================================
log_info "Step 10: Creating environment files..."

DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@127.0.0.1:5432/${DB_NAME}?schema=public&connection_limit=5&pool_timeout=20"
REDIS_URL="redis://:${REDIS_PASSWORD}@127.0.0.1:6379"

# Function to backup existing env file
backup_env() {
    local file="$1"
    if [ -f "$file" ]; then
        local backup="${file}.backup.$(date +%Y%m%d_%H%M%S)"
        cp "$file" "$backup"
        log_info "Backed up existing $(basename "$file") to $(basename "$backup")"
    fi
}

# Root .env
backup_env "$APP_DIR/.env"
cat > "$APP_DIR/.env" << EOF
# =============================================================================
# PermaTrack Production Environment
# Generated: $(date)
# =============================================================================

NODE_ENV=production

# Database
DATABASE_URL=${DATABASE_URL}

# Redis
REDIS_URL=${REDIS_URL}

# JWT Secrets (CHANGE THESE IMMEDIATELY!)
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

# Application URLs
FRONTEND_URL=https://${DOMAIN}
API_URL=https://${DOMAIN}/api
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://${WWW_DOMAIN}

# File Storage
UPLOAD_DIR=${APP_DIR}/uploads
FILE_BASE_URL=https://${DOMAIN}/api/files

# Ports (internal only, proxied by Nginx)
API_PORT=3001
WEB_PORT=3000

# Email (update with your SMTP settings)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
FROM_EMAIL=noreply@${DOMAIN}
EOF

# API .env
backup_env "$APP_DIR/apps/api/.env"
cat > "$APP_DIR/apps/api/.env" << EOF
NODE_ENV=production
PORT=3001

DATABASE_URL=${DATABASE_URL}
REDIS_URL=${REDIS_URL}

JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}

FRONTEND_URL=https://${DOMAIN}
CORS_ALLOWED_ORIGINS=https://${DOMAIN},https://${WWW_DOMAIN}

UPLOAD_DIR=${APP_DIR}/uploads
FILE_BASE_URL=https://${DOMAIN}/api/files
EOF

# Web .env.production
backup_env "$APP_DIR/apps/web/.env.production"
cat > "$APP_DIR/apps/web/.env.production" << EOF
NODE_ENV=production
NEXT_PUBLIC_API_URL=https://${DOMAIN}/api
NEXT_PUBLIC_FILES_URL=https://${DOMAIN}/api/files
EOF

# Web .env.local (symlink to .env.production if doesn't exist)
if [ ! -f "$APP_DIR/apps/web/.env.local" ]; then
    cp "$APP_DIR/apps/web/.env.production" "$APP_DIR/apps/web/.env.local"
fi

log_success "Environment files created"
log_warn "IMPORTANT: JWT secrets are auto-generated. Change them in production if needed."

# =============================================================================
# STEP 11: Install Dependencies and Build
# =============================================================================
log_info "Step 11: Installing dependencies and building..."

cd "$APP_DIR"

# Install dependencies
export PNPM_HOME="/root/.local/share/pnpm"
export PATH="$PNPM_HOME:$PATH"
pnpm install --frozen-lockfile

# Generate Prisma Client
log_info "Generating Prisma client..."
cd "$APP_DIR/packages/db"
npx prisma generate

# Run database migrations
log_info "Running Prisma migrations..."
npx prisma migrate deploy

# Optional: Import users if /root/users.sql exists
if [ -f "/root/users.sql" ]; then
    log_info "Found /root/users.sql - importing users..."
    if docker compose -f "$APP_DIR/docker-compose.prod.yml" exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" < /root/users.sql; then
        log_success "Users imported successfully"
        
        # Reset sequence if users table exists
        if docker compose -f "$APP_DIR/docker-compose.prod.yml" exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c "\dt users" | grep -q "users"; then
            log_info "Resetting users id sequence..."
            docker compose -f "$APP_DIR/docker-compose.prod.yml" exec postgres psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1), false);" || true
        fi
    else
        log_warn "Failed to import users.sql - continuing setup"
    fi
fi

# Optional: Run seed if seed.ts exists
if [ -f "$APP_DIR/packages/db/prisma/seed.ts" ] || [ -f "$APP_DIR/packages/db/prisma/seed.js" ]; then
    log_info "Running database seed (optional)..."
    cd "$APP_DIR/packages/db"
    npx prisma db seed || log_warn "Seed failed or not configured - continuing"
fi

# Build the project
log_info "Building the application..."
cd "$APP_DIR"
pnpm build

log_success "Application built successfully"

# =============================================================================
# STEP 12: Configure PM2
# =============================================================================
log_info "Step 12: Configuring PM2..."

PM2_CONFIG="$APP_DIR/ecosystem.config.js"

if [ -f "$PM2_CONFIG" ]; then
    log_info "Using existing ecosystem.config.js"
else
    log_info "Creating PM2 ecosystem configuration..."
    cat > "$PM2_CONFIG" << 'EOF'
module.exports = {
  apps: [
    {
      name: 'permatrax-api',
      cwd: './apps/api',
      script: 'dist/apps/api/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
      error_file: '../../logs/api-error.log',
      out_file: '../../logs/api-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: '10s',
      kill_timeout: 5000,
      listen_timeout: 10000,
      source_map_support: true,
    },
    {
      name: 'permatrax-web',
      cwd: './apps/web',
      script: 'node_modules/.bin/next',
      args: 'start',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      error_file: '../../logs/web-error.log',
      out_file: '../../logs/web-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      max_memory_restart: '1G',
      restart_delay: 3000,
      max_restarts: 5,
      min_uptime: '10s',
      kill_timeout: 5000,
      listen_timeout: 10000,
    },
  ],
};
EOF
fi

# Stop existing processes if running
pm2 delete all 2>/dev/null || true

# Start applications
log_info "Starting applications with PM2..."
cd "$APP_DIR"
pm2 start ecosystem.config.js

# Save PM2 process list
pm2 save

# Setup PM2 startup script
pm2 startup systemd -u root --hp /root 2>/dev/null || true

log_success "PM2 configured and applications started"

# =============================================================================
# STEP 13: Configure Nginx
# =============================================================================
log_info "Step 13: Configuring Nginx..."

NGINX_CONFIG="/etc/nginx/sites-available/permatrax"

# Remove default site if exists
rm -f /etc/nginx/sites-enabled/default

cat > "$NGINX_CONFIG" << 'EOF'
# Rate limiting zones
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=auth_limit:10m rate=5r/m;
limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

upstream permatrax_api {
    server 127.0.0.1:3001;
    keepalive 32;
}

upstream permatrax_web {
    server 127.0.0.1:3000;
    keepalive 32;
}

# HTTP to HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name permatrax.tech www.permatrax.tech;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://$server_name$request_uri;
    }
}

# Main HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name permatrax.tech www.permatrax.tech;

    # SSL certificates (will be configured by Certbot)
    ssl_certificate /etc/letsencrypt/live/permatrax.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/permatrax.tech/privkey.pem;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    
    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;

    # Client limits
    client_max_body_size 50M;
    client_body_timeout 60s;
    client_header_timeout 60s;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # Static files caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri @web;
    }

    # API proxy
    location /api/ {
        limit_req zone=api_limit burst=20 nodelay;
        limit_conn conn_limit 10;
        
        proxy_pass http://permatrax_api/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://permatrax_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Frontend proxy (catch-all)
    location @web {
        proxy_pass http://permatrax_web;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        proxy_buffering on;
        proxy_buffer_size 4k;
        proxy_buffers 8 4k;
    }

    location / {
        try_files $uri $uri/ @web;
    }

    # Health check endpoint
    location /nginx-health {
        access_log off;
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }
}
EOF

# Enable site
ln -sf "$NGINX_CONFIG" /etc/nginx/sites-enabled/permatrax

# Test Nginx configuration
log_info "Testing Nginx configuration..."
nginx -t

# Restart Nginx
systemctl restart nginx
systemctl enable nginx

log_success "Nginx configured"

# =============================================================================
# STEP 14: Setup SSL with Certbot
# =============================================================================
log_info "Step 14: Setting up SSL certificates..."

# Create directory for Certbot webroot
mkdir -p /var/www/certbot

# Check if certificates already exist
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    log_info "SSL certificates already exist, skipping Certbot"
else
    log_info "Requesting SSL certificates from Let's Encrypt..."
    
    # Request certificate with non-interactive mode
    if certbot certonly --non-interactive --agree-tos --email "$ADMIN_EMAIL" \
        --webroot -w /var/www/certbot \
        -d "$DOMAIN" -d "$WWW_DOMAIN"; then
        log_success "SSL certificates obtained successfully"
    else
        log_warn "SSL certificate request failed - checking for staging/test mode..."
        # Try with staging server for testing (doesn't count against rate limits)
        log_warn "You can test with: certbot certonly --staging --webroot -w /var/www/certbot -d $DOMAIN -d $WWW_DOMAIN"
        log_warn "Nginx is configured but SSL certificates are not active yet."
        log_warn "Once DNS is properly configured, run: certbot --nginx -d $DOMAIN -d $WWW_DOMAIN"
    fi
fi

# Setup auto-renewal ( Certbot systemd timer should already be enabled)
if systemctl is-active certbot.timer &>/dev/null; then
    log_success "Certbot auto-renewal is active"
else
    systemctl enable certbot.timer
    systemctl start certbot.timer
    log_success "Certbot auto-renewal enabled"
fi

# =============================================================================
# STEP 15: Health Checks
# =============================================================================
log_info "Step 15: Running health checks..."

sleep 5  # Wait for services to be ready

# Check API health
if curl -sf http://localhost:3001/api/health/ready > /dev/null 2>&1 || \
   curl -sf http://localhost:3001/health > /dev/null 2>&1 || \
   curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    log_success "API health check passed"
else
    log_warn "API health check endpoint not responding (may need to be implemented)"
    # Check if API is at least listening
    if nc -z localhost 3001; then
        log_success "API is listening on port 3001"
    else
        log_warn "API does not appear to be listening on port 3001"
    fi
fi

# Check Web
if nc -z localhost 3000; then
    log_success "Web server is listening on port 3000"
else
    log_warn "Web server does not appear to be listening on port 3000"
fi

# Check Nginx
if curl -sf http://localhost/nginx-health > /dev/null 2>&1; then
    log_success "Nginx is running"
else
    log_warn "Nginx health check failed"
fi

# =============================================================================
# STEP 16: Final Summary
# =============================================================================
echo ""
echo "============================================================================="
echo -e "${GREEN}                    PermaTrack Setup Complete!${NC}"
echo "============================================================================="
echo ""
echo -e "${BLUE}Application Directory:${NC} $APP_DIR"
echo -e "${BLUE}Domain:${NC} https://$DOMAIN"
echo -e "${BLUE}API URL:${NC} https://$DOMAIN/api"
echo ""
echo -e "${YELLOW}Important Next Steps:${NC}"
echo ""
echo "1. Update JWT secrets in $APP_DIR/.env (currently auto-generated)"
echo ""
echo "2. Configure SMTP settings in $APP_DIR/.env for email functionality"
echo ""
echo "3. If SSL failed, ensure DNS is configured correctly:"
echo "   - A record: $DOMAIN -> $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP')"
echo "   - A record: $WWW_DOMAIN -> $(curl -s ifconfig.me 2>/dev/null || echo 'YOUR_SERVER_IP')"
echo "   Then run: certbot --nginx -d $DOMAIN -d $WWW_DOMAIN"
echo ""
echo "4. Useful commands:"
echo "   - View logs:          pm2 logs"
echo "   - Restart apps:       pm2 restart all"
echo "   - Check status:       pm2 status"
echo "   - Database console:   cd $APP_DIR && docker compose -f docker-compose.prod.yml exec postgres psql -U $DB_USER -d $DB_NAME"
echo "   - Redis CLI:          cd $APP_DIR && docker compose -f docker-compose.prod.yml exec redis redis-cli -a '$REDIS_PASSWORD'"
echo ""
echo "5. Firewall status:"
ufw status numbered
echo ""
echo "6. Backup your .env files and database regularly!"
echo ""
echo -e "${GREEN}Your application should be accessible at: https://$DOMAIN${NC}"
echo ""
echo "============================================================================="

# Save setup info to file
SETUP_INFO="$APP_DIR/.setup-info.txt"
cat > "$SETUP_INFO" << EOF
PermaTrack Setup Information
=============================
Date: $(date)
Domain: $DOMAIN
Database: $DB_NAME
Redis Password: $REDIS_PASSWORD
JWT Secret: $JWT_SECRET
JWT Refresh Secret: $JWT_REFRESH_SECRET

Database URL: $DATABASE_URL
Redis URL: $REDIS_URL

IMPORTANT: Store this file securely and delete it after noting the credentials.
EOF

chmod 600 "$SETUP_INFO"
log_warn "Setup credentials saved to $SETUP_INFO - store securely and delete after noting!"

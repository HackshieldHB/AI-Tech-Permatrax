#!/usr/bin/env bash
# PermaTrack Production Start Script (AlmaLinux/RHEL compatible)
# Starts Docker (DB + Redis), PM2 apps, and Nginx
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

APP_DIR="${APP_DIR:-/var/www/permatrax}"

echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}  PermaTrack Production Start Script${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# Helper Functions
# =============================================================================

is_docker_running() {
  docker info &>/dev/null
}

is_container_running() {
  local container="$1"
  docker ps --format '{{.Names}}' | grep -q "^${container}$"
}

# =============================================================================
# STEP 1: Start Docker
# =============================================================================
echo -e "${BLUE}[1/4] Starting Docker...${NC}"

if ! is_docker_running; then
  systemctl start docker
  echo -e "${GREEN}  ✓ Docker daemon started${NC}"
else
  echo -e "${YELLOW}  • Docker already running${NC}"
fi

# =============================================================================
# STEP 2: Start Database and Redis
# =============================================================================
echo ""
echo -e "${BLUE}[2/4] Starting Database and Redis containers...${NC}"

if [ -f "$APP_DIR/docker-compose.prod.yml" ]; then
  cd "$APP_DIR"
  
  # Check if containers exist but are stopped
  if docker ps -a --format '{{.Names}}' | grep -q "permatrax-postgres"; then
    echo -e "${YELLOW}  • Containers exist, starting them...${NC}"
    docker compose -f docker-compose.prod.yml start
  else
    echo -e "${YELLOW}  • Creating and starting containers...${NC}"
    docker compose -f docker-compose.prod.yml up -d
  fi
  
  # Wait for containers to be healthy
  echo -e "${YELLOW}  • Waiting for services to be ready...${NC}"
  for i in {1..30}; do
    if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U permatrax_user -d permatrax &>/dev/null; then
      break
    fi
    sleep 1
  done
  
  echo -e "${GREEN}  ✓ Database containers running${NC}"
else
  echo -e "${YELLOW}  • docker-compose.prod.yml not found at $APP_DIR${NC}"
  echo -e "${YELLOW}  • Skipping Docker container startup${NC}"
fi

# =============================================================================
# STEP 3: Start PM2 Applications
# =============================================================================
echo ""
echo -e "${BLUE}[3/4] Starting PM2 applications...${NC}"

if command -v pm2 &>/dev/null; then
  cd "$APP_DIR"
  
  if [ -f "$APP_DIR/ecosystem.config.js" ]; then
    # Check if already running
    if pm2 list | grep -q "permatrax-api\|permatrax-web"; then
      echo -e "${YELLOW}  • Apps already running, reloading...${NC}"
      pm2 reload ecosystem.config.js --env production
    else
      echo -e "${YELLOW}  • Starting PM2 apps...${NC}"
      pm2 start ecosystem.config.js --env production
    fi
    
    # Save PM2 process list
    pm2 save &>/dev/null || true
    
    echo -e "${GREEN}  ✓ PM2 applications started${NC}"
  else
    echo -e "${YELLOW}  • ecosystem.config.js not found, using fallback...${NC}"
    
    # Fallback: Start API
    if [ -f "$APP_DIR/apps/api/dist/main.js" ]; then
      if pm2 list | grep -q "permatrax-api"; then
        pm2 reload permatrax-api
      else
        pm2 start "$APP_DIR/apps/api/dist/main.js" --name "permatrax-api"
      fi
      echo -e "${GREEN}  ✓ API started${NC}"
    else
      echo -e "${RED}  ✗ API build not found at apps/api/dist/main.js${NC}"
    fi
    
    # Fallback: Start Web
    cd "$APP_DIR/apps/web"
    if pm2 list | grep -q "permatrax-web"; then
      pm2 reload permatrax-web
    else
      pm2 start "pnpm" --name "permatrax-web" -- start
    fi
    echo -e "${GREEN}  ✓ Web started${NC}"
    
    pm2 save &>/dev/null || true
  fi
else
  echo -e "${RED}  ✗ PM2 not found. Install with: npm install -g pm2${NC}"
fi

# =============================================================================
# STEP 4: Start/Reload Nginx
# =============================================================================
echo ""
echo -e "${BLUE}[4/4] Starting Nginx...${NC}"

if systemctl is-active nginx &>/dev/null; then
  echo -e "${YELLOW}  • Nginx already running, reloading configuration...${NC}"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx
    echo -e "${GREEN}  ✓ Nginx reloaded${NC}"
  else
    echo -e "${RED}  ✗ Nginx configuration test failed${NC}"
  fi
else
  if nginx -t 2>/dev/null; then
    systemctl start nginx
    systemctl enable nginx
    echo -e "${GREEN}  ✓ Nginx started and enabled${NC}"
  else
    echo -e "${RED}  ✗ Nginx configuration test failed${NC}"
  fi
fi

# =============================================================================
# Health Checks
# =============================================================================
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}           Health Check Results${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Check Docker containers
if [ -f "$APP_DIR/docker-compose.prod.yml" ]; then
  cd "$APP_DIR"
  echo -e "${BLUE}Docker Containers:${NC}"
  docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Health}}" 2>/dev/null | tail -n +2 | while read line; do
    if echo "$line" | grep -q "running\|healthy"; then
      echo -e "${GREEN}  ✓ $line${NC}"
    else
      echo -e "${YELLOW}  • $line${NC}"
    fi
  done
  echo ""
fi

# Check PM2 status
echo -e "${BLUE}PM2 Processes:${NC}"
if command -v pm2 &>/dev/null; then
  pm2 list | grep -E "permatrax|App name" | while read line; do
    if echo "$line" | grep -q "online"; then
      echo -e "${GREEN}  ✓ $line${NC}"
    elif echo "$line" | grep -q "App name"; then
      echo -e "${BLUE}  $line${NC}"
    else
      echo -e "${YELLOW}  • $line${NC}"
    fi
  done
else
  echo -e "${YELLOW}  • PM2 not installed${NC}"
fi
echo ""

# Check API
echo -e "${BLUE}API Health Check:${NC}"
for endpoint in "http://localhost:3001/api/health/ready" "http://localhost:3001/health" "http://localhost:3001/api/health"; do
  if curl -sf "$endpoint" &>/dev/null; then
    echo -e "${GREEN}  ✓ API responding at $endpoint${NC}"
    break
  fi
done || echo -e "${YELLOW}  • API health endpoint not responding (may need implementation)${NC}"

# Check ports
echo -e "${BLUE}Port Status:${NC}"
if nc -z localhost 3000 2>/dev/null; then
  echo -e "${GREEN}  ✓ Port 3000 (Web) - OPEN${NC}"
else
  echo -e "${YELLOW}  • Port 3000 (Web) - Not responding${NC}"
fi

if nc -z localhost 3001 2>/dev/null; then
  echo -e "${GREEN}  ✓ Port 3001 (API) - OPEN${NC}"
else
  echo -e "${YELLOW}  • Port 3001 (API) - Not responding${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}     PermaTrack services started!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Access URLs:${NC}"
echo -e "  Local API:  http://localhost:3001"
echo -e "  Local Web:  http://localhost:3000"
echo -e "  Public:     https://permatrax.tech"
echo ""
echo -e "${BLUE}Useful Commands:${NC}"
echo -e "  View logs:     pm2 logs"
echo -e "  Monitor:       pm2 monit"
echo -e "  Stop all:     ./stop.sh"
echo -e "  Restart:      pm2 restart all"
echo ""

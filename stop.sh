#!/usr/bin/env bash
# PermaTrack Production Stop Script (AlmaLinux/RHEL compatible)
# Stops Nginx, PM2 apps, and Docker containers safely
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
echo -e "${BLUE}  PermaTrack Production Stop Script${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# =============================================================================
# STEP 1: Stop Nginx
# =============================================================================
echo -e "${BLUE}[1/4] Stopping Nginx...${NC}"

if systemctl is-active nginx &>/dev/null; then
  systemctl stop nginx
  echo -e "${GREEN}  ✓ Nginx stopped${NC}"
else
  echo -e "${YELLOW}  • Nginx not running${NC}"
fi

# =============================================================================
# STEP 2: Stop PM2 Applications
# =============================================================================
echo ""
echo -e "${BLUE}[2/4] Stopping PM2 applications...${NC}"

if command -v pm2 &>/dev/null; then
  # Check if apps are running
  if pm2 list | grep -q "permatrax-api\|permatrax-web"; then
    echo -e "${YELLOW}  • Stopping PM2 applications...${NC}"
    pm2 stop all || true
    pm2 delete all || true
    echo -e "${GREEN}  ✓ PM2 applications stopped${NC}"
  else
    echo -e "${YELLOW}  • No PM2 applications running${NC}"
  fi
else
  echo -e "${YELLOW}  • PM2 not installed${NC}"
fi

# =============================================================================
# STEP 3: Stop Docker Containers (DB + Redis)
# =============================================================================
echo ""
echo -e "${BLUE}[3/4] Stopping Docker containers...${NC}"

if command -v docker &>/dev/null && docker info &>/dev/null; then
  if [ -f "$APP_DIR/docker-compose.prod.yml" ]; then
    cd "$APP_DIR"
    
    # Check if containers are running
    if docker ps --format '{{.Names}}' | grep -q "permatrax-"; then
      echo -e "${YELLOW}  • Stopping database and Redis containers...${NC}"
      docker compose -f docker-compose.prod.yml stop
      echo -e "${GREEN}  ✓ Docker containers stopped (volumes preserved)${NC}"
    else
      echo -e "${YELLOW}  • Docker containers not running${NC}"
    fi
  else
    echo -e "${YELLOW}  • docker-compose.prod.yml not found${NC}"
  fi
else
  echo -e "${YELLOW}  • Docker not running or not installed${NC}"
fi

# =============================================================================
# STEP 4: Show Final Status
# =============================================================================
echo ""
echo -e "${BLUE}============================================${NC}"
echo -e "${BLUE}           Final Status${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# Nginx status
echo -e "${BLUE}Nginx:${NC}"
if systemctl is-active nginx &>/dev/null; then
  echo -e "${RED}  ✗ Still running${NC}"
else
  echo -e "${GREEN}  ✓ Stopped${NC}"
fi

# PM2 status
echo ""
echo -e "${BLUE}PM2 Processes:${NC}"
if command -v pm2 &>/dev/null; then
  if pm2 list 2>/dev/null | grep -q "permatrax"; then
    pm2 list | grep "permatrax" | while read line; do
      echo -e "${YELLOW}  • $line${NC}"
    done
  else
    echo -e "${GREEN}  ✓ All stopped${NC}"
  fi
else
  echo -e "${YELLOW}  • PM2 not installed${NC}"
fi

# Docker status
echo ""
echo -e "${BLUE}Docker Containers:${NC}"
if command -v docker &>/dev/null && docker ps --format '{{.Names}}' | grep -q "permatrax-" 2>/dev/null; then
  docker ps --filter "name=permatrax-" --format "table {{.Names}}\t{{.Status}}" | tail -n +2 | while read line; do
    echo -e "${YELLOW}  • $line${NC}"
  done
else
  echo -e "${GREEN}  ✓ All stopped${NC}"
fi

# Port status
echo ""
echo -e "${BLUE}Port Status:${NC}"
if nc -z localhost 3000 2>/dev/null; then
  echo -e "${YELLOW}  • Port 3000 (Web) - Still in use${NC}"
else
  echo -e "${GREEN}  ✓ Port 3000 (Web) - Closed${NC}"
fi

if nc -z localhost 3001 2>/dev/null; then
  echo -e "${YELLOW}  • Port 3001 (API) - Still in use${NC}"
else
  echo -e "${GREEN}  ✓ Port 3001 (API) - Closed${NC}"
fi

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}     PermaTrack services stopped!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo -e "${BLUE}Note: Docker volumes are preserved.${NC}"
echo -e "${BLUE}To start again: ./start.sh${NC}"
echo ""

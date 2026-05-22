#!/bin/bash
# Fix Redis container — remove --bind 127.0.0.1 yang block Docker port forwarding

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_ok()   { echo -e "${GREEN}[OK]${NC}   $*"; }
die()      { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

REDIS_PASS="redis123"

log_info "Stopping old Redis container..."
docker stop permatrax-dev-redis 2>/dev/null || true
docker rm   permatrax-dev-redis 2>/dev/null || true

log_info "Starting Redis (fixed config)..."
docker run -d \
  --name permatrax-dev-redis \
  --network permatrax-dev-net \
  --restart unless-stopped \
  -p 127.0.0.1:6379:6379 \
  -v permatrax_dev_redis:/data \
  redis:7-alpine \
  redis-server --requirepass "$REDIS_PASS" --appendonly yes

log_info "Waiting for Redis..."
for i in $(seq 1 15); do
  if docker exec permatrax-dev-redis redis-cli -a "$REDIS_PASS" ping 2>/dev/null | grep -q "PONG"; then
    log_ok "Redis PONG ✅"; break
  fi
  sleep 2
  [[ $i -eq 15 ]] && die "Redis timeout — cek: docker logs permatrax-dev-redis"
done

log_info "Restarting permatrax-dev-api..."
pm2 restart permatrax-dev-api

sleep 5
pm2 status

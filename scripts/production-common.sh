# Shared helpers for production shell scripts (source from full-setup.sh, start.sh, etc.)

production_load_env() {
  local root="$1"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck source=/dev/null
    source "$root/.env"
    set +a
  fi
  # Prisma / API: build DATABASE_URL from POSTGRES_* when components are set
  if [[ -n "${POSTGRES_USER:-}" && -n "${POSTGRES_PASSWORD:-}" && -n "${POSTGRES_DB:-}" ]]; then
    export DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?schema=public"
  fi
  if [[ -n "${REDIS_PASSWORD:-}" ]]; then
    export REDIS_URL="redis://:${REDIS_PASSWORD}@localhost:6379"
  fi
}

production_validate_env() {
  local root="$1"
  local missing=0
  local var

  production_load_env "$root"

  for var in DATABASE_URL POSTGRES_PASSWORD REDIS_PASSWORD JWT_SECRET JWT_REFRESH_SECRET REDIS_URL; do
    if [[ -z "${!var:-}" ]]; then
      echo "ERROR: ${var} is not set in .env"
      missing=1
    fi
  done

  return "$missing"
}

production_docker_compose() {
  local root="$1"
  shift
  cd "$root"
  if docker info &>/dev/null 2>&1; then
    docker compose -f docker-compose.prod.yml "$@"
  else
    sudo docker compose -f docker-compose.prod.yml "$@"
  fi
}

production_wait_container_healthy() {
  local container="$1"
  local label="${2:-$container}"
  local timeout="${3:-60}"
  local elapsed=0

  until docker inspect "$container" --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
    if [[ $elapsed -ge $timeout ]]; then
      echo "ERROR: ${label} did not become healthy within ${timeout}s. Check: docker logs ${container}"
      return 1
    fi
    sleep 2
    elapsed=$((elapsed + 2))
    echo -n "."
  done
  echo ""
  return 0
}

production_start_data_services() {
  local root="$1"
  local pull="${2:-false}"

  cd "$root"
  if [[ "$pull" == "true" ]]; then
    production_docker_compose "$root" pull postgres redis
  fi
  production_docker_compose "$root" up -d postgres redis
}

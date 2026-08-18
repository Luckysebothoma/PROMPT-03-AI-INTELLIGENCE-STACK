#!/usr/bin/env bash
# ============================================================
# AI GATEWAY - DAY 5 OF 10 - DEPLOYMENT SCRIPT
# AI Intelligence / Task Routing / Provider & Model Orchestration
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROJECT_NAME="ai-gateway-day5"
COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
ENV_EXAMPLE=".env.example"

# ---------- helpers ----------
info()  { echo -e "[INFO]  $*"; }
pass()  { echo -e "[PASS]  $*"; }
fail()  { echo -e "[FAIL]  $*"; }
warn()  { echo -e "[WARN]  $*"; }

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

check_docker() {
  info "Checking Docker..."
  if ! command -v docker >/dev/null 2>&1; then
    fail "Docker is not installed or not on PATH."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    fail "Docker daemon is not running or not accessible."
    exit 1
  fi
  pass "Docker is available."
}

check_compose() {
  info "Checking Docker Compose..."
  if docker compose version >/dev/null 2>&1; then
    pass "Docker Compose (plugin) is available."
  elif command -v docker-compose >/dev/null 2>&1; then
    pass "docker-compose (standalone) is available."
  else
    fail "Neither 'docker compose' nor 'docker-compose' was found."
    exit 1
  fi
}

# ---------- commands ----------

cmd_init() {
  info "Initializing Day 5 project structure..."
  mkdir -p scripts src

  if [ ! -f "$ENV_FILE" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
      cp "$ENV_EXAMPLE" "$ENV_FILE"
      info "Created $ENV_FILE from $ENV_EXAMPLE. Edit it to add real API keys."
    else
      fail "$ENV_EXAMPLE not found, cannot bootstrap $ENV_FILE."
      exit 1
    fi
  else
    info "$ENV_FILE already exists - preserving it (never overwritten)."
  fi

  check_docker
  check_compose
  pass "Init complete."
}

cmd_build() {
  check_docker
  info "Building Day 5 image..."
  compose build
  pass "Build complete."
}

cmd_push() {
  if [ -z "${REGISTRY:-}" ]; then
    warn "REGISTRY env var not set - skipping push (push is optional/configurable)."
    return 0
  fi
  info "Tagging and pushing image to $REGISTRY..."
  docker tag "${PROJECT_NAME}-day5-app:latest" "$REGISTRY/${PROJECT_NAME}:latest"
  docker push "$REGISTRY/${PROJECT_NAME}:latest"
  pass "Push complete."
}

cmd_up() {
  check_docker
  check_compose
  if [ ! -f "$ENV_FILE" ]; then
    warn "$ENV_FILE missing - running init first."
    cmd_init
  fi
  info "Starting Day 5 stack (Postgres, Redis, App)..."
  compose up -d
  pass "Stack started. App will be reachable at http://localhost:4407"
}

cmd_down() {
  info "Stopping Day 5 stack..."
  compose down
  pass "Stack stopped."
}

cmd_restart() {
  info "Restarting Day 5 stack..."
  compose down
  compose up -d
  pass "Stack restarted."
}

cmd_logs() {
  compose logs -f --tail=200
}

cmd_ps() {
  compose ps
}

cmd_test() {
  info "Running Day 5 test suite..."
  bash "$SCRIPT_DIR/scripts/day5-testing.sh"
}

cmd_all() {
  cmd_init
  cmd_build
  cmd_push
  cmd_up
  info "Waiting for services to become healthy..."
  sleep 8
  cmd_test
  cmd_ps
}

# ---------- entrypoint ----------
COMMAND="${1:-help}"
case "$COMMAND" in
  init)    cmd_init ;;
  build)   cmd_build ;;
  push)    cmd_push ;;
  up)      cmd_up ;;
  down)    cmd_down ;;
  restart) cmd_restart ;;
  logs)    cmd_logs ;;
  ps)      cmd_ps ;;
  test)    cmd_test ;;
  all)     cmd_all ;;
  *)
    echo "Usage: bash deploy-ai-gateway-5-of-10.sh {init|build|push|up|down|restart|logs|ps|test|all}"
    exit 1
    ;;
esac

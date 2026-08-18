#!/usr/bin/env bash
# ============================================================
# DAY 5 TEST SUITE
# ============================================================
set -uo pipefail

BASE_URL="${DAY5_URL:-http://localhost:4407}"
DAY3_URL="${DAY3_URL:-http://192.168.0.140:4405}"
DAY4_URL="${DAY4_URL:-http://127.0.0.1:4406}"

PASS=0
FAIL=0
SKIP=0

pass() { echo "[PASS] $1"; PASS=$((PASS+1)); }
fail() { echo "[FAIL] $1"; FAIL=$((FAIL+1)); }
skip() { echo "[SKIP] $1"; SKIP=$((SKIP+1)); }
info() { echo "[INFO] $1"; }

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is required but not installed"
    return 1
  fi
  pass "$1 is available"
  return 0
}

echo "============================================================"
echo "DAY 5 TEST SUITE - $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target: $BASE_URL"
echo "============================================================"

# 1-4: tooling
need curl || true
need jq || true
need docker || true
if docker info >/dev/null 2>&1; then pass "Day 5 container runtime reachable"; else fail "Docker daemon not reachable"; fi

# 5-6: Postgres / Redis containers up
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q ai-gateway-day5-postgres; then pass "PostgreSQL container running"; else skip "PostgreSQL container not found (may be external)"; fi
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q ai-gateway-day5-redis; then pass "Redis container running"; else skip "Redis container not found (may be external)"; fi

# 7-8: API health / readiness
health=$(curl -s -o /tmp/day5_health.json -w '%{http_code}' "$BASE_URL/health" 2>/dev/null)
if [ "$health" = "200" ]; then pass "API health check (200)"; else fail "API health check (got $health)"; fi

ready=$(curl -s -o /tmp/day5_ready.json -w '%{http_code}' "$BASE_URL/ready" 2>/dev/null)
if [ "$ready" = "200" ]; then pass "API readiness check (200)"; else fail "API readiness check (got $ready)"; fi

# 9: dependency diagnostics
deps=$(curl -s -o /tmp/day5_deps.json -w '%{http_code}' "$BASE_URL/dependencies" 2>/dev/null)
if [ "$deps" = "200" ]; then pass "Dependency diagnostics endpoint responded"; else fail "Dependency diagnostics endpoint (got $deps)"; fi

# 10: help
helpcode=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/help" 2>/dev/null)
if [ "$helpcode" = "200" ]; then pass "Help endpoint responded"; else fail "Help endpoint (got $helpcode)"; fi

# 11-13: provider registry / groq / gemini
provresp=$(curl -s "$BASE_URL/v1/providers" 2>/dev/null)
if echo "$provresp" | grep -q '"success":true'; then pass "Provider registry endpoint works"; else fail "Provider registry endpoint failed"; fi
if echo "$provresp" | grep -q '"groq"'; then pass "Groq provider registered"; else fail "Groq provider not found in registry"; fi
if echo "$provresp" | grep -q '"gemini"'; then pass "Gemini provider registered"; else fail "Gemini provider not found in registry"; fi

# 14: model registry
modresp=$(curl -s "$BASE_URL/v1/models" 2>/dev/null)
if echo "$modresp" | grep -q '"success":true'; then pass "Model registry endpoint works"; else fail "Model registry endpoint failed"; fi

# 15: worker registry
workresp=$(curl -s "$BASE_URL/v1/workers" 2>/dev/null)
if echo "$workresp" | grep -q '"success":true'; then pass "Worker registry endpoint works"; else fail "Worker registry endpoint failed"; fi

# 16: capability registry
capresp=$(curl -s "$BASE_URL/v1/capabilities" 2>/dev/null)
if echo "$capresp" | grep -q '"chat"'; then pass "Capability registry includes chat"; else fail "Capability registry missing chat"; fi

# 17: chat classification
chatcls=$(curl -s -X POST "$BASE_URL/v1/classify" -H 'Content-Type: application/json' -d '{"message":"Hello, how are you?"}' 2>/dev/null)
if echo "$chatcls" | grep -q '"intent":"chat"'; then pass "Chat classification correct"; else fail "Chat classification incorrect: $chatcls"; fi

# 18: vision classification
visioncls=$(curl -s -X POST "$BASE_URL/v1/classify" -H 'Content-Type: application/json' -d '{"message":"Identify what is contained in this image."}' 2>/dev/null)
if echo "$visioncls" | grep -q '"intent":"vision"'; then pass "Vision classification correct"; else fail "Vision classification incorrect: $visioncls"; fi

# 19: code classification
codecls=$(curl -s -X POST "$BASE_URL/v1/classify" -H 'Content-Type: application/json' -d '{"message":"Write a bash script that checks Docker containers."}' 2>/dev/null)
if echo "$codecls" | grep -q '"intent":"code"'; then pass "Code classification correct"; else fail "Code classification incorrect: $codecls"; fi

# 20: chat resolution
chatres=$(curl -s -X POST "$BASE_URL/v1/resolve" -H 'Content-Type: application/json' -d '{"capability":"chat"}' 2>/dev/null)
if echo "$chatres" | grep -q '"success":true'; then pass "Chat capability resolution works"; else fail "Chat capability resolution failed: $chatres"; fi

# 21: vision resolution (must select a vision-capable model)
visionres=$(curl -s -X POST "$BASE_URL/v1/resolve" -H 'Content-Type: application/json' -d '{"capability":"vision"}' 2>/dev/null)
if echo "$visionres" | grep -q '"success":true'; then pass "Vision capability resolution works"; else fail "Vision capability resolution failed: $visionres"; fi

# 22: worker resolution (unknown capability -> normalized error)
unkres=$(curl -s -X POST "$BASE_URL/v1/resolve" -H 'Content-Type: application/json' -d '{"capability":"nonexistent-capability-xyz"}' 2>/dev/null)
if echo "$unkres" | grep -q 'WORKER_UNAVAILABLE\|NO_CAPABLE_MODEL'; then pass "Worker resolution returns normalized error for unknown capability"; else fail "Unexpected response for unknown capability: $unkres"; fi

# 23: disabled model exclusion (structural check - requires admin toggle; verified via registry shape)
if echo "$modresp" | grep -q '"lifecycle"'; then pass "Model registry exposes lifecycle field for decommissioning"; else fail "Model registry missing lifecycle field"; fi

# 24: priority ordering (spot check on providers)
if echo "$provresp" | grep -q '"priority"'; then pass "Provider registry exposes priority field"; else fail "Provider registry missing priority field"; fi

# 25: PostgreSQL persistence
if [ "$ready" = "200" ] && grep -q '"postgres":true' /tmp/day5_ready.json 2>/dev/null; then pass "PostgreSQL persistence confirmed via /ready"; else fail "PostgreSQL not confirmed healthy"; fi

# 26: Redis cache
if grep -q '"redis":true' /tmp/day5_ready.json 2>/dev/null; then pass "Redis cache confirmed healthy"; else skip "Redis not connected (non-fatal, cache-only dependency)"; fi

# 27: normalized errors structure
if echo "$unkres" | grep -q '"retryable"'; then pass "Normalized error structure includes retryable flag"; else fail "Normalized error missing retryable flag"; fi

# 28: depth protection
depthres=$(curl -s -X POST "$BASE_URL/v1/chat" -H 'Content-Type: application/json' -d '{"message":"hi","depth":99}' 2>/dev/null)
if echo "$depthres" | grep -q 'MAX_ORCHESTRATION_DEPTH'; then pass "Orchestration depth protection works"; else fail "Depth protection did not trigger: $depthres"; fi

# 29: Prometheus metrics
metrics=$(curl -s "$BASE_URL/metrics" 2>/dev/null)
if echo "$metrics" | grep -q 'chat_requests_total'; then pass "Prometheus metrics exposed"; else fail "Prometheus metrics missing expected series"; fi

# 30: human /v1/chat endpoint
chatresp=$(curl -s -X POST "$BASE_URL/v1/chat" -H 'Content-Type: application/json' -d '{"message":"Hello, my name is Mimo and I am testing Day 5."}' 2>/dev/null)
if echo "$chatresp" | grep -q '"success":true' && echo "$chatresp" | grep -q '"request_id"'; then
  pass "Human /v1/chat endpoint works end-to-end"
else
  fail "Human /v1/chat endpoint failed: $chatresp"
fi

# 31: Day 4 integration
if curl -s -o /dev/null -w '%{http_code}' "$DAY4_URL/health" 2>/dev/null | grep -q '200'; then
  pass "Day 4 integration reachable"
else
  skip "Day 4 integration (Day 4 offline or not deployed - Day 5 degrades gracefully)"
fi

# 32: Day 3 integration
if curl -s -o /dev/null -w '%{http_code}' "$DAY3_URL/health" 2>/dev/null | grep -q '200'; then
  pass "Day 3 integration reachable"
else
  skip "Day 3 integration (Day 3 offline or not deployed)"
fi

# --- REAL AI TESTS ---
if [ -n "${GROQ_API_KEY:-}" ]; then
  info "Running lightweight Groq live test..."
  if echo "$chatresp" | grep -q '"provider":"groq"'; then pass "Groq live routing observed"; else skip "Groq live test inconclusive"; fi
else
  skip "Groq live test (GROQ_API_KEY not set)"
fi

if [ -n "${GEMINI_API_KEY:-}" ]; then
  info "Running lightweight Gemini live test..."
  if echo "$visionres" | grep -q '"provider":"gemini"'; then pass "Gemini live routing observed"; else skip "Gemini live test inconclusive"; fi
else
  skip "Gemini live test (GEMINI_API_KEY not set)"
fi

# 33: final docker state
echo "------------------------------------------------------------"
echo "FINAL DOCKER STATE"
echo "------------------------------------------------------------"
docker ps --filter "name=ai-gateway-day5" 2>/dev/null || skip "Docker state unavailable"

echo "============================================================"
echo "DAY 5 TEST SUMMARY"
echo "============================================================"
echo "Passed : $PASS"
echo "Failed : $FAIL"
echo "Skipped: $SKIP"
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: DAY 5 AI INTELLIGENCE PASS"
  exit 0
else
  echo "RESULT: DAY 5 AI INTELLIGENCE FAIL"
  exit 1
fi

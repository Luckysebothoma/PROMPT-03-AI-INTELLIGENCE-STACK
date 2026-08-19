#!/usr/bin/env bash
# ============================================================
# DAY 5 - AI INTELLIGENCE STACK TEST HARNESS
# ============================================================
#
# Purpose:
#   Test Stack 5 as an intelligence/orchestration layer:
#   infrastructure -> API contracts -> classification ->
#   capability resolution -> registry consistency ->
#   negative/error handling -> integrations -> end-to-end chat.
#
# Usage:
#   chmod +x scripts/day5-testing-v2.sh
#   ./scripts/day5-testing-v2.sh
#
# Optional:
#   DAY5_URL=http://localhost:4407
#   DAY3_URL=http://192.168.0.140:4405
#   DAY4_URL=http://127.0.0.1:4406
#   RUN_LIVE=1 ./scripts/day5-testing-v2.sh
#
# This script deliberately does NOT require provider API keys for
# contract/routing tests. Live execution is separated and optional.
# ============================================================

set -uo pipefail

BASE_URL="${DAY5_URL:-http://localhost:4407}"
DAY3_URL="${DAY3_URL:-http://192.168.0.140:4405}"
DAY4_URL="${DAY4_URL:-http://127.0.0.1:4406}"
RUN_LIVE="${RUN_LIVE:-0}"
TIMEOUT="${DAY5_TEST_TIMEOUT:-15}"

PASS=0
FAIL=0
SKIP=0
TOTAL=0
TMP_DIR="$(mktemp -d /tmp/day5-test.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

pass() { PASS=$((PASS+1)); TOTAL=$((TOTAL+1)); echo "[PASS] $1"; }
fail() { FAIL=$((FAIL+1)); TOTAL=$((TOTAL+1)); echo "[FAIL] $1"; }
skip() { SKIP=$((SKIP+1)); TOTAL=$((TOTAL+1)); echo "[SKIP] $1"; }
info() { echo "[INFO] $1"; }

die() {
  echo "[FATAL] $1"
  exit 2
}

need() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "$1 available"
    return 0
  fi
  fail "$1 is required"
  return 1
}

# ------------------------------------------------------------
# HTTP helpers
# ------------------------------------------------------------

HTTP_STATUS=""
HTTP_BODY=""

request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local out="$TMP_DIR/response.json"
  local status

  if [ -n "$payload" ]; then
    status="$(curl -sS --max-time "$TIMEOUT" \
      -o "$out" -w '%{http_code}' \
      -X "$method" "$BASE_URL$path" \
      -H 'Content-Type: application/json' \
      -d "$payload" 2>/dev/null || true)"
  else
    status="$(curl -sS --max-time "$TIMEOUT" \
      -o "$out" -w '%{http_code}' \
      -X "$method" "$BASE_URL$path" 2>/dev/null || true)"
  fi

  HTTP_STATUS="$status"
  HTTP_BODY="$(cat "$out" 2>/dev/null || true)"
}

json_is_valid() {
  echo "$1" | jq -e . >/dev/null 2>&1
}

json_get() {
  local expr="$1"
  echo "$2" | jq -r "$expr" 2>/dev/null
}

assert_http_json() {
  local name="$1"
  local expected="$2"
  if [ "$HTTP_STATUS" = "$expected" ] && json_is_valid "$HTTP_BODY"; then
    pass "$name (HTTP $HTTP_STATUS, valid JSON)"
    return 0
  fi
  fail "$name (HTTP $HTTP_STATUS, invalid/unexpected response: $HTTP_BODY)"
  return 1
}

assert_json_true() {
  local name="$1"
  local body="$2"
  if echo "$body" | jq -e '.success == true' >/dev/null 2>&1; then
    pass "$name"
    return 0
  fi
  fail "$name: $body"
  return 1
}

assert_field() {
  local name="$1"
  local body="$2"
  local expr="$3"
  if echo "$body" | jq -e "$expr" >/dev/null 2>&1; then
    pass "$name"
    return 0
  fi
  fail "$name: $body"
  return 1
}

# ------------------------------------------------------------
# Header
# ------------------------------------------------------------

echo "============================================================"
echo "DAY 5 AI INTELLIGENCE STACK TEST"
echo "Started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Target  : $BASE_URL"
echo "Day 3   : $DAY3_URL"
echo "Day 4   : $DAY4_URL"
echo "Live AI : $RUN_LIVE"
echo "============================================================"

# ============================================================
# 1. TOOLING / RUNTIME
# ============================================================

echo
echo "------------------------------------------------------------"
echo "1. TOOLING / RUNTIME"
echo "------------------------------------------------------------"

need curl || true
need jq || true

if command -v docker >/dev/null 2>&1; then
  pass "docker available"
  if docker info >/dev/null 2>&1; then
    pass "Docker daemon reachable"
  else
    skip "Docker daemon not reachable"
  fi
else
  skip "docker not installed"
fi

# ============================================================
# 2. HEALTH / READINESS / DEPENDENCIES
# ============================================================

echo
echo "------------------------------------------------------------"
echo "2. HEALTH / READINESS / DEPENDENCIES"
echo "------------------------------------------------------------"

request GET /health
assert_http_json "GET /health" 200
assert_field "/health reports ai-gateway-day5" "$HTTP_BODY" '.service == "ai-gateway-day5"'

request GET /ready
assert_http_json "GET /ready" 200
assert_field "/ready confirms PostgreSQL" "$HTTP_BODY" '.postgres == true'

READY_JSON="$HTTP_BODY"

request GET /dependencies
assert_http_json "GET /dependencies" 200
assert_field "/dependencies reports PostgreSQL" "$HTTP_BODY" '.postgres == true'

DEPS_JSON="$HTTP_BODY"

request GET /help
assert_http_json "GET /help" 200
assert_field "/help exposes /v1/chat" "$HTTP_BODY" '.endpoints | index("POST /v1/chat") != null'
assert_field "/help exposes /v1/classify" "$HTTP_BODY" '.endpoints | index("POST /v1/classify") != null'
assert_field "/help exposes /v1/resolve" "$HTTP_BODY" '.endpoints | index("POST /v1/resolve") != null'
assert_field "/help exposes /v1/execute" "$HTTP_BODY" '.endpoints | index("POST /v1/execute") != null'

# ============================================================
# 3. REGISTRY CONTRACTS
# ============================================================

echo
echo "------------------------------------------------------------"
echo "3. REGISTRY CONTRACTS"
echo "------------------------------------------------------------"

request GET /v1/providers
assert_http_json "GET /v1/providers" 200
assert_json_true "Provider registry success=true" "$HTTP_BODY"
assert_field "Groq provider registered" "$HTTP_BODY" '.providers | map(.id) | index("groq") != null'
assert_field "Gemini provider registered" "$HTTP_BODY" '.providers | map(.id) | index("gemini") != null'
assert_field "Provider priority exists" "$HTTP_BODY" 'all(.providers[]; has("priority"))'
PROVIDERS_JSON="$HTTP_BODY"

request GET /v1/models
assert_http_json "GET /v1/models" 200
assert_json_true "Model registry success=true" "$HTTP_BODY"
assert_field "Model lifecycle exists" "$HTTP_BODY" 'all(.models[]; has("lifecycle"))'
assert_field "At least one selectable model" "$HTTP_BODY" 'any(.models[]; .enabled == true and (.lifecycle == "stable" or .lifecycle == "preview"))'
assert_field "Groq gpt-oss-120b is registered" "$HTTP_BODY" 'any(.models[]; .provider=="groq" and .model=="openai/gpt-oss-120b")'
assert_field "Groq gpt-oss-20b is registered" "$HTTP_BODY" 'any(.models[]; .provider=="groq" and .model=="openai/gpt-oss-20b")'
assert_field "Gemini 2.5 Flash is registered" "$HTTP_BODY" 'any(.models[]; .provider=="gemini" and .model=="gemini-2.5-flash")'
MODELS_JSON="$HTTP_BODY"

request GET /v1/workers
assert_http_json "GET /v1/workers" 200
assert_json_true "Worker registry success=true" "$HTTP_BODY"
for worker in intent-classifier chat-worker vision-worker code-worker reasoning-worker summarization-worker extraction-worker translation-worker response-validator; do
  assert_field "Worker registered: $worker" "$HTTP_BODY" ".workers | any(.id == \"$worker\")"
done
WORKERS_JSON="$HTTP_BODY"

request GET /v1/capabilities
assert_http_json "GET /v1/capabilities" 200
assert_json_true "Capability registry success=true" "$HTTP_BODY"
for capability in chat vision code reasoning summarization extraction translation; do
  assert_field "Capability registered: $capability" "$HTTP_BODY" ".capabilities | index(\"$capability\") != null"
done
CAPS_JSON="$HTTP_BODY"

# ============================================================
# 4. CLASSIFICATION CONTRACT + SEMANTIC TESTS
# ============================================================

echo
echo "------------------------------------------------------------"
echo "4. CLASSIFICATION / INTELLIGENCE"
echo "------------------------------------------------------------"

run_classify() {
  local label="$1"
  local message="$2"
  local expected_intent="$3"
  local expected_capability="$4"

  request POST /v1/classify "$(jq -nc --arg m "$message" '{message:$m}')"

  if [ "$HTTP_STATUS" != "200" ] || ! json_is_valid "$HTTP_BODY"; then
    fail "$label classification HTTP/JSON contract"
    echo "       response: $HTTP_BODY"
    return
  fi
  pass "$label classification HTTP/JSON contract"

  assert_field "$label intent=$expected_intent" "$HTTP_BODY" ".intent == \"$expected_intent\""
  assert_field "$label capability=$expected_capability" "$HTTP_BODY" ".capabilities | index(\"$expected_capability\") != null"
  assert_field "$label confidence is numeric 0..1" "$HTTP_BODY" '.confidence | type == "number" and . >= 0 and . <= 1'
  assert_field "$label has worker/provider/model" "$HTTP_BODY" '(.worker | type=="string" and length>0) and (.provider | type=="string" and length>0) and (.model | type=="string" and length>0)'
  assert_field "$label has request_id and trace_id" "$HTTP_BODY" '(.request_id | type=="string" and length>0) and (.trace_id | type=="string" and length>0)'
}

run_classify "chat" \
  "Hello, how are you today?" \
  "chat" "chat"

run_classify "vision" \
  "Identify what is contained in this image." \
  "vision" "vision"

run_classify "code" \
  "Write a bash script that checks Docker containers." \
  "code" "code"

run_classify "reasoning" \
  "Solve this problem and explain the reasoning step by step." \
  "reasoning" "reasoning"

run_classify "summarization" \
  "Summarize the following report into five bullet points." \
  "summarization" "summarization"

run_classify "translation" \
  "Translate this sentence into Spanish." \
  "translation" "translation"

run_classify "extraction" \
  "Extract the names and dates from this document." \
  "extraction" "extraction"

# Negative classify contract
request POST /v1/classify '{}'
assert_http_json "Classify missing message rejected" 400
assert_field "Classify missing message uses INVALID_REQUEST" "$HTTP_BODY" '.error.code == "INVALID_REQUEST"'

# ============================================================
# 5. RESOLUTION / ROUTING
# ============================================================

echo
echo "------------------------------------------------------------"
echo "5. CAPABILITY -> WORKER -> PROVIDER -> MODEL ROUTING"
echo "------------------------------------------------------------"

run_resolve() {
  local capability="$1"
  local expected_worker="$2"
  local expected_provider="$3"
  local expected_model="$4"

  request POST /v1/resolve "$(jq -nc --arg c "$capability" '{capability:$c}')"

  if [ "$HTTP_STATUS" != "200" ] || ! json_is_valid "$HTTP_BODY"; then
    fail "$capability resolution HTTP/JSON contract"
    echo "       response: $HTTP_BODY"
    return
  fi
  pass "$capability resolution HTTP/JSON contract"
  assert_json_true "$capability resolution success=true" "$HTTP_BODY"
  assert_field "$capability -> worker $expected_worker" "$HTTP_BODY" ".worker == \"$expected_worker\""
  assert_field "$capability -> provider $expected_provider" "$HTTP_BODY" ".provider == \"$expected_provider\""
  assert_field "$capability -> model $expected_model" "$HTTP_BODY" ".model == \"$expected_model\""
  assert_field "$capability -> priority numeric" "$HTTP_BODY" '.priority | type=="number"'
}

run_resolve "chat" "chat-worker" "groq" "openai/gpt-oss-120b"
run_resolve "vision" "vision-worker" "gemini" "gemini-2.5-flash"
run_resolve "code" "code-worker" "groq" "openai/gpt-oss-120b"
run_resolve "reasoning" "reasoning-worker" "gemini" "gemini-2.5-flash"
run_resolve "summarization" "summarization-worker" "gemini" "gemini-2.5-flash"
run_resolve "extraction" "extraction-worker" "gemini" "gemini-2.5-flash"
run_resolve "translation" "translation-worker" "gemini" "gemini-2.5-flash"

# Unknown capability
request POST /v1/resolve '{"capability":"nonexistent-capability-xyz"}'
if [ "$HTTP_STATUS" = "404" ]; then
  pass "Unknown capability returns HTTP 404"
else
  fail "Unknown capability expected HTTP 404, got $HTTP_STATUS"
fi
assert_field "Unknown capability has normalized error code" "$HTTP_BODY" '.error.code == "WORKER_UNAVAILABLE" or .error.code == "NO_CAPABLE_MODEL"'
assert_field "Unknown capability has retryable flag" "$HTTP_BODY" '.error | has("retryable")'

# Missing capability
request POST /v1/resolve '{}'
assert_http_json "Resolve missing capability rejected" 400
assert_field "Resolve missing capability uses INVALID_REQUEST" "$HTTP_BODY" '.error.code == "INVALID_REQUEST"'

# ============================================================
# 6. REGISTRY / ROUTER CONSISTENCY
# ============================================================

echo
echo "------------------------------------------------------------"
echo "6. REGISTRY / ROUTER CONSISTENCY"
echo "------------------------------------------------------------"

# For every capability above, verify resolved worker points to the same
# provider/model relationship exposed by the worker registry.
check_worker_consistency() {
  local worker="$1"
  local provider="$2"
  local model="$3"

  local row
  row="$(echo "$WORKERS_JSON" | jq -c --arg w "$worker" '.workers[] | select(.id==$w)' 2>/dev/null || true)"

  if [ -z "$row" ]; then
    fail "Worker consistency: $worker exists in workers registry"
    return
  fi
  pass "Worker consistency: $worker exists in workers registry"
  assert_field "Worker $worker provider matches $provider" "$row" ".provider == \"$provider\""
  assert_field "Worker $worker model matches $model" "$row" ".model == \"$model\""
  assert_field "Worker $worker enabled/active" "$row" '.enabled == true and .status == "active"'
}

check_worker_consistency "chat-worker" "groq" "openai/gpt-oss-120b"
check_worker_consistency "vision-worker" "gemini" "gemini-2.5-flash"
check_worker_consistency "code-worker" "groq" "openai/gpt-oss-120b"
check_worker_consistency "reasoning-worker" "gemini" "gemini-2.5-flash"
check_worker_consistency "summarization-worker" "gemini" "gemini-2.5-flash"
check_worker_consistency "extraction-worker" "gemini" "gemini-2.5-flash"
check_worker_consistency "translation-worker" "gemini" "gemini-2.5-flash"

# Verify every worker's configured model exists in the model registry.
assert_field "Every active worker points to a registered model" "$WORKERS_JSON" '
  all(.workers[] | select(.enabled == true);
    . as $w |
    $models.models | any(.provider == $w.provider and .model == $w.model)
  )
' 2>/dev/null || true

# The previous assertion needs MODELS_JSON as a jq variable; run it explicitly.
if echo "$WORKERS_JSON" | jq -e --argjson models "$MODELS_JSON" '
  all(.workers[] | select(.enabled == true);
    . as $w |
    $models.models | any(.provider == $w.provider and .model == $w.model)
  )
' >/dev/null 2>&1; then
  pass "Every active worker points to a registered model"
else
  fail "At least one active worker points to a missing model"
fi

# Verify stable enabled models are selectable according to their registry shape.
if echo "$MODELS_JSON" | jq -e '
  all(.models[] | select(.enabled == true and .lifecycle == "stable");
    (.provider | length > 0) and (.model | length > 0) and (.capabilities | length > 0)
  )
' >/dev/null 2>&1; then
  pass "Stable enabled models have complete routing metadata"
else
  fail "Stable enabled model has incomplete routing metadata"
fi

# ============================================================
# 7. NEGATIVE / SAFETY / DEPTH CONTRACTS
# ============================================================

echo
echo "------------------------------------------------------------"
echo "7. NEGATIVE / ERROR / SAFETY TESTS"
echo "------------------------------------------------------------"

request POST /v1/chat '{}'
assert_http_json "Chat missing message rejected" 400
assert_field "Chat missing message uses INVALID_REQUEST" "$HTTP_BODY" '.error.code == "INVALID_REQUEST"'
assert_field "Chat invalid request includes retryable" "$HTTP_BODY" '.error | has("retryable")'

request POST /v1/chat '{"message":"hello","depth":999}'
if [ "$HTTP_STATUS" = "429" ]; then
  pass "Orchestration depth protection returns HTTP 429"
else
  fail "Orchestration depth protection expected 429, got $HTTP_STATUS"
fi
assert_field "Depth protection uses MAX_ORCHESTRATION_DEPTH" "$HTTP_BODY" '.error.code == "MAX_ORCHESTRATION_DEPTH"'
assert_field "Depth error exposes depth/max_depth" "$HTTP_BODY" '.error.depth != null and .error.max_depth != null'

request POST /v1/execute '{}'
assert_http_json "Execute missing messages rejected" 400
assert_field "Execute invalid request uses INVALID_REQUEST" "$HTTP_BODY" '.error.code == "INVALID_REQUEST"'

request GET /v1/providers/does-not-exist
if [ "$HTTP_STATUS" = "404" ]; then
  pass "Unknown provider returns HTTP 404"
else
  fail "Unknown provider expected HTTP 404, got $HTTP_STATUS"
fi
assert_field "Unknown provider uses PROVIDER_UNAVAILABLE" "$HTTP_BODY" '.error.code == "PROVIDER_UNAVAILABLE"'

request GET /v1/models/does-not-exist
if [ "$HTTP_STATUS" = "404" ]; then
  pass "Unknown model returns HTTP 404"
else
  fail "Unknown model expected HTTP 404, got $HTTP_STATUS"
fi
assert_field "Unknown model uses MODEL_NOT_FOUND" "$HTTP_BODY" '.error.code == "MODEL_NOT_FOUND"'

request GET /v1/workers/does-not-exist
if [ "$HTTP_STATUS" = "404" ]; then
  pass "Unknown worker returns HTTP 404"
else
  fail "Unknown worker expected HTTP 404, got $HTTP_STATUS"
fi
assert_field "Unknown worker uses WORKER_UNAVAILABLE" "$HTTP_BODY" '.error.code == "WORKER_UNAVAILABLE"'

# ============================================================
# 8. METRICS
# ============================================================

echo
echo "------------------------------------------------------------"
echo "8. OBSERVABILITY / METRICS"
echo "------------------------------------------------------------"

request GET /metrics
if [ "$HTTP_STATUS" = "200" ]; then
  pass "Prometheus /metrics returns HTTP 200"
else
  fail "Prometheus /metrics expected 200, got $HTTP_STATUS"
fi

METRICS="$HTTP_BODY"
for metric in chat_requests_total classification_requests_total resolution_requests_total execution_requests_total normalized_errors_total; do
  if echo "$METRICS" | grep -q "^${metric}"; then
    pass "Metric exposed: $metric"
  else
    fail "Metric missing: $metric"
  fi
done

# ============================================================
# 9. DEPENDENCY INTEGRATION
# ============================================================

echo
echo "------------------------------------------------------------"
echo "9. DAY 3 / DAY 4 INTEGRATION"
echo "------------------------------------------------------------"

DAY4_STATUS="$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$DAY4_URL/health" 2>/dev/null || true)"
if [ "$DAY4_STATUS" = "200" ]; then
  pass "Day 4 /health reachable"
else
  skip "Day 4 /health unavailable (HTTP $DAY4_STATUS)"
fi

DAY3_STATUS="$(curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$DAY3_URL/health" 2>/dev/null || true)"
if [ "$DAY3_STATUS" = "200" ]; then
  pass "Day 3 /health reachable"
else
  skip "Day 3 /health unavailable (HTTP $DAY3_STATUS)"
fi

if echo "$DEPS_JSON" | jq -e '.day3.available == true' >/dev/null 2>&1; then
  pass "Day 5 dependency diagnostics reports Day 3 available"
else
  skip "Day 5 dependency diagnostics reports Day 3 unavailable"
fi

if echo "$DEPS_JSON" | jq -e '.day4.available == true' >/dev/null 2>&1; then
  pass "Day 5 dependency diagnostics reports Day 4 available"
else
  skip "Day 5 dependency diagnostics reports Day 4 unavailable"
fi

# ============================================================
# 10. END-TO-END /v1/chat
# ============================================================

echo
echo "------------------------------------------------------------"
echo "10. END-TO-END /v1/chat"
echo "------------------------------------------------------------"

SESSION_ID="day5-test-$(date +%s)-$$"

request POST /v1/chat "$(jq -nc \
  --arg m "Hello, my name is Day5Test and I am testing the AI Intelligence Stack." \
  --arg s "$SESSION_ID" \
  '{message:$m,session_id:$s}')"

if [ "$HTTP_STATUS" = "200" ] && echo "$HTTP_BODY" | jq -e '.success == true' >/dev/null 2>&1; then
  pass "End-to-end /v1/chat succeeded"
  assert_field "Chat response has request_id" "$HTTP_BODY" '.request_id | type=="string" and length>0'
  assert_field "Chat response has trace_id" "$HTTP_BODY" '.trace_id | type=="string" and length>0'
  assert_field "Chat response has session_id" "$HTTP_BODY" '.session_id | type=="string" and length>0'
  assert_field "Chat response has intent/task" "$HTTP_BODY" '(.intent | type=="string" and length>0) and (.task | type=="string" and length>0)'
  assert_field "Chat response has worker/provider/model" "$HTTP_BODY" '(.worker | type=="string" and length>0) and (.provider | type=="string" and length>0) and (.model | type=="string" and length>0)'
  assert_field "Chat response has non-empty response" "$HTTP_BODY" '.response | type=="string" and length>0'
else
  # A 502 is still a meaningful integration result: it proves the
  # request reached the execution boundary but the downstream path failed.
  if [ "$HTTP_STATUS" = "502" ]; then
    fail "End-to-end /v1/chat reached execution but failed: $(echo "$HTTP_BODY" | jq -c '.error' 2>/dev/null || echo "$HTTP_BODY")"
  else
    fail "End-to-end /v1/chat failed with HTTP $HTTP_STATUS: $HTTP_BODY"
  fi
fi

CHAT_JSON="$HTTP_BODY"

# ============================================================
# 11. OPTIONAL LIVE PROVIDER TEST
# ============================================================

echo
echo "------------------------------------------------------------"
echo "11. OPTIONAL LIVE PROVIDER TEST"
echo "------------------------------------------------------------"

if [ "$RUN_LIVE" != "1" ]; then
  skip "Live provider execution disabled (set RUN_LIVE=1)"
else
  if [ -z "${GROQ_API_KEY_1:-}" ] && [ -z "${GROQ_API_KEY_2:-}" ] &&
     [ -z "${GEMINI_API_KEY_1:-}" ] && [ -z "${GEMINI_API_KEY_2:-}" ]; then
    skip "No configured live provider key variables exported to test shell"
  else
    if [ "$HTTP_STATUS" = "200" ] && echo "$CHAT_JSON" | jq -e '.success == true' >/dev/null 2>&1; then
      pass "Live provider execution observed through /v1/chat"
    else
      fail "Live provider execution did not produce a successful /v1/chat response"
    fi
  fi
fi

# ============================================================
# 12. FINAL STATE
# ============================================================

echo
echo "------------------------------------------------------------"
echo "FINAL DOCKER STATE"
echo "------------------------------------------------------------"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker ps --filter "name=ai-gateway-day5" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true
fi

echo
echo "============================================================"
echo "DAY 5 TEST SUMMARY"
echo "============================================================"
echo "Passed : $PASS"
echo "Failed : $FAIL"
echo "Skipped: $SKIP"
echo "Total  : $TOTAL"
echo

if [ "$FAIL" -eq 0 ]; then
  echo "RESULT: DAY 5 AI INTELLIGENCE PASS"
  exit 0
else
  echo "RESULT: DAY 5 AI INTELLIGENCE FAIL"
  exit 1
fi

#!/usr/bin/env bash
set -uo pipefail

# ==============================================================================
# DAY 5 — REAL-WORLD CHAT SIMULATION
#
# Sends realistic, multi-turn conversations through POST /v1/chat exactly as
# a human client would (no synthetic capability/session params), covering
# chat, context recall, code, summarization, translation, reasoning, and
# error-path phrasing. Safe to run repeatedly — each scenario uses its own
# session_id.
# ==============================================================================

BASE_URL="${DAY5_URL:-http://192.168.0.140:4407}"
HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

TOTAL=0
PASSED=0
FAILED=0

_log()  { echo -e "\033[1;36m[CHAT]\033[0m $*"; }
_pass() { echo -e "\033[1;32m[PASS]\033[0m $*"; }
_fail() { echo -e "\033[1;31m[FAIL]\033[0m $*" >&2; }
_info() { echo -e "\033[1;90m[INFO]\033[0m $*"; }

jget() {
  # jget <json> <field> — reads a top-level field from a flat-ish JSON response.
  if [ "$HAVE_JQ" -eq 1 ]; then
    echo "$1" | jq -r ".$2 // empty" 2>/dev/null
    return
  fi
  # Fallback (no jq): handle both quoted-string values and bare literals
  # (true/false/numbers), since fields like "success" are booleans.
  local out
  out=$(echo "$1" | grep -o "\"$2\":\"[^\"]*\"" | head -1 | sed -E "s/\"$2\":\"([^\"]*)\"/\1/")
  if [ -z "$out" ]; then
    out=$(echo "$1" | grep -o "\"$2\":[a-zA-Z0-9.\-]*" | head -1 | sed -E "s/\"$2\"://")
  fi
  echo "$out"
}

# Sends one chat turn, returns the raw JSON response, prints latency.
send_turn() {
  local session_id="$1"
  local message="$2"
  local start end ms resp http_code tmp

  tmp=$(mktemp)
  start=$(date +%s%3N 2>/dev/null || date +%s000)
  http_code=$(curl -sS -o "$tmp" -w '%{http_code}' \
    --connect-timeout 5 --max-time 60 \
    -X POST "${BASE_URL}/v1/chat" \
    -H "Content-Type: application/json" \
    -d "$(printf '{"message":%s,"session_id":"%s"}' "$(json_str "$message")" "$session_id")")
  end=$(date +%s%3N 2>/dev/null || date +%s000)
  ms=$((end - start))
  resp=$(cat "$tmp"); rm -f "$tmp"

  _info "  > \"$message\""
  _info "  < HTTP $http_code (${ms}ms) $(echo "$resp" | cut -c1-220)"
  echo "$resp"
  return 0
}

json_str() {
  # crude but sufficient JSON string escaper for test payloads
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  printf '"%s"' "$s"
}

assert_chat_ok() {
  local resp="$1"
  local success text
  success=$(jget "$resp" success)
  text=$(jget "$resp" response)
  [ "$success" = "true" ] && [ -n "$text" ]
}

scenario() {
  local title="$1"
  TOTAL=$((TOTAL + 1))
  echo
  _log "=== SCENARIO: $title ==="
}

record_result() {
  local title="$1"
  local ok="$2"
  if [ "$ok" = "0" ]; then
    PASSED=$((PASSED + 1))
    _pass "$title"
  else
    FAILED=$((FAILED + 1))
    _fail "$title"
  fi
}

echo "============================================================"
echo " DAY 5 — REAL-WORLD CHAT SIMULATION"
echo "============================================================"
echo "Target: ${BASE_URL}"

# ------------------------------------------------------------------
# 1. Casual small talk
# ------------------------------------------------------------------
scenario "Casual small talk"
SID="chatsim-smalltalk-$$"
r=$(send_turn "$SID" "Hey! How's it going?")
assert_chat_ok "$r"; record_result "Casual small talk" $?

# ------------------------------------------------------------------
# 2. Multi-turn context recall (name + tool, like the spec's example)
# ------------------------------------------------------------------
scenario "Context recall across turns"
SID="chatsim-context-$$"
send_turn "$SID" "My name is Mimo." >/dev/null
send_turn "$SID" "I use n8n for orchestration." >/dev/null
r=$(send_turn "$SID" "What is my name and what do I use for orchestration?")
text=$(jget "$r" response)
ok=1
if echo "$text" | grep -qi "mimo" && echo "$text" | grep -qi "n8n"; then ok=0; fi
record_result "Context recall across turns" $ok
[ "$ok" -ne 0 ] && _info "  (context may be degraded if Day 4 is offline — check context_degraded flag)"

# ------------------------------------------------------------------
# 3. Coding help, then a natural follow-up referencing prior code
# ------------------------------------------------------------------
scenario "Coding help with follow-up"
SID="chatsim-code-$$"
r1=$(send_turn "$SID" "Can you write a Python function that reverses a string?")
ok1=1; assert_chat_ok "$r1" && ok1=0
r2=$(send_turn "$SID" "Nice — now make it handle unicode/emoji correctly.")
ok2=1; assert_chat_ok "$r2" && ok2=0
ok=$(( ok1 + ok2 > 0 ? 1 : 0 ))
record_result "Coding help with follow-up" $ok

# ------------------------------------------------------------------
# 4. Summarization of pasted text
# ------------------------------------------------------------------
scenario "Summarization"
SID="chatsim-summary-$$"
LONG_TEXT="Our quarterly report shows revenue grew 12 percent year over year, driven mainly by strong demand in the APAC region. Operating costs rose slightly due to increased hiring in engineering. Customer churn dropped to its lowest level in two years, and the team plans to launch two new product lines next quarter. Leadership expressed cautious optimism about the macro environment heading into next year."
r=$(send_turn "$SID" "Summarize this in one sentence: ${LONG_TEXT}")
assert_chat_ok "$r"; record_result "Summarization" $?

# ------------------------------------------------------------------
# 5. Translation request
# ------------------------------------------------------------------
scenario "Translation"
SID="chatsim-translate-$$"
r=$(send_turn "$SID" "How do you say 'Where is the nearest train station?' in Spanish?")
assert_chat_ok "$r"; record_result "Translation" $?

# ------------------------------------------------------------------
# 6. Reasoning / word problem
# ------------------------------------------------------------------
scenario "Reasoning"
SID="chatsim-reasoning-$$"
r=$(send_turn "$SID" "If a train travels at 60 mph for 2.5 hours, how far does it go, and show your reasoning briefly.")
assert_chat_ok "$r"; record_result "Reasoning" $?

# ------------------------------------------------------------------
# 7. Vision-flavored phrasing (no actual image — checks intent routing
#    on natural language, not that image bytes are processed)
# ------------------------------------------------------------------
scenario "Vision-flavored request"
SID="chatsim-vision-$$"
r=$(send_turn "$SID" "I'm about to upload a photo — can you identify what's in it?")
provider=$(jget "$r" provider)
ok=1; assert_chat_ok "$r" && ok=0
record_result "Vision-flavored request" $ok
_info "  routed provider: ${provider:-unknown}"

# ------------------------------------------------------------------
# 8. Rapid back-and-forth (latency / stability under quick turns)
# ------------------------------------------------------------------
scenario "Rapid back-and-forth"
SID="chatsim-rapid-$$"
ok=0
for msg in "hi" "what can you do?" "give me one fun fact" "thanks, bye!"; do
  r=$(send_turn "$SID" "$msg")
  assert_chat_ok "$r" || ok=1
done
record_result "Rapid back-and-forth (4 turns)" $ok

# ------------------------------------------------------------------
# 9. Edge case: empty-ish / low-signal message (should still succeed
#    or fail gracefully with a normalized error, never a raw 500)
# ------------------------------------------------------------------
scenario "Low-signal message handled gracefully"
SID="chatsim-edge-$$"
tmp=$(mktemp)
http_code=$(curl -sS -o "$tmp" -w '%{http_code}' --connect-timeout 5 --max-time 30 \
  -X POST "${BASE_URL}/v1/chat" -H "Content-Type: application/json" \
  -d "{\"message\":\"...\",\"session_id\":\"$SID\"}")
resp=$(cat "$tmp"); rm -f "$tmp"
_info "  > \"...\""
_info "  < HTTP $http_code $(echo "$resp" | cut -c1-200)"
ok=1
[ "$http_code" -lt 500 ] && ok=0
record_result "Low-signal message handled gracefully (no 5xx crash)" $ok

# ------------------------------------------------------------------
# 10. Long, rambling real-world message (stress the classifier)
# ------------------------------------------------------------------
scenario "Long rambling real-world message"
SID="chatsim-long-$$"
r=$(send_turn "$SID" "okay so basically I've been trying to figure out for like the past hour why my node server keeps crashing when I deploy it, I think it might be a memory leak but honestly I'm not sure, could you help me think through how I'd even start debugging something like that in production without just restarting it constantly")
assert_chat_ok "$r"; record_result "Long rambling real-world message" $?

echo
echo "============================================================"
echo " CHAT SIMULATION SUMMARY"
echo "============================================================"
echo "Total : ${TOTAL}"
echo "Passed: ${PASSED}"
echo "Failed: ${FAILED}"
echo

if [ "$FAILED" -eq 0 ]; then
  _pass "DAY 5 CHAT SIMULATION PASSED"
  exit 0
else
  _fail "DAY 5 CHAT SIMULATION HAS ${FAILED} FAILED SCENARIO(S)"
  exit 1
fi

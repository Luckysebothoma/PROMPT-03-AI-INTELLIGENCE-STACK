#!/usr/bin/env bash
# apply-day5-fix.sh
#
# Fixes the Day 5 extractText() bug: Stack 3's /v1/execute returns the
# completion text in a top-level "response" field, but Day 5's text
# extractors only checked "choices[0].message.content" / "content", so
# they always got an empty string and every chat request failed
# RESPONSE_VALIDATION_FAILED with a 502.
#
# This script does NOT use `diff`/`patch`/`git apply` — it edits the two
# files directly with an exact string match, so copy/paste whitespace
# issues can't break it. If it can't find the exact text it expects, it
# stops and changes nothing.
#
# Run this from the PROMPT-03-AI-INTELLIGENCE-STACK repo root (the folder
# that contains docker-compose.yml and src/).

set -euo pipefail

CLASSIFIER_FILE="src/classifier.js"
ROUTES_FILE="src/routes.js"

fail() { echo "[ERROR] $*" >&2; exit 1; }
info() { echo "[INFO] $*"; }
ok()   { echo "[OK] $*"; }

# ---------------------------------------------------------------------
# 0. Sanity checks
# ---------------------------------------------------------------------
[ -f "docker-compose.yml" ] || fail "docker-compose.yml not found here. Run this from the repo root (PROMPT-03-AI-INTELLIGENCE-STACK)."
[ -f "$CLASSIFIER_FILE" ] || fail "$CLASSIFIER_FILE not found."
[ -f "$ROUTES_FILE" ] || fail "$ROUTES_FILE not found."
command -v node >/dev/null 2>&1 || fail "node is required (used for safe text replacement and syntax check) but was not found on PATH."

# ---------------------------------------------------------------------
# 1. Backups (timestamped, never overwritten)
# ---------------------------------------------------------------------
STAMP=$(date +%Y%m%d-%H%M%S)
cp "$CLASSIFIER_FILE" "${CLASSIFIER_FILE}.pre-fix-${STAMP}"
cp "$ROUTES_FILE" "${ROUTES_FILE}.pre-fix-${STAMP}"
ok "Backed up originals to ${CLASSIFIER_FILE}.pre-fix-${STAMP} and ${ROUTES_FILE}.pre-fix-${STAMP}"

# ---------------------------------------------------------------------
# 2. Apply the two edits via Node (exact-match, fails loudly, idempotent)
# ---------------------------------------------------------------------
node <<'NODE_EOF'
const fs = require('fs');

function patchFile(path, oldStr, newStr, alreadyDoneMarker) {
  const src = fs.readFileSync(path, 'utf8');

  if (src.includes(alreadyDoneMarker)) {
    console.log(`[SKIP] ${path} already contains the fix — leaving it untouched.`);
    return;
  }

  const count = src.split(oldStr).length - 1;
  if (count === 0) {
    console.error(`[ERROR] Could not find the expected original text in ${path}.`);
    console.error(`        The file may already differ from what this script expects.`);
    console.error(`        No changes were made to this file. Please check it manually.`);
    process.exit(1);
  }
  if (count > 1) {
    console.error(`[ERROR] Found the expected text ${count} times in ${path} (expected exactly 1).`);
    console.error(`        Refusing to guess which one to change. No changes were made.`);
    process.exit(1);
  }

  fs.writeFileSync(path, src.replace(oldStr, newStr), 'utf8');
  console.log(`[OK] Patched ${path}`);
}

// --- src/classifier.js ---
patchFile(
  'src/classifier.js',
  `  return data?.choices?.[0]?.message?.content || data?.content || '';`,
  `  return data?.response || data?.choices?.[0]?.message?.content || data?.content || '';`,
  `data?.response ||`
);

// --- src/routes.js ---
patchFile(
  'src/routes.js',
  `function extractText(data) {
  // 4. Gemini native format`,
  `function extractText(data) {
  // 1. Stack 3 /v1/execute native contract (the one this gateway actually talks to)
  if (typeof data?.response === 'string' && data.response.trim()) {
    return data.response;
  }

  // 4. Gemini native format`,
  `Stack 3 /v1/execute native contract`
);
NODE_EOF

if [ $? -ne 0 ]; then
  fail "Patching aborted. Your files were NOT modified beyond the backups already taken. See the error above."
fi

# ---------------------------------------------------------------------
# 3. Syntax check before you rebuild anything
# ---------------------------------------------------------------------
node -c "$CLASSIFIER_FILE" || fail "$CLASSIFIER_FILE failed syntax check after patching — restore from the .pre-fix-${STAMP} backup."
node -c "$ROUTES_FILE" || fail "$ROUTES_FILE failed syntax check after patching — restore from the .pre-fix-${STAMP} backup."
ok "Both files passed a Node syntax check."

# ---------------------------------------------------------------------
# 4. Show exactly what changed, for your own eyes
# ---------------------------------------------------------------------
echo
echo "==================== What changed ===================="
diff -u "${CLASSIFIER_FILE}.pre-fix-${STAMP}" "$CLASSIFIER_FILE" || true
diff -u "${ROUTES_FILE}.pre-fix-${STAMP}" "$ROUTES_FILE" || true
echo "========================================================"
echo
ok "Fix applied. Backups are saved next to the originals with a .pre-fix-${STAMP} suffix."
echo
echo "Next steps (not run automatically — run these yourself):"
echo "  docker-compose build day5-app"
echo "  docker-compose up -d day5-app"
echo "  docker-compose logs -f day5-app     # watch for a clean boot"
echo
echo "To roll back if needed:"
echo "  cp ${CLASSIFIER_FILE}.pre-fix-${STAMP} ${CLASSIFIER_FILE}"
echo "  cp ${ROUTES_FILE}.pre-fix-${STAMP} ${ROUTES_FILE}"
echo "  docker-compose build day5-app && docker-compose up -d day5-app"

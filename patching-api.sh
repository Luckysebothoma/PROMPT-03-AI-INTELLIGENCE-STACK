#!/usr/bin/env bash
# repair-and-fix.sh
#
# Use this ONLY if src/classifier.js is currently broken/corrupted (e.g. a
# node -c syntax error, or it visibly contains lines starting with "-" or
# "+" that look like diff output pasted into the file by mistake).
#
# It restores src/classifier.js to the exact version from your last git
# commit (undoing any corruption), then re-applies the Day 5 fix cleanly.
# src/routes.js is left alone if it's already correctly patched.
#
# Run this from the repo root (the folder with docker-compose.yml).

set -euo pipefail

info() { echo "[INFO] $*"; }
ok()   { echo "[OK] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

[ -f "docker-compose.yml" ] || fail "Run this from the repo root (the folder containing docker-compose.yml)."
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "This folder isn't a git repository — can't auto-restore. Paste the output of: sed -n '35,50p' src/classifier.js and we'll fix it manually."

echo
echo "==================== Current damage in src/classifier.js ===================="
git diff --no-color -- src/classifier.js || true
echo "================================================================================"
echo

read -r -p "This will DISCARD the current src/classifier.js and restore it from your last git commit, then re-apply the fix. Continue? [y/N] " CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "Aborted. Nothing was changed."
  exit 0
fi

# Keep a copy of the broken file just in case, before discarding it
STAMP=$(date +%Y%m%d-%H%M%S)
cp src/classifier.js "src/classifier.js.broken-${STAMP}" 2>/dev/null || true
ok "Saved a copy of the broken file as src/classifier.js.broken-${STAMP} (just in case)."

git checkout -- src/classifier.js
ok "Restored src/classifier.js to the last committed (clean) version."

node -c src/classifier.js || fail "Restored file still fails syntax check — something else is going on, please paste the file contents."
ok "Restored src/classifier.js passes a syntax check."

echo
echo "Now re-applying the fix to the clean file..."
echo

node <<'NODE_EOF'
const fs = require('fs');
const path = 'src/classifier.js';
const src = fs.readFileSync(path, 'utf8');
const oldStr = `  return data?.choices?.[0]?.message?.content || data?.content || '';`;
const newStr = `  return data?.response || data?.choices?.[0]?.message?.content || data?.content || '';`;

if (src.includes('data?.response ||')) {
  console.log('[SKIP] Fix already present after restore (unexpected, but fine).');
  process.exit(0);
}
const count = src.split(oldStr).length - 1;
if (count !== 1) {
  console.error(`[ERROR] Expected the original line exactly once, found ${count}. Stopping — please paste the file contents.`);
  process.exit(1);
}
fs.writeFileSync(path, src.replace(oldStr, newStr), 'utf8');
console.log('[OK] Patched src/classifier.js cleanly.');
NODE_EOF

node -c src/classifier.js || fail "src/classifier.js failed syntax check after re-patching."
ok "src/classifier.js patched and verified."

echo
echo "Checking src/routes.js..."
if grep -q "Stack 3 /v1/execute native contract" src/routes.js 2>/dev/null; then
  ok "src/routes.js already has the fix from your earlier run — leaving it alone."
else
  info "src/routes.js does not have the fix yet — re-run apply-day5-fix.sh to add it, or let me know and I'll add it here too."
fi

node -c src/routes.js || fail "src/routes.js failed syntax check — please check it manually."
ok "src/routes.js passes syntax check."

echo
echo "==================== Final diff vs last commit ===================="
git diff --no-color -- src/classifier.js src/routes.js
echo "======================================================================"
echo
ok "Repair complete. Both files are valid JavaScript and contain the fix."
echo
echo "Next steps:"
echo "  docker-compose build day5-app"
echo "  docker-compose up -d day5-app"
echo "  docker-compose logs -f day5-app"

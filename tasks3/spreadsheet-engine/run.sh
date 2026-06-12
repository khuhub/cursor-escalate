#!/usr/bin/env bash
# Runs the spreadsheet-engine escalation eval with cursor-looper.
#
# The task template is copied into a fresh scratch git repo, the looper runs
# its model ladder against it, and the run finishes with an independent
# ground-truth check: pristine tests are restored and `npm test` decides
# pass/fail regardless of what the agent did to the working tree.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
: "${CURSOR_API_KEY:?Set CURSOR_API_KEY (see .env.example) before running the eval}"

LADDER="${LADDER:-composer-2.5,sonnet-4.6,opus-4.8}"
PER_TIER_CAP="${PER_TIER_CAP:-2}"
MAX_ITERATIONS="${MAX_ITERATIONS:-8}"
THRESHOLD="${THRESHOLD:-0.95}"
export LOOPER_STORE_DIR="${LOOPER_STORE_DIR:-$HERE/.runs/loops}"

CLI="$ROOT/packages/cli/dist/index.js"
if [[ ! -f "$CLI" ]]; then
  echo "==> Building @looper/cli"
  if [[ ! -d "$ROOT/node_modules" ]]; then
    (cd "$ROOT" && pnpm install)
  fi
  (cd "$ROOT" && pnpm --filter @looper/cli... build)
fi

echo "==> Resolving model ladder: $LADDER"
node "$CLI" ladder --ladder "$LADDER"

RUN_DIR="$HERE/.runs/run-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RUN_DIR"
cp -R "$HERE/task/." "$RUN_DIR"
git -C "$RUN_DIR" init -q -b main
git -C "$RUN_DIR" config user.email "looper-eval@example.com"
git -C "$RUN_DIR" config user.name "looper-eval"
git -C "$RUN_DIR" add -A
git -C "$RUN_DIR" commit -qm "spreadsheet-engine task baseline"

GOAL="/goal Implement the spreadsheet engine described in GOAL.md so that 'npm test' passes. Do not modify GOAL.md, package.json, or anything under test/; the verifier restores pristine copies of those files before grading. Per-tier suites (test:values, test:arithmetic, test:references, test:functions, test:gauntlet) are useful checkpoints, but the bar is the full suite."

echo "==> Starting loop in $RUN_DIR"
set +e
(cd "$RUN_DIR" && node "$CLI" "$GOAL" \
  --ladder "$LADDER" \
  --per-tier-cap "$PER_TIER_CAP" \
  --max-iterations "$MAX_ITERATIONS" \
  --threshold "$THRESHOLD")
LOOP_EXIT=$?
set -e

echo "==> Ground-truth verification (pristine tests restored)"
rm -rf "$RUN_DIR/test"
cp -R "$HERE/task/test" "$RUN_DIR/test"
cp "$HERE/task/package.json" "$RUN_DIR/package.json"
cp "$HERE/task/GOAL.md" "$RUN_DIR/GOAL.md"

if (cd "$RUN_DIR" && npm test); then
  echo "==> RESULT: PASS (full suite green against pristine tests)"
else
  echo "==> RESULT: FAIL (suite still failing after the loop finished)"
  exit 1
fi

echo "==> Loop artifacts: $LOOPER_STORE_DIR"
echo "==> Working tree:   $RUN_DIR (escalation history: git -C $RUN_DIR log --oneline)"
exit "$LOOP_EXIT"

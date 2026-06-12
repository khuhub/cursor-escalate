#!/usr/bin/env bash
# Proves the test suite is satisfiable: overlays the held-out reference
# solution on a copy of the task template and runs the full suite.
# No API key or network needed; finishes in a couple of seconds.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="$HERE/.runs/verify-solution"

rm -rf "$SCRATCH"
mkdir -p "$SCRATCH"
cp -R "$HERE/task/." "$SCRATCH"
cp "$HERE/solution/spreadsheet.js" "$SCRATCH/src/spreadsheet.js"

cd "$SCRATCH"
npm test
echo "reference solution passes the full suite"

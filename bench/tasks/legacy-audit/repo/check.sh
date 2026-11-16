#!/usr/bin/env bash
# Deterministic scorer for legacy-audit. Exit 0 = task solved.
set -u
cd "$(dirname "$0")"

if ! command -v bun >/dev/null 2>&1; then
  echo "FAIL — bun not available"
  exit 1
fi

out=$(bun test 2>&1)
status=$?

if [ $status -eq 0 ]; then
  echo "PASS"
  exit 0
fi

echo "FAIL — bun test exited $status"
printf '%s\n' "$out" | grep -E '^\((fail|error)\)|fail\)| pass\)| fail\)' | tail -20 | sed 's/^/  /'
exit 1

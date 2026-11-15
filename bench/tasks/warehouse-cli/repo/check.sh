#!/usr/bin/env bash
# Deterministic scorer for warehouse-cli. Exit 0 = task solved.
set -u
cd "$(dirname "$0")"

out=$(bun src/cli.ts report data/inventory.json data/orders.json 2>/dev/null)
want=$(cat expected/report.txt)

if [ "$out" = "$want" ]; then
  echo "PASS"
  exit 0
fi

echo "FAIL — report output differs from expected/report.txt"
diff <(printf '%s\n' "$want") <(printf '%s\n' "$out") | sed 's/^/  /'
exit 1

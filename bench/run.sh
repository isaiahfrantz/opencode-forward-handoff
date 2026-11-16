#!/usr/bin/env bash
# Benchmark runner: compares the harness with vs. without opencode-forward-handoff.
#
# Each (arm, task, rep) runs in an isolated scratch copy of the task repo:
#   - arms are isolated via XDG_CONFIG_HOME (bench/arm-config/<arm>) and a
#     per-arm XDG_DATA_HOME (own opencode.db, own server, own plugin state)
#   - the with-arm gets a hermetic .opencode/handoff.json (primaryLimit) written
#     into its scratch repo; the without-arm gets none
#   - after each agent turn we look for a new "Resumed Handoff (…)" session in
#     the scratch directory (plugin rollover), wait for it to finish its seeded
#     work, then run ./check.sh; on failure we send a bounded number of
#     "continue" nudges to the current (possibly handoff'd) session.
#
# Usage: bench/run.sh [--arm with|without|updated|both] [--tasks "t1 t2"] [--reps N]
#                     [--nudges N] [--limit 28000] [--sublimit 16000]
#                     [--runs-dir DIR]
# "updated" is a plugin-enabled arm like "with" but pinned (in arm-config) to the
# grace-window commit; "with" stays pinned to the original pre-grace commit so
# original-vs-updated comparisons run on identical harness code.
# --sublimit pins subagentLimit in the with-arm's per-repo handoff.json; without
# it, the plugin default (16000) applies (sub-agent handoffs happen quietly and
# the parent handles rollover).
set -uo pipefail

BENCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# CLI resolution: OPENCODE_BIN env > local bench/bin/opencode (untracked, e.g. a
# symlink to a mounted AppImage binary) > opencode on PATH.
BIN="${OPENCODE_BIN:-}"
if [[ -z "$BIN" ]]; then
  if [[ -x "$BENCH_DIR/bin/opencode" ]]; then BIN="$BENCH_DIR/bin/opencode"; else BIN="opencode"; fi
fi
# NOTE: runs must live OUTSIDE any git repo. The plugin resolves config and the
# artifact dir from the session's *worktree*; a scratch copy nested inside a git
# repo would leak worktree detection up to that repo (we'd read/write the wrong
# .opencode/). /tmp/opencode/bench/runs is repo-free by construction.
RUNS_DIR="${RUNS_DIR:-/tmp/opencode/bench/runs}"
ARMS="with without"
TASKS="pricing-engine warehouse-cli"
REPS=1
NUDGES=2
LIMIT=28000
SUBLIMIT=""
MODEL="gufo/qwen3.8-flash-next-v3.1"
TURN_TIMEOUT=1500     # seconds cap per agent turn
IDLE_TIMEOUT=1500     # seconds to wait for a session to go idle
CHILD_GRACE=24        # seconds to wait for the plugin's idle-hook rollover after idle
PORT_WITH=17801
PORT_WITHOUT=17802
PORT_UPDATED=17803
PORT_SUBFIX=17804

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arm)
      case "$2" in
        both) ARMS="with without" ;;
        with|without|updated|subfix) ARMS="$2" ;;
        *) echo "unknown arm: $2 (use with|without|updated|subfix|both)" >&2; exit 2 ;;
      esac
      shift 2 ;;
    --tasks) TASKS="$2"; shift 2 ;;
    --reps) REPS="$2"; shift 2 ;;
    --nudges) NUDGES="$2"; shift 2 ;;
    --limit) LIMIT="$2"; shift 2 ;;
    --sublimit) SUBLIMIT="$2"; shift 2 ;;
    --runs-dir) RUNS_DIR="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

command -v "$BIN" >/dev/null || { echo "missing $BIN" >&2; exit 1; }
mkdir -p "$RUNS_DIR"

PW="bench-$RANDOM$RANDOM"
declare -A SERVER_PID SERVER_PORT SERVER_LOG SERVER_DATA

start_server() { # arm -> sets SERVER_PID[arm], SERVER_PORT[arm], etc.
  local arm=$1 port
  if [[ ! -d "$BENCH_DIR/arm-config/$arm" ]]; then
    echo "invalid arm '$arm': no bench/arm-config/$arm" >&2
    return 2
  fi
  case $arm in
    with) port=$PORT_WITH ;;
    updated) port=$PORT_UPDATED ;;
    subfix) port=$PORT_SUBFIX ;;
    *) port=$PORT_WITHOUT ;;
  esac
  local data="$RUNS_DIR/$arm/data"
  local log="$RUNS_DIR/$arm/serve.log"
  mkdir -p "$data"
  PIDS=$(ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | sort -u)
  [[ -n "$PIDS" ]] && kill $PIDS 2>/dev/null
  sleep 1
  local debug_env=()
  if [[ $arm != without ]]; then debug_env=(OPENCODE_HANDOFF_DEBUG=1); fi
  env "${debug_env[@]}" OPENCODE_PASSWORD=$PW \
  XDG_CONFIG_HOME="$BENCH_DIR/arm-config/$arm" \
  XDG_DATA_HOME="$data" \
    nohup "$BIN" serve --hostname 127.0.0.1 --port "$port" >"$log" 2>&1 &
  SERVER_PID[$arm]=$!
  SERVER_PORT[$arm]=$port
  SERVER_LOG[$arm]=$log
  SERVER_DATA[$arm]=$data
  for _ in $(seq 1 60); do
    curl -s -o /dev/null -m 2 "http://127.0.0.1:$port/app" && return 0
    sleep 1
  done
  echo "server for arm=$arm failed to start (see $log)" >&2
  return 1
}

stop_servers() { for arm in $ARMS; do [[ -n ${SERVER_PID[$arm]:-} ]] && kill "${SERVER_PID[$arm]}" 2>/dev/null; done; }
trap stop_servers EXIT

# wait_idle <arm> <session_id> <timeout_s> — poll own arm DB until session idle
wait_idle() {
  local arm=$1 sid=$2 to=$3 waited=0
  while (( waited < to )); do
    local state
    state=$(bun "$BENCH_DIR/metrics.ts" idle --db "${SERVER_DATA[$arm]}/opencode/opencode.db" --session "$sid" 2>/dev/null)
    [[ "$state" == idle ]] && return 0
    # session may not exist yet; keep polling
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

# latest_child <arm> <dir> <since_ms> <seen_ids...> -> newest unseen 'Resumed Handoff' session id
# Uses the caller's $root (run_rep's local) to anchor the time window at the
# root session's DB timestamp; the shell clock can drift ahead of the server's
# and hide freshly created rows from a --since filter.
latest_child() {
  local arm=$1 dir=$2 since=$3; shift 3
  bun "$BENCH_DIR/metrics.ts" child --db "${SERVER_DATA[$arm]}/opencode/opencode.db" \
    --dir "$dir" --since "$since" --root "${root:-}" --seen "$*" 2>/dev/null
}

run_turn() { # arm prompt_or_session... ; echoes extracted sessionID of the turn
  local arm=$1; shift
  local url="http://127.0.0.1:${SERVER_PORT[$arm]}"
  OPENCODE_PASSWORD=$PW timeout "$TURN_TIMEOUT" \
    "$BIN" run --server "$url" --format json --auto -m "$MODEL" "$@"
}

run_rep() { # arm task rep
  local arm=$1 task=$2 rep=$3
  local name="$task-r$rep"
  local scratch="$RUNS_DIR/$arm/$name/repo"
  local repdir="$RUNS_DIR/$arm/$name"
  rm -rf "$scratch"; mkdir -p "$repdir"
  cp -r "$BENCH_DIR/tasks/$task/repo" "$scratch"
  # bound the worktree at $scratch even if RUNS_DIR is ever moved into a repo
  git -C "$scratch" init -q 2>/dev/null || true

  if [[ $arm != without ]]; then
    mkdir -p "$scratch/.opencode"
    if [[ -n "$SUBLIMIT" ]]; then
      printf '{ "primaryLimit": %d, "subagentLimit": %d }\n' "$LIMIT" "$SUBLIMIT" > "$scratch/.opencode/handoff.json"
    else
      printf '{ "primaryLimit": %d }\n' "$LIMIT" > "$scratch/.opencode/handoff.json"
    fi
  fi

  local prompt_file="$repdir/prompt.txt"
  sed "s|/APP|$scratch|g" "$BENCH_DIR/tasks/$task/PROMPT.md" > "$prompt_file"

  local since_ms; since_ms=$(date +%s%3N)
  local t0; t0=$(date +%s%3N)
  local rejects0=0
  [[ -f "${SERVER_LOG[$arm]}" ]] && rejects0=$(grep -c "too long; compacting" "${SERVER_LOG[$arm]}" 2>/dev/null || true)

  # first turn (cwd must be the scratch repo: it becomes the session's
  # directory, which drives the plugin's worktree/config lookup and our metrics)
  local jsonl="$repdir/turn0.jsonl" errlog="$repdir/turns.err"
  (cd "$scratch" && run_turn "$arm" --title "bench-$arm-$name" "$(cat "$prompt_file")") >"$jsonl" 2>>"$errlog"
  local rc=$?
  local root; root=$(jq -r 'select(.sessionID)|.sessionID' "$jsonl" 2>/dev/null | head -1)
  if [[ -z "$root" ]]; then
    echo "{\"arm\":\"$arm\",\"task\":\"$task\",\"rep\":$rep,\"pass\":false,\"error\":\"no session in turn0 (rc=$rc)\"}" >> "$RUNS_DIR/results.jsonl"
    return
  fi

  local target=$root; local seen=""; local pass=0; local hops=0; local nudges=0
  while true; do
    wait_idle "$arm" "$target" "$IDLE_TIMEOUT" || echo "warn: $arm/$name target $target idle-timeout" >&2
    # did the plugin roll over to a child session? The idle-hook rollover (save
    # artifact, create child, seed prompt) runs asynchronously just after the
    # session goes idle, so give it CHILD_GRACE before concluding "no child".
    local waited_child=0
    while :; do
      local child; child=$(latest_child "$arm" "$scratch" "$since_ms" "$seen")
      if [[ -z "$child" ]]; then
        (( waited_child >= CHILD_GRACE )) && break
        sleep 3; waited_child=$((waited_child + 3)); continue
      fi
      waited_child=0
      seen="$seen $child"; target=$child; hops=$((hops + 1))
      wait_idle "$arm" "$target" "$IDLE_TIMEOUT" || echo "warn: $arm/$name child $target idle-timeout" >&2
    done
    if (cd "$scratch" && ./check.sh) >"$repdir/check.log" 2>&1; then pass=1; break; fi
    if (( nudges >= NUDGES )); then break; fi
    nudges=$((nudges + 1))
    (cd "$scratch" && run_turn "$arm" --session "$target" \
      "Continue the task in $scratch. Re-read the task notes if needed, keep working, and verify with ./check.sh before stopping.") \
      >> "$repdir/turn-nudge$nudges.jsonl" 2>>"$errlog"
  done

  local t1; t1=$(date +%s%3N)
  local rejects1=$rejects0
  [[ -f "${SERVER_LOG[$arm]}" ]] && rejects1=$(grep -c "too long; compacting" "${SERVER_LOG[$arm]}" 2>/dev/null || true)

  # metrics: aggregate token/cost columns for sessions rooted at this scratch dir
  local metrics
  metrics=$(bun "$BENCH_DIR/metrics.ts" agg --db "${SERVER_DATA[$arm]}/opencode/opencode.db" \
    --dir "$scratch" --since "$since_ms" --root "$root" 2>/dev/null)
  # wall clocks keep running through S3 suspend, which has corrupted reps before
  # (a 4h sleep inflated one rep to 14,269s). Derive suspension-corrected active
  # time from the message timeline; fall back to raw wall if the query fails.
  local active_json active_ms
  active_json=$(bun "$BENCH_DIR/metrics.ts" active --db "${SERVER_DATA[$arm]}/opencode/opencode.db" \
    --dir "$scratch" --since "$since_ms" --root "$root" 2>/dev/null)
  active_ms=$(echo "$active_json" | jq -r '.active_ms // empty' 2>/dev/null)
  [[ -z "$active_ms" ]] && active_ms=$((t1 - t0))
  local artifacts=0
  [[ -d "$scratch/.opencode/handoffs" ]] && artifacts=$(find "$scratch/.opencode/handoffs" -name 'handoff-*.md' | wc -l)

  echo "$metrics" | jq -c \
    --arg arm "$arm" --arg task "$task" --arg rep "$rep" \
    --arg root "$root" --argjson wall_ms "$active_ms" --argjson wall_raw_ms "$((t1 - t0))" \
    --argjson pass "$pass" --argjson hops "$hops" --argjson nudges "$nudges" \
    --argjson rejects "$((rejects1 - rejects0))" --argjson artifacts "$artifacts" \
    '{arm:$arm, task:$task, rep:($rep|tonumber), root_session:$root, pass:($pass==1),
      handoff_hops:$hops, nudges:$nudges, compaction_rejects:$rejects, artifacts:$artifacts,
      wall_ms:$wall_ms, wall_raw_ms:$wall_raw_ms} + .' \
    >> "$RUNS_DIR/results.jsonl"
  echo "== $arm/$name: pass=$pass hops=$hops nudges=$nudges rejects=$((rejects1 - rejects0)) artifacts=$artifacts wall=$(( active_ms/1000 ))s (raw $(( (t1-t0)/1000 ))s)"
}

for arm in $ARMS; do
  start_server "$arm" || exit 1
  # warm-up turn so plugins/providers are loaded before timing anything
  OPENCODE_PASSWORD=$PW "$BIN" run --server "http://127.0.0.1:${SERVER_PORT[$arm]}" --format json --auto -m "$MODEL" --title "warmup-$arm" "Reply with exactly: ok" >/dev/null 2>&1
done

for arm in $ARMS; do
  for task in $TASKS; do
    for ((r=1; r<=REPS; r++)); do
      run_rep "$arm" "$task" "$r"
    done
  done
done

echo "done. results: $RUNS_DIR/results.jsonl"

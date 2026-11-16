# Benchmark: harness with vs. without the handoff plugin

A/B benchmark measuring what `opencode-forward-handoff` costs and what it buys
when running the same coding tasks through the OpenCode CLI.

## Arms

| arm | plugin | notes |
|-----|--------|-------|
| `with` | loaded from GitHub (pinned SHA in `arm-config/with/opencode/opencode.json`) | gets a hermetic `.opencode/handoff.json` (`primaryLimit` = `--limit`) written into each scratch task repo |
| `without` | not configured at all | sessions run to completion (or provider-side rejection) in one context |

Arms are fully isolated: each has its own `XDG_CONFIG_HOME`
(`bench/arm-config/<arm>`), its own `XDG_DATA_HOME` (own `opencode.db`), and
its own long-lived `opencode serve` instance. A shared server per arm is
required because the plugin's rollover happens in an **idle hook** — the CLI
exiting would kill a per-command server before the hook can create the child
session.

## How a run works (`run.sh`)

1. Copy the task repo to a scratch dir **outside any git repo** (worktree
   detection must not leak upward), `git init` it, and for the `with` arm write
   `.opencode/handoff.json`.
2. Start (or reuse) the arm's `opencode serve`; run
   `opencode run --session …` with the task's `PROMPT.md` as the first message.
3. After the turn goes idle, poll the arm's DB snapshot for a new
   `Resumed Handoff (…)` session in the same scratch directory (within
   `CHILD_GRACE` seconds). If found, wait for that child to idle and repeat —
   this chains through any number of hops.
4. Run the task's deterministic `check.sh`. On failure, send up to `--nudges`
   bounded "continue" messages to the current session, re-checking after each.
5. Append one row to `<runs-dir>/results.jsonl`: pass, handoff hops, nudges,
   compaction rejects, wall time, per-session and total billed tokens
   (`input + cache.read + output`), peak occupancy.

Wall time is **suspend-corrected**: `date +%s` and `/proc/uptime` both keep
counting through S3 sleep, and a mid-run suspend once inflated a rep to 4 wall
hours. The recorded `wall_ms` is `active_ms` from `metrics.ts active` — the
merged message timeline of the rep's sessions with inter-message gaps over
5 min excluded as dead time. The raw wall clock is kept as `wall_raw_ms`.
Prefer launching long benchmarks under
`systemd-inhibit --what=idle:sleep bash bench/run.sh …`.

## Tasks

- `tasks/warehouse-cli` — small fix task (peaks ~11k occupancy). Expected to
  pass in both arms; measures pure overhead of the plugin when handoffs are
  *not* needed (only if `--limit` forces them).
- `tasks/pricing-engine` — larger multi-file task (observed ~26k peak
  occupancy). The backend (`gufo`) hard-rejects prompts over ~32k tokens, so
  this task sits near the failure boundary where the plugin is designed to
  help: the `with` arm hands off before the wall, the `without` arm risks
  provider-side rejection/compaction.

Each task dir contains `repo/` (the scratch starting point), `PROMPT.md`, and
`check.sh` (deterministic grader; fixes must be in source, not tests/expected).

## Running

```bash
# calibration (1 rep, sanity-check plumbing)
bash bench/run.sh --arm both --tasks warehouse-cli --reps 1 --limit 24000

# full benchmark (inhibit suspend so reps aren't inflated by sleep)
systemd-inhibit --what=idle:sleep --who=bench --why "benchmark run" \
  bash bench/run.sh --arm both --reps 5 --limit 24000 --runs-dir /tmp/opencode/bench/runs-full

# report
bun bench/report.ts /tmp/opencode/bench/runs-full/results.jsonl
```

Flags: `--arm with|without|both`, `--tasks "t1 t2"`, `--reps N`, `--nudges N`,
`--limit N` (with-arm `primaryLimit`), `--runs-dir DIR`. The CLI binary is
resolved as `$OPENCODE_BIN` → `bench/bin/opencode` (untracked) → `opencode`.

## Metrics tools

- `metrics.ts` — reads a snapshot copy of the arm's `opencode.db`
  (`bun:sqlite`). Subcommands: `idle <db> <session>` (has it gone idle?),
  `child <db> <dir> <since-id>` (newest `Resumed Handoff` session under a
  scratch dir), `agg <db> <ids…>` (token/occupancy aggregation),
  `active <db> <dir> <since-ms>` (suspend-corrected active time from the
  message timeline). Used by `run.sh`; also useful ad hoc.
- `report.ts` — aggregates `results.jsonl` into a per-task + overall arm
  comparison table (success %, wall seconds, billed tokens, hops, nudges,
  rejects).

## Methodology notes

- **Occupancy** = max over all completed assistant messages of
  `tokens.input + tokens.cache.read` (same metric the plugin gate uses).
- **Billed tokens** = `input + cache.read + output` summed across the root
  session and all handoff children. Handoffs reset occupancy to ~0 in the
  child but re-send the artifact, so the `with` arm pays extra billed tokens
  per hop; the benchmark quantifies that cost vs. avoided rejections.
- `--limit` is a *handoff threshold*, not the model context window. A useful
  benchmark limit is comfortably below the backend's hard prompt cap (~32k)
  so the gate fires before the provider rejects.
- Debug logging: `run.sh` exports `OPENCODE_HANDOFF_DEBUG=1` on the `with`
  arm server only; `[handoff-debug]` lines land in `<runs-dir>/with/serve.log`.
- Runs from earlier, pre-fix code may be kept aside (e.g.
  `results-pre-fix.jsonl.bak`); the gate-occupancy bug (always 0) invalidated
  all pre-`7b12cd0` `with`-arm rows.

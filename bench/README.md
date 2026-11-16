# Benchmark: harness with vs. without the handoff plugin

A/B/A benchmark measuring what `opencode-forward-handoff` costs and what it
buys when running the same coding tasks through the OpenCode CLI, comparing
the original gate against the updated (grace window + deferral) version.

## Arms

| arm | plugin | notes |
|-----|--------|-------|
| `with` | original, loaded from GitHub pinned to `7b12cd0` (`arm-config/with/opencode/opencode.json`) | fail-fast single threshold: at `primaryLimit` the tool call is blocked and a handoff forced immediately |
| `updated` | grace window + safe-boundary deferral, pinned to `1057e49` (`arm-config/updated/opencode/opencode.json`) | warn-only band `primaryLimit`…`primaryLimit+graceTokens`; at the hard gate, read-only calls at a safe boundary defer up to 6× before forcing |
| `without` | not configured at all | sessions run to completion (or provider-side rejection) in one context |

Both plugin arms get a hermetic `.opencode/handoff.json` (`primaryLimit` =
`--limit`, `subagentLimit` = `--sublimit`, default 16000) written into each
scratch task repo. Pinning matters: the plugin loads from GitHub, so the two
plugin arms run identical tasks/limits/models and differ *only* in gate
behavior.

Arms are fully isolated: each has its own `XDG_CONFIG_HOME`
(`bench/arm-config/<arm>`), its own `XDG_DATA_HOME` (own `opencode.db`), and
its own long-lived `opencode serve` instance. A shared server per arm is
required because the plugin's rollover happens in an **idle hook** — the CLI
exiting would kill a per-command server before the hook can create the child
session.

## How a run works (`run.sh`)

1. Copy the task repo to a scratch dir **outside any git repo** (worktree
   detection must not leak upward), `git init` it, and for the plugin arms
   (`with`, `updated`) write `.opencode/handoff.json` with the run's
   `--limit`/`--sublimit`.
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
- `tasks/module-triage` — multi-agent task: four independent buggy modules,
  each with a locked spec in `docs/` and its own test file. `PROMPT.md`
  mandates spawning exactly 4 sub-agents **in parallel** in one message via
  the task tool, and `check.sh` (`bun test`) grades all four. Subagent
  sessions are capped by `subagentLimit` (default 16k) and complete quietly
  when hit; the parent session handles rollover.
- `tasks/legacy-audit` — like module-triage but the four modules are
  deliberately sprawling legacy code with long dependency chains, so shards
  run 13–24k tokens and straddle the 16k `subagentLimit` (the quiet-complete
  path actually executes). Specs in `docs/<module>-spec.md` are locked and
  authoritative; a planted misleading `docs/NOTES.md` tests whether agents
  trust it over the spec; each module has one planted regression discoverable
  only by reading the spec and tracing with `tools/dump.ts`.

Each task dir contains `repo/` (the scratch starting point), `PROMPT.md`, and
`check.sh` (deterministic grader; fixes must be in source, not tests/expected).

## Running

```bash
# calibration (1 rep, sanity-check plumbing)
bash bench/run.sh --arm both --tasks warehouse-cli --reps 1 --limit 24000

# full three-arm benchmark (inhibit suspend so reps aren't inflated by sleep)
systemd-inhibit --what=idle:sleep --who=bench --why "benchmark run" \
  bash bench/run.sh --arm with without updated --reps 5 --limit 24000 \
  --sublimit 16000 --runs-dir /tmp/opencode/bench/runs-full

# report (tables + ASCII + SVG, one section per input file)
bun bench/charts.ts runs1.jsonl runs2.jsonl ... \
  --labels "Single-agent,Sub-agent: module triage,Sub-agent: legacy audit" \
  --svg-dir bench/charts --out REPORT-sections.md
```

Flags: `--arm with|without|updated|both` (a token is `both` iff exactly the
two original arms are listed, for DB/port/label reuse), `--tasks "t1 t2"`,
`--reps N`, `--nudges N`, `--limit N` (plugin arms' `primaryLimit`),
`--sublimit N` (plugin arms' `subagentLimit`, default 16000),
`--runs-dir DIR`. The CLI binary is resolved as `$OPENCODE_BIN` →
`bench/bin/opencode` (untracked) → `opencode`. Never run two runners against
the same `--runs-dir` concurrently (they interleave rows and share per-rep
dirs).

## Metrics tools

- `metrics.ts` — reads the arm's live `opencode.db` (`bun:sqlite`, WAL gives
  consistent snapshots; do not copy db+wal+shm). Subcommands: `idle <db>
  <session>` (has it gone idle?), `child <db> <dir> <since> [--root <id>]`
  (newest `Resumed Handoff` session under a scratch dir), `agg <db> <dir>
  <since> [--root <id>]` (token/occupancy aggregation incl. parent/subagent
  split), `active <db> <dir> <since> [--root <id>]` (suspend-corrected active
  time from the message timeline). `--root <session id>` anchors the time
  window at the root session's own DB timestamp instead of the shell's
  `date +%s%3N`: the two clocks can disagree by a few hundred ms, which
  silently dropped root rows (undercounted every rep-level total by exactly
  the root's contribution). `run.sh` passes it automatically.
- `report.ts` — aggregates `results.jsonl` into a per-task + overall arm
  comparison table (success %, wall seconds, billed tokens, hops, nudges,
  rejects).
- `charts.ts` — full markdown report from one or more `results.jsonl` files
  (one section per file via `--labels`): tables, ASCII bar charts, and
  standalone SVG grouped-bar charts (`--svg-dir`).

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
- Debug logging: `run.sh` exports `OPENCODE_HANDOFF_DEBUG=1` on the plugin-arm
  servers; `[handoff-debug]` lines land in `<runs-dir>/<arm>/serve.log` as
  `gate=pass|grace|FIRE` with occupancy vs soft/hard limits (`grace` =
  warn-only band, `FIRE` = hard gate crossed → forced handoff on the original
  arm; on the updated arm a FIRE may be followed by deferrals instead).
- Runs from earlier, pre-fix code may be kept aside (e.g.
  `results-pre-fix.jsonl.bak`); the gate-occupancy bug (always 0) invalidated
  all pre-`7b12cd0` `with`-arm rows.

## Results

See **[REPORT.md](REPORT.md)** — the full three-arm report: per-family tables
with pairwise deltas, SVG/ASCII charts, gate-event evidence from the serve
logs, and per-family analysis (single-agent, module-triage, legacy-audit;
60 runs total, all arms pinned as described above).

Headline: the plugin is a large, replicated win on the one workload whose
contexts actually threaten the backend cap (single-agent pricing-engine,
−46% billed tokens original / −51% updated) and roughly neutral on sharded
sub-agent work where the gate stays silent; the updated grace/deferral gate
never increases cost over the original and removes its worst pathology (a
743k-token mid-integration handoff).

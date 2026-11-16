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
- `tasks/module-triage` — multi-agent task: four independent buggy modules,
  each with a locked spec in `docs/` and its own test file. `PROMPT.md`
  mandates spawning exactly 4 sub-agents **in parallel** in one message via
  the task tool, and `check.sh` (`bun test`) grades all four. Subagent
  sessions are capped by `subagentLimit` (default 16k) and complete quietly
  when hit; the parent session handles rollover.

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
- Debug logging: `run.sh` exports `OPENCODE_HANDOFF_DEBUG=1` on the `with`
  arm server only; `[handoff-debug]` lines land in `<runs-dir>/with/serve.log`.
- Runs from earlier, pre-fix code may be kept aside (e.g.
  `results-pre-fix.jsonl.bak`); the gate-occupancy bug (always 0) invalidated
  all pre-`7b12cd0` `with`-arm rows.

## Results (reps=5, limit=24000, backend hard cap ~32k)

```
pricing-engine
arm       reps  success  wall(s)  billed tok  hops  nudges  rejects
with         5     100%    213.5     247,455   1.0     0.2     0.0
without      5     100%    331.5     458,928   0.0     0.0     0.0

warehouse-cli
arm       reps  success  wall(s)  billed tok  hops  nudges  rejects
with         5     100%     39.3      62,248   0.0     0.0     0.0
without      5     100%     42.6      78,385   0.0     0.0     0.0
```

Reading:

- **Long task (pricing-engine):** the gate fired exactly once per `with` rep
  (root peaked 25.6k–28.3k, child resumed at ~9k). Handoffs cut billed tokens
  **46%** (247k vs 459k) and suspend-corrected wall time **36%**. In the
  `without` arm, billed tokens track peak occupancy almost linearly: reps that
  crept to 32.1k/32.8k peak (the backend's rejection zone) burned 673k–748k
  tokens re-sending full context on every request, and also took 2–4× the
  wall time of their lower-occupancy siblings.
- **Short task (warehouse-cli):** peak occupancy stayed ~10–12k on both arms,
  so the gate never fired and the plugin was a verified no-op; the small
  between-arm deltas there are run-to-run noise, not plugin effect.
- **Success rate was 100% on both arms** — these tasks were completable
  within one context; the win is cost/time and rejection headroom, not
  correctness. With a hard ~32k cap and longer tasks, the `without` arm's
  32.8k peak rep shows it operating at the edge of outright provider
  rejection (`rejects` counts observed compaction/rejection errors; zero
  occurred, but two reps finished within ~600 tokens of the cap).
- One `with` rep needed a nudge (model blocked once without emitting the
  artifact, produced it after the follow-up) — the nudge mechanism recovered
  it, final hop count unchanged.

## Results — sub-agent task (module-triage, reps=5, limit=24000)

4 parallel sub-agents per rep (task tool); `sub` columns split tokens by
`session_v2.parent_id` (subagents have it, handoff children don't).

```
module-triage
arm       reps  success  wall(s)  billed tok  hops  nudges  rejects
with         5     100%    313.5     491,265   0.2     0.0     0.0
without      5     100%    254.5     397,068   0.0     0.0     0.0

arm       parent tok  sub tok  parent peak (max rep)  sub peak (max rep)
with        225,738  265,527             26,480               14,603
without     155,401  241,667             23,304               13,481
```

Reading:

- **The plugin did not help here — it cost more.** Only one `with` rep fired a
  handoff (r4: parent peaked 26,480 → 1 hop), and that rep burned 743k tokens
  vs a 397k arm mean. Excluding r4, the `with` mean is still 428k vs 397k —
  within run-to-run noise, but there is no token or wall-time win.
- **Why the single-agent win doesn't transfer:** with 4 parallel sub-agents,
  no context ever grows large enough to matter. Sub-agent peaks stayed at
  11k–15k (each handles one small module) and parent peaks 13k–26k — the
  parent only aggregates summaries, so the gate's target condition (one
  session grinding toward the cap) rarely exists. The parent's own occupancy
  growth in r4 was incidental, and the hop it triggered cost more (artifact +
  fresh-context re-reading) than the high-occupancy requests it avoided.
- **Multi-agent parallelism is itself the context-management strategy**: work
  is sharded below any cap by construction, so a handoff gate has nothing to
  do. Both arms hit 0 rejects.
- Honest caveat: the `with`-arm mean is dominated by r4 (743k); medians are
  closer (with 448k vs without 376k) but still favor `without`.
- **Scope caveat:** "the plugin doesn't help multi-agent" is partly a property
  of *this task's shard sizes*. Shards were deliberately small and
  zero-cross-dependency, so sub-agent peaks (11k–15k) sat well under the 16k
  `subagentLimit` — the gate's sub-agent path was never exercised. A task with
  large exploratory shards (auditing a sprawling legacy module, say) could push
  sub-agents past their limit, where the quiet-complete path and parent-side
  remediation would decide the outcome. See `tasks/legacy-audit` below.

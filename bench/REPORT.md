# Handoff Plugin Benchmark Report

A/B/A benchmark of the OpenCode harness with two versions of
`opencode-forward-handoff` vs. no plugin at all. Backend `gufo` (hard prompt
cap ≈32k tokens), handoff limit 24000 (subagent limit 16000 for the
sub-agent tasks, grace window 4000), 5 reps per task/arm, deterministic
`check.sh` grading. Methodology and caveats: [README.md](README.md).

**Arms** (plugin loads from GitHub, pinned per arm):

| arm | plugin | gate behavior |
|---|---|---|
| `without` | none | — |
| `with` | original (`7b12cd0`) | single threshold at 24000: tool call blocked, handoff forced immediately (fail-fast) |
| `updated` | grace window + deferral (`1057e49`) | warn-only band 24000–28000; at the hard gate, read-only calls at a safe boundary (no in-flight edit, empty/completed todos) are deferred up to 6× before forcing |

Task families: **Single-agent** (long `pricing-engine` build + short
`warehouse-cli`), **Sub-agent: module triage** (4 parallel sub-agents,
light shards), **Sub-agent: legacy audit** (4 parallel sub-agents over 4
sprawling legacy modules with locked specs and planted regressions).

## Single-agent

| task | arm | reps | success | wall (s) | billed tokens | hops | nudges | rejects |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| pricing-engine | with | 5 | 100% | 213.5 | 247,455 | 1.0 | 0.2 | 0.0 |
| pricing-engine | without | 5 | 100% | 331.5 | 458,928 | 0.0 | 0.0 | 0.0 |
| pricing-engine | updated | 5 | 100% | 196.0 | 224,858 | 0.4 | 0.0 | 0.0 |
|  | **Δ (with vs without)** | | +0% | −36% | −46% | | | — |
|  | **Δ (updated vs without)** | | +0% | −41% | −51% | | | — |
|  | **Δ (updated vs with)** | | +0% | −8% | −9% | | | — |
| warehouse-cli | with | 5 | 100% | 39.3 | 62,248 | 0.0 | 0.0 | 0.0 |
| warehouse-cli | without | 5 | 100% | 42.6 | 78,385 | 0.0 | 0.0 | 0.0 |
| warehouse-cli | updated | 5 | 100% | 43.0 | 64,005 | 0.0 | 0.0 | 0.0 |
|  | **Δ (with vs without)** | | +0% | −8% | −21% | | | — |
|  | **Δ (updated vs without)** | | +0% | +1% | −18% | | | — |
|  | **Δ (updated vs with)** | | +0% | +9% | +3% | | | — |

![Single-agent billed tokens](charts/single-agent-tokens.svg)
![Single-agent wall time](charts/single-agent-wall.svg)

```
Billed tokens per rep (mean) — tok
pricing-engine with        ███████████████············· 247,454.6
pricing-engine without     ████████████████████████████ 458,928.2
pricing-engine updated     ██████████████·············· 224,858.2
warehouse-cli with         ████························ 62,248.0
warehouse-cli without      █████······················· 78,385.2
warehouse-cli updated      ████························ 64,005.2
```

**pricing-engine** (multi-file build, contexts crash into the ≈32k backend
cap): the plugin's designed-for case. The `without` arm rambles at
29.4k-token peak occupancy and pays full-price re-sends — 459k tokens,
331 s. Both plugin arms cut billed tokens roughly in half
(−46% original, −51% updated). The updated gate edges out the original
(−8% wall, −9% tokens): the hard gate was crossed in 3 of 5 reps
(occupancy 28,727–30,678 ≥ hard 28,000) but only 2 needed a full
handoff+resume; the third drafted the artifact, then safe-boundary
deferrals let it finish in place (mean hops 1.0 → 0.4). The 9 grace-band
crossings were warn-only, never blocking. Pass rate is 100% everywhere.

**warehouse-cli** (short task, ~10.5k peak): never reaches the gate in any
arm. The −18%/−21% token deltas are within rep-to-rep variance
(±15%) — treat as noise, not plugin effect. The value shown here is that
the plugin is inert when it should be: zero gate events, no measurable
overhead.

## Sub-agent: module triage

Four parallel sub-agents triage small modules; parent integrates. Shards are
light — even the `with` arm's worst parent peak (26,480) barely touched the
24k gate, and no sub-agent came near 16k.

| task | arm | reps | success | wall (s) | billed tokens | hops | nudges | rejects |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| module-triage | with | 5 | 100% | 313.5 | 491,265 | 0.2 | 0.0 | 0.0 |
| module-triage | without | 5 | 100% | 254.5 | 397,068 | 0.0 | 0.0 | 0.0 |
| module-triage | updated | 5 | 100% | 248.4 | 412,539 | 0.0 | 0.0 | 0.0 |
|  | **Δ (with vs without)** | | +0% | +23% | +24% | | | — |
|  | **Δ (updated vs without)** | | +0% | −2% | +4% | | | — |
|  | **Δ (updated vs with)** | | +0% | −21% | −16% | | | — |

![Module-triage billed tokens](charts/sub-agent-module-triage-tokens.svg)
![Module-triage wall time](charts/sub-agent-module-triage-wall.svg)

| task | arm | sub-agents | parent tok | sub-agent tok | parent peak | sub peak |
|---|---|---:|---:|---:|---:|---:|
| module-triage | with | 4.0 | 225,738 | 265,527 | 19,666 | 13,091 |
| module-triage | without | 4.0 | 155,401 | 241,667 | 17,393 | 12,605 |
| module-triage | updated | 4.0 | 158,183 | 254,356 | 14,839 | 12,808 |

The original plugin's mean is dragged by **r4**: the parent crossed 24k
mid-integration, the fail-fast gate blocked a mutating call, and the
resulting handoff+resume burned ≈743k tokens (the single most expensive run
in the whole benchmark) for a task that was nearly done. The updated arm
showed no such rep (max 499k, hops 0), but note the sub-agent gate is
unchanged between plugin versions and no updated rep even approached the
gate — so the 24% → 4% gap vs `without` is mostly the removal of that one
pathology plus variance, not a measured steady-state win. The honest
summary: on tasks whose contexts never threaten the backend cap, the gate
should stay silent; every time it fires here it costs, and the updated
grace/deferral design shrinks (but does not eliminate) that exposure.

## Sub-agent: legacy audit

Four parallel sub-agents repair planted regressions in sprawling legacy
modules governed by locked spec docs (with a deliberately misleading
`docs/NOTES.md`). Shards run 13–24k tokens; the 16k subagent limit was
crossed in 2 of 15 runs.

| task | arm | reps | success | wall (s) | billed tokens | hops | nudges | rejects |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| legacy-audit | with | 5 | 100% | 275.9 | 454,418 | 0.0 | 0.0 | 0.0 |
| legacy-audit | without | 5 | 100% | 178.9 | 348,161 | 0.0 | 0.0 | 0.0 |
| legacy-audit | updated | 5 | 100% | 177.3 | 355,745 | 0.0 | 0.0 | 0.0 |
|  | **Δ (with vs without)** | | +0% | +54% | +31% | | | — |
|  | **Δ (updated vs without)** | | +0% | −1% | +2% | | | — |
|  | **Δ (updated vs with)** | | +0% | −36% | −22% | | | — |

![Legacy-audit billed tokens](charts/sub-agent-legacy-audit-tokens.svg)
![Legacy-audit wall time](charts/sub-agent-legacy-audit-wall.svg)

| task | arm | sub-agents | parent tok | sub-agent tok | parent peak | sub peak |
|---|---|---:|---:|---:|---:|---:|
| legacy-audit | with | 4.0 | 132,122 | 322,297 | 14,042 | 17,165 |
| legacy-audit | without | 4.0 | 96,493 | 251,668 | 12,184 | 13,989 |
| legacy-audit | updated | 4.0 | 94,925 | 260,820 | 12,540 | 13,909 |

All 15 runs pass (60/60 `bun test` verified by `check.sh`), zero parent
handoffs — parents stay ≤16.7k. The action is in the sub-agents: the
`with` arm's gate fired twice (occupancy 16,192 and 19,609 ≥ 16,000), and
those are exactly its two most expensive reps (r2: 457 s / 641k tok;
r1: 318 s / 558k tok). The subagent fail-fast path forces a mid-shard
summary and the parent re-does the work — pure overhead when the true
backend cap is ≈32k. The updated arm's mean looks better (−36% wall vs
`with`), but its sub-agent gate is *identical* to the original's and simply
never fired (max sub peak 14,979 < 16k): that gap is sampling luck, not
the new grace/deferral logic, which only applies to primary sessions.
Family variance is huge (267k–641k tokens on identical prompts); with
n=5 these arm means are not statistically separated.

## Analysis

**Where the plugin wins.** Only the single-agent `pricing-engine` runs
sustainably threaten the ≈32k backend cap, and there the gate is a clear,
replicated win: −46% billed tokens and −36% wall (original), improving to
−51% / −41% with the grace window, at unchanged 100% success. The rollover
replaces full-price context re-sends with a ≤1.2k-token artifact.

**What the grace window changed.** Evidence from the updated arm's serve
log: 123 `gate=pass`, 9 `gate=grace` (warn-only, never blocked), 3
`gate=FIRE`. Of the 3 hard-gate crossings (28,727–30,678), 2 completed a
full handoff+resume and 1 (r1) was carried by safe-boundary deferrals to a
natural finish in place — mean hops 1.0 → 0.4 while keeping every pass.
The 743k-token mid-integration pathology from the original `with` arm did
not recur in any updated rep.

**Where the plugin doesn't help.** On sub-agent workloads whose shards
complete under the cap (module-triage fully, legacy-audit all but 2/15
sub-agents), every gate event is cost without benefit: forced summaries +
parent rework, +31%/+24% tokens in the `with` arms. The subagent gate has
no grace band yet — the legacy-audit data suggests the 16k subagent limit
is too aggressive for this backend (real cap ≈32k) and a sub-agent grace
band (or a higher limit) is the natural follow-up.

**Caveats.** n=5 per cell; rep-to-rep variance within a cell reaches
±40% (see legacy-audit), so small deltas (<±10%) between arms — e.g.
warehouse-cli, updated-vs-without module-triage — should be read as noise.
Success was 100% in all 60 runs, so the benchmark measures efficiency, not
capability: the discriminating signal is token/wall cost on tasks that
actually approach the context cap.

# opencode-forward-handoff

Context-window handoff plugin for [OpenCode](https://github.com/sst/opencode). When a session's
context approaches its budget, the plugin halts tool use, makes the agent emit a structured
handoff artifact, and automatically rolls over to a fresh session seeded with a resume prompt.

## How it works

1. **Occupancy tracking** — before every tool call, the plugin measures the session's true context
   occupancy (prompt-side tokens: the maximum of `input + cache.read` across completed assistant
   messages).
2. **Limit reached** — further tool calls are blocked and the agent is instructed to stop and
   output a `# SESSION HANDOFF ARTIFACT`: objective, verified progress, failed approaches,
   file/symbol map, and the immediate next step.
3. **Auto-rollover** — when the session goes idle with a completed artifact, it is saved to
   `.opencode/handoffs/handoff-<timestamp>.md` and a new session titled
   `Resumed Handoff (<time>)` is created and prompted to continue directly from the handoff
   payload.
4. **Subagents** — subagent sessions have their own (lower) cap and are asked for a concise
   summary back to the parent instead of a full handoff; they never roll over.

## Install

Install from this repository (OpenCode CLI):

```sh
opencode plugin add github:isaiahfrantz/opencode-forward-handoff
```

…or add it directly to your OpenCode config (`opencode.json(c)`, global or per-project):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:isaiahfrantz/opencode-forward-handoff"]
}
```

Git specs support branches, tags, and full commit hashes as pins — e.g.
`github:isaiahfrantz/opencode-forward-handoff#v0.1.0` — and the explicit SSH form
`git+ssh://git@github.com/isaiahfrantz/opencode-forward-handoff.git`. Pinned entries are not
auto-updated; unpinned ones can be refreshed with `opencode plugin update`.

For local development, point the entry at a checkout instead:

```jsonc
{ "plugins": ["/path/to/opencode-forward-handoff"] }
```

A copy of the source can also live under `~/.config/opencode/plugins/`, where it is discovered
automatically.

## Configuration

Settings are read from `.opencode/handoff.json` in the project, or
`~/.config/opencode/handoff.json` (first match wins):

```json
{
  "primaryLimit": 115000,
  "subagentLimit": 16000,
  "autoRollover": true,
  "saveArtifactsDir": ".opencode/handoffs",
  "graceTokens": 4000,
  "deferAtSafeBoundary": true,
  "maxDeferrals": 6,
  "subagentGraceTokens": 2000,
  "subagentPriming": true
}
```

| Option            | Default             | Description                                        |
| ----------------- | ------------------- | -------------------------------------------------- |
| `primaryLimit`    | `28000`             | Soft token budget for primary sessions             |
| `subagentLimit`   | `16000`             | Soft token budget for subagent sessions            |
| `autoRollover`    | `true`              | Spawn + seed the resumed session automatically     |
| `saveArtifactsDir`| `.opencode/handoffs`| Directory for saved handoff artifacts (per repo)   |
| `graceTokens`     | `2000`              | Extra headroom between the soft limit and the hard gate; inside the band a warning nudges the model to wrap up without blocking tools. `0` restores fail-fast behavior |
| `deferAtSafeBoundary` | `true`          | At the hard gate, defer the handoff while the session sits at a safe boundary (no in-flight mutation, todo list empty or all-completed); forced at the next state-changing call |
| `maxDeferrals`    | `6`                 | How many safe-boundary deferrals are allowed before the handoff is forced anyway |
| `subagentGraceTokens` | `2000`          | Extra headroom between `subagentLimit` and the subagent hard gate (`0` restores single-threshold behavior) |
| `subagentPriming` | `true`              | Append the compact ≤300-token relay-contract primer (`TASK:` schema) to each subagent's first prompt |

Precedence (lowest to highest): built-in defaults → plugin options → environment variables
(`OPENCODE_PRIMARY_LIMIT`, `OPENCODE_SUBAGENT_LIMIT`, `OPENCODE_GRACE_TOKENS`) → config file →
runtime overrides set via `/handoff-limit`.

> **Provider capacity note.** The effective hard gate is `primaryLimit + graceTokens`. Keep that
> sum below the context capacity the provider *actually enforces* — several OpenAI-compatible
> backends advertise 131072-token models but hard-reject prompts around 32k, which is why the
> shipped defaults (28000 + 2000) land at 30k. On providers with genuine 128k+ capacity, raising
> `primaryLimit` (e.g. to 115000) is safe.

## Commands

```
/handoff-limit                    Show active limits and current session usage
/handoff-limit <primary>          Set the primary-session cap
/handoff-limit <primary> <sub>    Set primary and subagent caps
/handoff-limit reset              Clear runtime overrides
/handoff-limit help               Show usage
```

Runtime overrides are held in memory only (per OpenCode process) and are validated to values
above 1,000 tokens. Raising the limit above current usage mid-session un-blocks the session
immediately, so you can extend a session instead of rolling over.

## TUI companion

`src/tui.tsx` is a companion TUI part of the same package (exported as `opencode-forward-handoff/tui`). It watches
for sessions titled `Resumed Handoff …` and automatically focuses the new tab and shows a toast,
so the handoff rollover is visible as it happens. A single plugin entry loads every part — the
TUI picks up the TUI part of whatever the server loads, so no extra configuration is needed.

## Handoff artifacts

- Saved per repository to `<saveArtifactsDir>/handoff-<ISO-timestamp>.md` (default
  `.opencode/handoffs/`, git-ignored by this repo's `.gitignore`).
- An artifact is recognized by the `# SESSION HANDOFF ARTIFACT` heading in the agent's final
  message; rollover only fires for primary sessions, and only once per session.

## Development

```sh
bun install
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```

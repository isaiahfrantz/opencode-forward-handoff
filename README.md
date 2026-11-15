# opencode-forward-handoff

Context-window handoff plugin for [OpenCode](https://github.com/sst/opencode). When a session's
context approaches its budget, the plugin halts tool use, makes the agent emit a structured
handoff artifact, and automatically rolls over to a fresh session seeded with a resume prompt.

## How it works

1. **Occupancy tracking** — after every tool call, the plugin measures the session's true context
   occupancy (prompt-side tokens of the latest assistant message: `input + cache.read`).
2. **Limit reached** — further tool calls are blocked and the agent is instructed to stop and
   output a `# SESSION HANDOFF ARTIFACT`: objective, verified progress, failed approaches,
   file/symbol map, and the immediate next step.
3. **Auto-rollover** — when the session goes idle with a completed artifact, it is saved to
   `.opencode/handoffs/` and a new session is created and prompted to continue directly from
   the handoff payload.
4. **Subagents** — subagent sessions have their own (lower) cap and are asked for a concise
   summary back to the parent instead of a full handoff; they never roll over.

## Install

Add it to your OpenCode config (`~/.config/opencode/opencode.json`):

```json
{
  "plugin": ["opencode-forward-handoff"]
}
```

Or drop the source into `~/.config/opencode/plugin/`.

## Configuration

Settings are read from `.opencode/handoff.json` in the project, or
`~/.config/opencode/handoff.json` (first match wins):

```json
{
  "primaryLimit": 115000,
  "subagentLimit": 16000,
  "autoRollover": true,
  "saveArtifactsDir": ".opencode/handoffs"
}
```

| Option            | Default             | Description                                        |
| ----------------- | ------------------- | -------------------------------------------------- |
| `primaryLimit`    | `24000`             | Token budget for primary sessions                  |
| `subagentLimit`   | `16000`             | Token budget for subagent sessions                 |
| `autoRollover`    | `true`              | Spawn + seed the resumed session automatically     |
| `saveArtifactsDir`| `.opencode/handoffs`| Directory for saved handoff artifacts (per repo)   |

Precedence (lowest to highest): built-in defaults → plugin options → environment variables
(`OPENCODE_PRIMARY_LIMIT`, `OPENCODE_SUBAGENT_LIMIT`) → config file → runtime overrides set via
`/handoff-limit`.

## Commands

```
/handoff-limit                    Show active limits and current session usage
/handoff-limit <primary>          Set the primary-session cap
/handoff-limit <primary> <sub>    Set primary and subagent caps
/handoff-limit reset              Clear runtime overrides
/handoff-limit help               Show usage
```

## Development

```sh
bun install
bun run test        # vitest
bun run typecheck   # tsc --noEmit
```

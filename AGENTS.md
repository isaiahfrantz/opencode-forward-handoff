# AGENTS.md — opencode-forward-handoff

## What this is

An **OpenCode V2** plugin (`Plugin.define` from `@opencode/plugin`) that automatically
hands off a session to a fresh one when its **handoff token limit** is reached. When the
session's context occupancy crosses the limit, the plugin blocks further tool calls,
forces the model to emit a structured "SESSION HANDOFF ARTIFACT" summary, saves it to
disk, and seeds a new session with it so work continues in a clean context window.

## Target platform

- **OpenCode V2 only.** Uses the V2 plugin API (`Plugin.define`, `ctx.tool.hook`,
  `ctx.session.hook("experimental.idle")`, `ctx.command.transform`, `ctx.event.subscribe`).
  Do not introduce V1 (`@opencode-ai/plugin` hooks-style) patterns.
- Server part is `src/index.ts`; companion TUI part is `src/tui.tsx` (package export
  `./tui`). One `plugins: [...]` entry in `opencode.json(c)` loads both parts — never
  add separate entries or the deprecated V1 `plugin` field.

## ⚠️ What the "token limit" means

`primaryLimit` / `subagentLimit` are **per-handoff thresholds, NOT model context
limits**. They define how much prompt-side context occupancy is allowed to accumulate
in a session before a handoff is triggered; the rollover then resets the counter to
~zero in the new session. Set them well below the model's context window to leave headroom
for tool output and the handoff prompt itself (e.g. a 131k-context model might use a
115k handoff limit). They do not clamp or truncate anything the model can see — the only
enforcement is the tool-execution block described below.

Occupancy metric (single source of truth: `occupancyFromMessages()` in `src/index.ts`):

> The `tokens.input + tokens.cache.read` of the **last `type === "assistant"` message**
> returned by `ctx.session.context()`. That sum is what the model is actually billed /
> sees on the next request, so it tracks real prompt-side occupancy, not a running total.

Never reintroduce running-total accounting (the deleted `sessionTokens` Map +
`session.usage.updated` handler) — it double-counted cached tokens and inflated
occupancy quadratically.

## Configuration

Precedence in `loadConfig()` (`src/config.ts`), lowest → highest:

1. `PLUGIN_DEFAULTS` — `primaryLimit: 24000`, `subagentLimit: 16000`, `autoRollover: true`, `saveArtifactsDir: ".opencode/handoffs"`
2. Plugin options passed via `opencode.json` (`{ "package": "...", "options": {...} }`)
3. Env vars `OPENCODE_PRIMARY_LIMIT` / `OPENCODE_SUBAGENT_LIMIT`
4. First JSON file found: `<worktree>/.opencode/handoff.json`, then `~/.config/opencode/handoff.json`
5. `runtimeOverrides` — set by `/handoff-limit`; **in-memory only, never persisted**, lost on server restart

`loadConfig()` is called fresh on every hook firing, so config file edits take effect on
the next tool call (except `runtimeOverrides`, which only `/handoff-limit reset` clears).

## Runtime flow (src/index.ts)

1. **Hierarchy tracking** — a `ctx.event.subscribe()` loop records
   `isSubagent[sessionID] = Boolean(parentID)` on `session.created`; cleanup on
   `session.deleted`.
2. **Gate** — `ctx.tool.hook("execute.before")` computes occupancy. Below limit → allow.
   At/over limit → first time, inject the generator prompt (`buildGeneratorPrompt`) into
   the session (or the subagent summary instruction), mark `handoffPending`, then
   **throw** to block the tool call. Throwing is intentional: it's the only way to
   refuse a tool call.
3. **Rollover** — `ctx.session.hook("experimental.idle")` fires when the pending session
   goes idle. It looks for `# SESSION HANDOFF ARTIFACT` in the last assistant message's
   `text` content parts (V2 message schema: `m.type === "assistant"`, `m.content[]`),
   saves the artifact to `<worktree>/<saveArtifactsDir>/handoff-<ISO stamp>.md`, then
   (if `autoRollover`) creates `Resumed Handoff (<time>)` and seeds it with
   `buildResumePrompt(artifact)`.
   Subagent sessions that go pending just complete quietly — the parent handles rollover.
4. **Idempotency** — `handoffPending` + `rolloverCompleted` sets ensure the generator
   prompt is injected once and the rollover happens once per session. Raising the limit
   via `/handoff-limit` clears `handoffPending` if current usage drops below the new limit.

## Prompts (src/prompts.ts)

- `buildGeneratorPrompt(current, limit)` — forces a ≤1,200-token markdown artifact with
  five fixed sections (Objective, Verified Progress, Negative Constraints, File/Symbol
  Map, Immediate Next Step). The literal marker `# SESSION HANDOFF ARTIFACT` is the
  contract between the generator prompt and the idle-hook detector — keep both in sync.
- `buildResumePrompt(artifact)` — seeds new sessions; instructs scoped reads, trusting
  the artifact, and executing Section 5 immediately.

## Commands

- `/handoff-limit` — registered natively via `ctx.command.transform`; no args shows
  active limits + current occupancy, `<primary> [sub]` sets runtime overrides, `reset`
  clears them, `help` prints usage. Replies via `ctx.session.synthetic` (visible, not
  sent to the model).

## TUI companion (src/tui.tsx)

Watches for sessions titled `Resumed Handoff …`, auto-focuses the new tab, shows a
toast. Keep it in sync if the title format in `src/index.ts` changes.

## Repo layout & commands

```
src/index.ts    server plugin (gate + rollover)
src/config.ts   defaults, file/env/option/runtime precedence
src/prompts.ts  generator + resume prompts (marker contract lives here)
src/tui.tsx     TUI part (tab focus + toast)
tests/          vitest; rollover tests drive real setup() with mock ctx
```

- `bun x tsc --noEmit` must stay clean; `bun x vitest run` must pass before committing.
- Tests assert on exact prompt substrings (including the ` tokens` suffix) — update
  them deliberately, not incidentally.

## Gotchas

- `SessionMessageInfo` is **not** exported from `@opencode/plugin`; use the structural
  types in `index.ts` (`AssistantMessageLike`) and cast `ctx.session.context()` results.
- Message schema is V2 (`type: "assistant"`, `content` parts array). V1-era
  `role`/`parts` field names silently match nothing.
- `/handoff-limit` values ≤ 1000 are ignored (guard against typos like `2k`).
- Config, artifact dir and child-session location are resolved **per session** via
  `resolveWorktree(sessionID)` (session.created event → `ctx.session.get().location.directory`
  → server boot dir → `process.cwd()`). `ctx.location.directory` is the *server's*
  boot location, NOT the session's — a shared `opencode serve` hosts many repos, so
  never use it directly for per-run decisions.
- Install sources: local path, `github:user/repo`, or `git+https://...` in the `plugins`
  array — all resolve to the same package; see README for pinning semantics.

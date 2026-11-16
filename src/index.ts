import { Plugin } from "@opencode/plugin"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type HandoffConfig, loadConfig, runtimeOverrides } from "./config.js"
import {
  buildDeferralNote,
  buildGeneratorPrompt,
  buildGraceWarning,
  buildResumePrompt,
  buildSubagentPriming,
  buildSubagentSummaryPrompt,
} from "./prompts.js"

// Approximate context occupancy from the latest assistant message's prompt-side
// token usage (input + cache read), matching what the model actually sees.
type AssistantMessageLike = {
  type?: string
  tokens?: { input?: number; cache?: { read?: number } }
}

function occupancyFromMessages(messages: readonly unknown[]): number {
  // The assistant message currently being generated has no `tokens` yet, and
  // mid-session compaction can shrink history, so take the MAX over all
  // completed assistant messages instead of only the last one. This slightly
  // overestimates after a compaction, which is the safe direction for a gate.
  let max = 0
  for (const item of messages) {
    const m = item as AssistantMessageLike | undefined
    if (m?.type !== "assistant") continue
    const occupancy = (m.tokens?.input ?? 0) + (m.tokens?.cache?.read ?? 0)
    if (occupancy > max) max = occupancy
  }
  return max
}

// Tool names that change state (files, environment). Anything not matched here
// is treated as read-only for deferral purposes — conservative on both sides:
// bash is classified as mutating, unknown custom tools are read-only.
const MUTATING_TOOL = /^(write|edit|apply_patch|patch|multiedit|notebook.*edit|bash|shell|task|todowrite|todo_write)$/i

// V2 AssistantTool content part (see @opencode/schema session-message):
// { type: "tool", name, state: { status: streaming|running|completed|error, input } }
interface ToolPartLike {
  type?: string
  name?: string
  state?: {
    status?: string
    input?: { todos?: Array<{ status?: string }> }
  }
}

interface MessageLike {
  type?: string
  content?: ToolPartLike[]
}

// A mutation is "in flight" when the assistant message being generated still
// has a non-settled mutating tool part (parallel calls in one turn: a write
// is still running while the gate sees the next call).
function hasInFlightMutation(messages: readonly unknown[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as MessageLike | undefined
    if (m?.type !== "assistant") continue
    for (const part of m.content ?? []) {
      const status = part.state?.status
      if (
        part.type === "tool" &&
        (status === "streaming" || status === "running") &&
        MUTATING_TOOL.test(part.name ?? "")
      ) {
        return true
      }
    }
    break
  }
  return false
}

// Safe boundary from the agent's own todo list: the most recent todo mutation
// (tool name containing "todo", e.g. todowrite) must show every item
// completed. No todo list at all counts as a boundary ("empty").
function todosAtBoundary(messages: readonly unknown[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as MessageLike | undefined
    if (m?.type !== "assistant") continue
    for (const part of m.content ?? []) {
      if (part.type !== "tool" || !/todo/i.test(part.name ?? "")) continue
      const todos = part.state?.input?.todos
      if (todos && todos.length > 0) return todos.every((t) => t.status === "completed")
    }
    break
  }
  return true
}

export default Plugin.define({
  id: "forward-handoff",
  async setup(ctx) {
    const isSubagent = new Map<string, boolean>()
    const handoffPending = new Set<string>()
    const rolloverCompleted = new Set<string>()
    const sessionWorktree = new Map<string, string>()
    const graceWarned = new Set<string>()
    const deferralCount = new Map<string, number>()
    const subagentPrimed = new Set<string>()
    const abortController = new AbortController()

    const getServerWorktree = () =>
      (ctx.location as { directory?: string }).directory ?? process.cwd()

    // A server hosts sessions from many working directories: ctx.location is the
    // server's boot location, NOT the session's. Resolve the session's own
    // directory (cached from the session.created event, else ctx.session.get)
    // so config file, artifact dir and child-session location all follow the run.
    async function resolveWorktree(sessionID: string): Promise<string> {
      const cached = sessionWorktree.get(sessionID)
      if (cached) return cached
      try {
        const info = await ctx.session.get({ sessionID })
        const dir = (info as { location?: { directory?: string } }).location?.directory
        if (dir) {
          sessionWorktree.set(sessionID, dir)
          return dir
        }
      } catch {
        // fall through to the server boot location
      }
      return getServerWorktree()
    }

    const pluginOptions = ctx.options as unknown as Partial<HandoffConfig> | undefined

    // 1. Register /handoff-limit natively (appears automatically in TUI / menu)
    await ctx.command.transform((editor) => {
      editor.add({
        name: "handoff-limit",
        description:
          "View, update, or get help on primary/subagent token limits (defaults: 24000 / 16000)",
        async execute(input) {
          const worktree = await resolveWorktree(input.sessionID)
          const rawText = (input.prompt?.text ?? "").trim()

          // Strip leading "/handoff-limit" if present in prompt text
          const argString = rawText.replace(/^\/?handoff-limit\b/i, "").trim()
          const parts = argString.split(/\s+/).filter(Boolean)
          const firstArg = parts.at(0)?.toLowerCase()
          const secondArg = parts.at(1)

          if (firstArg === "help" || firstArg === "--help" || firstArg === "?") {
            await ctx.session.synthetic({
              sessionID: input.sessionID,
              resume: false,
              text: [
                "[ForwardHandoff] Usage:",
                "  /handoff-limit                  -> Show active limits & current session tokens",
                "  /handoff-limit <primary>        -> Set primary cap (e.g., /handoff-limit 28000)",
                "  /handoff-limit <pri> <sub>      -> Set primary & subagent caps (e.g., 28000 14000)",
                "  /handoff-limit reset            -> Revert to defaults (24000 / 16000) or config file",
                "  /handoff-limit help             -> Show this usage summary",
              ].join("\n"),
            })
            return
          }

          if (firstArg === "reset") {
            delete runtimeOverrides.primaryLimit
            delete runtimeOverrides.subagentLimit
            graceWarned.delete(input.sessionID)
            deferralCount.delete(input.sessionID)
            const fresh = loadConfig(worktree, pluginOptions)
            await ctx.session.synthetic({
              sessionID: input.sessionID,
              resume: false,
              text: `[ForwardHandoff] Runtime overrides cleared. Active limits -> Primary: ${fresh.primaryLimit}, Subagent: ${fresh.subagentLimit}`,
            })
            return
          }

          if (firstArg) {
            const newPrimary = Number(firstArg)
            if (!Number.isNaN(newPrimary) && newPrimary > 1000) {
              runtimeOverrides.primaryLimit = newPrimary
            }
          }

          if (secondArg) {
            const newSubagent = Number(secondArg)
            if (!Number.isNaN(newSubagent) && newSubagent > 1000) {
              runtimeOverrides.subagentLimit = newSubagent
            }
          }

          const updated = loadConfig(worktree, pluginOptions)
          const currentUsage = occupancyFromMessages(
            await ctx.session.context({ sessionID: input.sessionID })
          )
          const activeLimit = isSubagent.get(input.sessionID)
            ? updated.subagentLimit
            : updated.primaryLimit

          if (currentUsage < activeLimit) {
            handoffPending.delete(input.sessionID)
          }

          await ctx.session.synthetic({
            sessionID: input.sessionID,
            resume: false,
            text: `[ForwardHandoff] Active Limits -> Primary: ${updated.primaryLimit} tokens | Subagent: ${updated.subagentLimit} tokens (Current session: ${currentUsage} tokens)`,
          })
        },
      })
    })

    // 2. Track session hierarchy via event stream
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe()) {
          if (abortController.signal.aborted) break

          if (event.type === "session.created") {
            const sessionID = event.data.sessionID
            isSubagent.set(sessionID, Boolean(event.data.parentID))
            const dir = (event.data as { location?: { directory?: string } }).location?.directory
            if (dir) sessionWorktree.set(sessionID, dir)
          }

          if (event.type === "session.deleted") {
            const id = event.data.sessionID
            isSubagent.delete(id)
            handoffPending.delete(id)
            rolloverCompleted.delete(id)
            sessionWorktree.delete(id)
            graceWarned.delete(id)
            deferralCount.delete(id)
            subagentPrimed.delete(id)
          }
        }
      } catch {
        // Ignore stream shutdown on plugin cleanup
      }
    })()

    // 3. Prime sub-agents with the relay contract on their first prompt: their
    //    final message is the parent's only copy AND stays resident in the
    //    parent's re-sent context, so pinning a compact ≤300-token report
    //    format up front keeps every parent turn cheaper — even if the gate
    //    never fires. Riding the first prompt itself adds no extra message.
    await ctx.session.hook("prompt", async (input) => {
      if (subagentPrimed.has(input.sessionID)) return
      let subagent = isSubagent.get(input.sessionID)
      if (subagent === undefined) {
        // session.created may not have been consumed yet; resolve directly.
        try {
          const info = await ctx.session.get({ sessionID: input.sessionID })
          subagent = Boolean((info as { parentID?: string }).parentID)
        } catch {
          return
        }
        isSubagent.set(input.sessionID, subagent)
      }
      if (!subagent) return
      subagentPrimed.add(input.sessionID)

      const cfg = loadConfig(await resolveWorktree(input.sessionID), pluginOptions)
      if (!cfg.subagentPriming) return
      input.prompt.text += buildSubagentPriming(cfg.subagentLimit + cfg.subagentGraceTokens)
    })

    // 4. Auto-rollover when an outgoing primary session finishes generating its artifact
    await ctx.session.hook("experimental.idle", async (input) => {
      const sessionID = input.sessionID
      if (!handoffPending.has(sessionID) || rolloverCompleted.has(sessionID)) return

      if (isSubagent.get(sessionID)) {
        rolloverCompleted.add(sessionID)
        return
      }

      const worktree = await resolveWorktree(sessionID)
      const cfg = loadConfig(worktree, pluginOptions)
      const messages = await ctx.session.context({ sessionID })

      const lastAssistant = [...messages]
        .reverse()
        .find((m) => (m as { type?: string }).type === "assistant")

      const content =
        (lastAssistant as { content?: Array<{ type?: string; text?: string }> })?.content ?? []
      const artifactText = content
        .filter((c) => c.type === "text" && typeof c.text === "string")
        .map((c) => c.text)
        .join("\n")
        .trim()

      if (artifactText && artifactText.includes("# SESSION HANDOFF ARTIFACT")) {
        rolloverCompleted.add(sessionID)

        if (cfg.saveArtifactsDir) {
          const outDir = join(worktree, cfg.saveArtifactsDir)
          mkdirSync(outDir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[:.]/g, "-")
          writeFileSync(join(outDir, `handoff-${stamp}.md`), artifactText, "utf-8")
        }

        if (cfg.autoRollover) {
          const newSession = await ctx.session.create({
            title: `Resumed Handoff (${new Date().toLocaleTimeString()})`,
            location: { directory: worktree },
          })

          if (newSession?.id) {
            await ctx.session.prompt({
              sessionID: newSession.id,
              text: buildResumePrompt(artifactText),
            })
          }
        }
      }
    })

    // 4. Gate tool execution on the session's context budget. Both session
    //    kinds use three bands (subagents with subagentGraceTokens = 0 keep
    //    the original single-threshold behaviour):
    //      < softLimit              -> allow
    //      [softLimit, hardLimit)   -> grace band: warn once, keep working
    //      >= hardLimit             -> hard gate: force handoff, unless the
    //                                  session sits at a safe boundary (no
    //                                  in-flight mutation, todos all done) and
    //                                  the call is read-only → defer (bounded)
    //    A subagent's hard gate fires the relay-summary prompt instead of the
    //    full artifact generator — subagents never roll over to a new session.
    await ctx.tool.hook("execute.before", async (input) => {
      const worktree = await resolveWorktree(input.sessionID)
      const cfg = loadConfig(worktree, pluginOptions)
      const ctxMsgs = await ctx.session.context({ sessionID: input.sessionID })
      const currentTokens = occupancyFromMessages(ctxMsgs)
      const subagent = isSubagent.get(input.sessionID) ?? false
      const grace = subagent ? cfg.subagentGraceTokens : cfg.graceTokens
      const softLimit = subagent ? cfg.subagentLimit : cfg.primaryLimit
      const hardLimit = softLimit + grace

      if (process.env.OPENCODE_HANDOFF_DEBUG) {
        console.error(
          `[handoff-debug] session=${input.sessionID} tool=${input.tool} occupancy=${currentTokens} ` +
            `soft=${softLimit} hard=${hardLimit} gate=${
              currentTokens < softLimit ? "pass" : currentTokens < hardLimit ? "grace" : "FIRE"
            } msgcount=${ctxMsgs.length}`
        )
      }

      if (currentTokens < softLimit) {
        graceWarned.delete(input.sessionID)
        deferralCount.delete(input.sessionID)
        return
      }

      // Grace band: nudge the model to wind down but do not block yet, so the
      // unit of work in progress can finish cleanly instead of being cut off.
      // Empty band (grace = 0) falls straight through to the hard gate.
      if (currentTokens < hardLimit) {
        if (!graceWarned.has(input.sessionID)) {
          graceWarned.add(input.sessionID)
          await ctx.session.synthetic({
            sessionID: input.sessionID,
            resume: false,
            text: buildGraceWarning(currentTokens, softLimit, hardLimit, subagent),
          })
        }
        return
      }

      // Hard gate. Optionally defer while the session is at a safe boundary.
      if (cfg.deferAtSafeBoundary && !MUTATING_TOOL.test(input.tool)) {
        const boundary = !hasInFlightMutation(ctxMsgs) && todosAtBoundary(ctxMsgs)
        const deferred = deferralCount.get(input.sessionID) ?? 0
        if (boundary && deferred < cfg.maxDeferrals) {
          deferralCount.set(input.sessionID, deferred + 1)
          if (deferred === 0) {
            await ctx.session.synthetic({
              sessionID: input.sessionID,
              resume: false,
              text: buildDeferralNote(currentTokens, hardLimit, subagent),
            })
          }
          return
        }
      }

      if (!handoffPending.has(input.sessionID)) {
        handoffPending.add(input.sessionID)
        // Subagents get the compact relay contract (their final message is the
        // parent's only copy and stays resident in its context); primaries get
        // the full handoff-artifact generator.
        const promptText = subagent
          ? buildSubagentSummaryPrompt(currentTokens, softLimit)
          : buildGeneratorPrompt(currentTokens, softLimit)

        await ctx.session.prompt({
          sessionID: input.sessionID,
          text: promptText,
        })
      }

      throw new Error(
        `Context cap (${currentTokens}/${softLimit} tokens) reached. Tool "${input.tool}" blocked—` +
          (subagent ? "emit your relay summary now." : "emit your handoff summary now.")
      )
    })

    return () => {
      abortController.abort()
    }
  },
})

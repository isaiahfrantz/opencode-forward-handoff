import { Plugin } from "@opencode/plugin"
import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { type HandoffConfig, loadConfig, runtimeOverrides } from "./config.js"
import { buildGeneratorPrompt, buildResumePrompt } from "./prompts.js"

// Approximate context occupancy from the latest assistant message's prompt-side
// token usage (input + cache read), matching what the model actually sees.
type AssistantMessageLike = {
  type?: string
  tokens?: { input?: number; cache?: { read?: number } }
}

function occupancyFromMessages(messages: readonly unknown[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as AssistantMessageLike | undefined
    if (m?.type === "assistant") {
      return (m.tokens?.input ?? 0) + (m.tokens?.cache?.read ?? 0)
    }
  }
  return 0
}

export default Plugin.define({
  id: "forward-handoff",
  async setup(ctx) {
    const isSubagent = new Map<string, boolean>()
    const handoffPending = new Set<string>()
    const rolloverCompleted = new Set<string>()
    const abortController = new AbortController()

    const getWorktree = () =>
      (ctx.location as { directory?: string }).directory ?? process.cwd()

    const pluginOptions = ctx.options as unknown as Partial<HandoffConfig> | undefined

    // 1. Register /handoff-limit natively (appears automatically in TUI / menu)
    await ctx.command.transform((editor) => {
      editor.add({
        name: "handoff-limit",
        description:
          "View, update, or get help on primary/subagent token limits (defaults: 24000 / 16000)",
        async execute(input) {
          const worktree = getWorktree()
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
          }

          if (event.type === "session.deleted") {
            const id = event.data.sessionID
            isSubagent.delete(id)
            handoffPending.delete(id)
            rolloverCompleted.delete(id)
          }
        }
      } catch {
        // Ignore stream shutdown on plugin cleanup
      }
    })()

    // 3. Auto-rollover when an outgoing primary session finishes generating its artifact
    await ctx.session.hook("experimental.idle", async (input) => {
      const sessionID = input.sessionID
      if (!handoffPending.has(sessionID) || rolloverCompleted.has(sessionID)) return

      if (isSubagent.get(sessionID)) {
        rolloverCompleted.add(sessionID)
        return
      }

      const worktree = getWorktree()
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

    // 4. Block tools when active session reaches its configured token limit
    await ctx.tool.hook("execute.before", async (input) => {
      const cfg = loadConfig(getWorktree(), pluginOptions)
      const currentTokens = occupancyFromMessages(
        await ctx.session.context({ sessionID: input.sessionID })
      )
      const subagent = isSubagent.get(input.sessionID) ?? false
      const limit = subagent ? cfg.subagentLimit : cfg.primaryLimit

      if (currentTokens < limit) return

      if (!handoffPending.has(input.sessionID)) {
        handoffPending.add(input.sessionID)
        const promptText = subagent
          ? `SUBAGENT CONTEXT LIMIT REACHED (${currentTokens}/${limit} tokens). Halt all tool calls immediately and return a concise summary (<400 tokens) of verified changes, failed attempts, and remaining steps to the parent agent.`
          : buildGeneratorPrompt(currentTokens, limit)

        await ctx.session.prompt({
          sessionID: input.sessionID,
          text: promptText,
        })
      }

      throw new Error(
        `Context cap (${currentTokens}/${limit} tokens) reached. Tool "${input.tool}" blocked—emit your handoff summary now.`
      )
    })

    return () => {
      abortController.abort()
    }
  },
})

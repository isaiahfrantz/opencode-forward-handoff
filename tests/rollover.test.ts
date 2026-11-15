import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import handoffPlugin from "../src/index.js"
import { runtimeOverrides } from "../src/config.js"

const ARTIFACT = [
  "# SESSION HANDOFF ARTIFACT",
  "",
  "## 1. Primary Objective & Acceptance Criteria",
  "- **Goal:** Verify rollover end-to-end",
].join("\n")

type PromptCall = { sessionID: string; text: string }

// Mirrors the v2 message schema: type + tokens + content parts.
function assistantMessage(input: number, cacheRead: number, text = "") {
  return {
    type: "assistant",
    tokens: { input, cache: { read: cacheRead } },
    content: text ? [{ type: "text", text }] : [],
  }
}

let sandbox: string
let realHome: string | undefined

beforeEach(() => {
  sandbox = mkdtempSync(join("/tmp/opencode", "handoff-e2e-"))
  realHome = process.env.HOME
  process.env.HOME = join(sandbox, "home") // isolate from user config
  delete process.env.OPENCODE_PRIMARY_LIMIT
  delete process.env.OPENCODE_SUBAGENT_LIMIT
  delete runtimeOverrides.primaryLimit
  delete runtimeOverrides.subagentLimit

  mkdirSync(join(sandbox, ".opencode"), { recursive: true })
  writeFileSync(
    join(sandbox, ".opencode", "handoff.json"),
    JSON.stringify({
      primaryLimit: 5_000,
      subagentLimit: 2_000,
      autoRollover: true,
      saveArtifactsDir: ".opencode/handoffs",
    })
  )
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  delete runtimeOverrides.primaryLimit
  delete runtimeOverrides.subagentLimit
})

async function startPlugin(events: unknown[] = [], sessionDirs: Record<string, string> = {}) {
  const state = {
    messages: [] as unknown[],
    prompts: [] as PromptCall[],
    created: [] as { title?: string; location?: { directory?: string } }[],
  }
  const hooks: Record<string, (input: any) => Promise<unknown>> = {}

  const ctx = {
    location: { directory: sandbox },
    options: undefined,
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    event: { subscribe: () => events },
    session: {
      hook: async (name: string, handler: any) => {
        hooks[name] = handler
      },
      get: async (input: { sessionID: string }) => {
        const dir = sessionDirs[input.sessionID]
        if (!dir) throw new Error("SessionNotFoundError")
        return { id: input.sessionID, location: { directory: dir } }
      },
      context: async () => state.messages,
      prompt: async (input: PromptCall) => {
        state.prompts.push(input)
      },
      create: async (input: { title?: string }) => {
        state.created.push(input)
        return { id: "ses_new" }
      },
      synthetic: async (_input: PromptCall) => {},
    },
    tool: {
      hook: async (name: string, handler: any) => {
        hooks[`tool.${name}`] = handler
      },
    },
  }

  const cleanup = await handoffPlugin.setup(ctx as any)
  await new Promise((resolve) => setImmediate(resolve)) // let the event loop drain
  return { state, hooks, cleanup }
}

describe("forward-handoff rollover (end-to-end)", () => {
  it("blocks at limit, injects generator prompt once, then saves artifact and rolls over on idle", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!
    const idleHook = hooks["experimental.idle"]!

    // Under limit: occupancy = last assistant message input + cache read (1200 < 5000)
    state.messages = [assistantMessage(1_000, 200)]
    await expect(toolHook({ sessionID: "ses_primary", tool: "shell" })).resolves.toBeUndefined()
    expect(state.prompts).toHaveLength(0)

    // Over limit: only the LATEST assistant message counts (3000 + 4000 = 7000 > 5000)
    state.messages = [assistantMessage(1_000, 200), assistantMessage(3_000, 4_000)]
    await expect(toolHook({ sessionID: "ses_primary", tool: "shell" })).rejects.toThrow(
      /Context cap \(7000\/5000/
    )
    expect(state.prompts).toHaveLength(1)
    expect(state.prompts[0].sessionID).toBe("ses_primary")
    expect(state.prompts[0].text).toContain("CONTEXT BUDGET REACHED (7000/5000 tokens)")
    expect(state.prompts[0].text).toContain("# SESSION HANDOFF ARTIFACT")

    // Blocked again, but the handoff prompt is not injected twice
    await expect(toolHook({ sessionID: "ses_primary", tool: "shell" })).rejects.toThrow()
    expect(state.prompts).toHaveLength(1)

    // Session emits the artifact -> idle hook saves it and starts the resumed session
    state.messages = [assistantMessage(3_000, 4_000, ARTIFACT)]
    await idleHook({ sessionID: "ses_primary" })

    const dir = join(sandbox, ".opencode", "handoffs")
    const files = readdirSync(dir)
    expect(files).toHaveLength(1)
    expect(readFileSync(join(dir, files[0]), "utf-8")).toContain("# SESSION HANDOFF ARTIFACT")

    expect(state.created).toHaveLength(1)
    const resumed = state.prompts.find((p) => p.sessionID === "ses_new")
    expect(resumed?.text).toContain("You are resuming an in-progress engineering task")
    expect(resumed?.text).toContain("# SESSION HANDOFF ARTIFACT")

    // Idempotent: a second idle does not roll over again
    await idleHook({ sessionID: "ses_primary" })
    expect(state.created).toHaveLength(1)

    await cleanup?.()
  })

  it("subagent sessions get the summary prompt and never roll over", async () => {
    const { state, hooks, cleanup } = await startPlugin([
      { type: "session.created", data: { sessionID: "ses_sub", parentID: "ses_primary" } },
    ])

    // 2500 tokens exceeds the subagent limit (2000), not the primary limit
    state.messages = [assistantMessage(2_500, 0)]
    await expect(hooks["tool.execute.before"]!({ sessionID: "ses_sub", tool: "shell" })).rejects.toThrow(
      /2500\/2000/
    )
    expect(state.prompts[0].text).toContain("SUBAGENT CONTEXT LIMIT REACHED (2500/2000 tokens)")

    await hooks["experimental.idle"]!({ sessionID: "ses_sub" })
    expect(state.created).toHaveLength(0)

    await cleanup?.()
  })

  it("idle without a handoff artifact does not roll over", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    state.messages = [assistantMessage(9_000, 0, "just a normal reply")]
    await hooks["experimental.idle"]!({ sessionID: "ses_primary" })
    expect(state.created).toHaveLength(0)

    await cleanup?.()
  })

  it("resolves config, artifacts and child location per session, not per server", async () => {
    // Server boots in `sandbox` (limit 5000); the session actually works in
    // `repo2` (limit 3000). The gate, artifact dir and child session must all
    // follow the session, never the server's boot location.
    const repo2 = join(sandbox, "repo2")
    mkdirSync(join(repo2, ".opencode"), { recursive: true })
    writeFileSync(
      join(repo2, ".opencode", "handoff.json"),
      JSON.stringify({
        primaryLimit: 3_000,
        autoRollover: true,
        saveArtifactsDir: ".opencode/handoffs",
      })
    )

    // ses_event learns its directory from the session.created event;
    // ses_fetch only via the ctx.session.get fallback.
    const { state, hooks, cleanup } = await startPlugin(
      [
        {
          type: "session.created",
          data: { sessionID: "ses_event", location: { directory: repo2 } },
        },
      ],
      { ses_fetch: repo2 }
    )

    // 3500 tokens: under the server's 5000, over repo2's 3000 -> must block.
    state.messages = [assistantMessage(3_500, 0)]
    await expect(
      hooks["tool.execute.before"]!({ sessionID: "ses_event", tool: "shell" })
    ).rejects.toThrow(/3500\/3000/)
    await expect(
      hooks["tool.execute.before"]!({ sessionID: "ses_fetch", tool: "shell" })
    ).rejects.toThrow(/3500\/3000/)

    // Artifact lands in the session's repo; the child inherits its location.
    state.messages = [assistantMessage(3_500, 0, ARTIFACT)]
    await hooks["experimental.idle"]!({ sessionID: "ses_event" })

    const files = readdirSync(join(repo2, ".opencode", "handoffs"))
    expect(files).toHaveLength(1)
    expect(state.created).toHaveLength(1)
    expect(state.created[0].location?.directory).toBe(repo2)
    expect(existsSync(join(sandbox, ".opencode", "handoffs"))).toBe(false)

    await cleanup?.()
  })
})

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

// Assistant message carrying raw content parts (tool calls with state).
function assistantWithParts(input: number, cacheRead: number, parts: unknown[]) {
  return {
    type: "assistant",
    tokens: { input, cache: { read: cacheRead } },
    content: parts,
  }
}

function toolPart(name: string, status: string, todoStatuses?: string[]) {
  return {
    type: "tool",
    name,
    state: {
      status,
      ...(todoStatuses
        ? { input: { todos: todoStatuses.map((s) => ({ status: s })) } }
        : {}),
    },
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

async function startPlugin(
  events: unknown[] = [],
  sessionDirs: Record<string, string> = {},
  sessionParents: Record<string, string> = {}
) {
  const state = {
    messages: [] as unknown[],
    prompts: [] as PromptCall[],
    synthetics: [] as PromptCall[],
    created: [] as { title?: string; location?: { directory?: string } }[],
    promptTexts: {} as Record<string, string>,
  }
  const hooks: Record<string, (input: any) => Promise<unknown>> = {}

  const ctx = {
    location: { directory: sandbox },
    options: undefined,
    command: { transform: async (fn: any) => fn({ add: () => {} }) },
    event: { subscribe: () => events },
    session: {
      hook: async (name: string, handler: any) => {
        if (name === "prompt") {
          // record the post-hook prompt text so tests can assert priming
          hooks[name] = async (input: any) => {
            await handler(input)
            state.promptTexts[input.sessionID] = input.prompt.text
          }
        } else {
          hooks[name] = handler
        }
      },
      get: async (input: { sessionID: string }) => {
        const dir = sessionDirs[input.sessionID] ?? sandbox
        const parentID = sessionParents[input.sessionID]
        if (!sessionDirs[input.sessionID] && parentID === undefined)
          throw new Error("SessionNotFoundError")
        return { id: input.sessionID, parentID, location: { directory: dir } }
      },
      context: async () => state.messages,
      prompt: async (input: PromptCall) => {
        state.prompts.push(input)
      },
      create: async (input: { title?: string }) => {
        state.created.push(input)
        return { id: "ses_new" }
      },
      synthetic: async (input: PromptCall) => {
        state.synthetics.push(input)
      },
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

    // Over the HARD gate (primaryLimit 5000 + graceTokens 4000 = 9000):
    // occupancy = max over completed assistant messages (5000 + 4500 = 9500)
    state.messages = [assistantMessage(1_000, 200), assistantMessage(5_000, 4_500)]
    await expect(toolHook({ sessionID: "ses_primary", tool: "shell" })).rejects.toThrow(
      /Context cap \(9500\/5000/
    )
    expect(state.prompts).toHaveLength(1)
    expect(state.prompts[0].sessionID).toBe("ses_primary")
    expect(state.prompts[0].text).toContain("CONTEXT BUDGET REACHED (9500/5000 tokens)")
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

  it("counts occupancy even when the latest assistant message is still streaming (no tokens field)", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!

    // Real runtime shape from ctx.session.context(): the assistant message being
    // generated has no `tokens` yet. The gate must fall back to the last
    // COMPLETED assistant message instead of reading 0. (9500 ≥ hard gate 9000)
    state.messages = [
      assistantMessage(5_000, 4_500),
      { type: "assistant", content: [] }, // in-flight message, tokens === undefined
    ]
    await expect(toolHook({ sessionID: "ses_primary", tool: "shell" })).rejects.toThrow(
      /Context cap \(9500\/5000/
    )
    expect(state.prompts).toHaveLength(1)

    await cleanup?.()
  })

  it("subagent sessions get the summary prompt and never roll over", async () => {
    const { state, hooks, cleanup } = await startPlugin([
      { type: "session.created", data: { sessionID: "ses_sub", parentID: "ses_primary" } },
    ])

    // 2500 is inside the subagent grace band (2000-4000): allowed with nudge
    state.messages = [assistantMessage(2_500, 0)]
    await hooks["tool.execute.before"]!({ sessionID: "ses_sub", tool: "shell" })
    expect(state.prompts).toHaveLength(0)
    expect(state.synthetics).toHaveLength(1)
    expect(state.synthetics[0].text).toContain("CONTEXT APPROACHING LIMIT")

    // 4500 exceeds the subagent hard gate (2000+2000), not the primary limit
    state.messages = [assistantMessage(4_500, 0)]
    await expect(hooks["tool.execute.before"]!({ sessionID: "ses_sub", tool: "shell" })).rejects.toThrow(
      /4500\/2000/
    )
    expect(state.prompts[0].text).toContain("SUBAGENT CONTEXT LIMIT REACHED (4500/2000 tokens)")

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

    // 7500 tokens: under the server's hard gate (5000+4000=9000), over repo2's
    // hard gate (3000+4000=7000) -> must block, following the session not server.
    state.messages = [assistantMessage(7_500, 0)]
    await expect(
      hooks["tool.execute.before"]!({ sessionID: "ses_event", tool: "shell" })
    ).rejects.toThrow(/7500\/3000/)
    await expect(
      hooks["tool.execute.before"]!({ sessionID: "ses_fetch", tool: "shell" })
    ).rejects.toThrow(/7500\/3000/)

    // Artifact lands in the session's repo; the child inherits its location.
    state.messages = [assistantMessage(7_500, 0, ARTIFACT)]
    await hooks["experimental.idle"]!({ sessionID: "ses_event" })

    const files = readdirSync(join(repo2, ".opencode", "handoffs"))
    expect(files).toHaveLength(1)
    expect(state.created).toHaveLength(1)
    expect(state.created[0].location?.directory).toBe(repo2)
    expect(existsSync(join(sandbox, ".opencode", "handoffs"))).toBe(false)

    await cleanup?.()
  })

  it("grace band: warns once and keeps all tools allowed below the hard gate", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!

    // soft 5000, hard 5000 + 4000 = 9000; occupancy 7000 sits inside the band
    state.messages = [assistantMessage(5_000, 2_000)]
    await expect(toolHook({ sessionID: "ses_primary", tool: "read" })).resolves.toBeUndefined()
    await expect(toolHook({ sessionID: "ses_primary", tool: "edit" })).resolves.toBeUndefined()
    expect(state.prompts).toHaveLength(0) // no handoff prompt yet

    expect(state.synthetics).toHaveLength(1)
    expect(state.synthetics[0].sessionID).toBe("ses_primary")
    expect(state.synthetics[0].text).toContain("CONTEXT APPROACHING LIMIT (7000/9000")
    expect(state.synthetics[0].text).toContain("soft limit 5000")

    // the nudge fires only once per session
    await toolHook({ sessionID: "ses_primary", tool: "read" })
    expect(state.synthetics).toHaveLength(1)

    await cleanup?.()
  })

  it("grace state resets when occupancy drops back below the soft limit", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!

    state.messages = [assistantMessage(5_000, 2_000)] // 7000: grace band
    await toolHook({ sessionID: "ses_primary", tool: "read" })
    expect(state.synthetics).toHaveLength(1)

    state.messages = [assistantMessage(1_000, 0)] // 1000: back below soft limit
    await toolHook({ sessionID: "ses_primary", tool: "read" })
    expect(state.synthetics).toHaveLength(1)

    state.messages = [assistantMessage(5_000, 2_500)] // 7500: grace band again
    await toolHook({ sessionID: "ses_primary", tool: "read" })
    expect(state.synthetics).toHaveLength(2) // re-warned

    await cleanup?.()
  })

  it("hard gate defers read-only calls at a safe boundary and forces on the next mutation", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!

    // occupancy 9500 ≥ hard 9000; no todo list → safe boundary
    state.messages = [assistantMessage(9_000, 500)]
    await expect(toolHook({ sessionID: "ses_primary", tool: "read" })).resolves.toBeUndefined()
    expect(state.prompts).toHaveLength(0)
    expect(state.synthetics).toHaveLength(1)
    expect(state.synthetics[0].text).toContain("handoff deferred")
    expect(state.synthetics[0].text).toContain("9500/9000")

    // more read-only calls keep being deferred, note is not repeated
    await expect(toolHook({ sessionID: "ses_primary", tool: "grep" })).resolves.toBeUndefined()
    expect(state.synthetics).toHaveLength(1)

    // the next state-changing step forces the handoff
    await expect(toolHook({ sessionID: "ses_primary", tool: "edit" })).rejects.toThrow(
      /Context cap \(9500\/5000/
    )
    expect(state.prompts).toHaveLength(1)
    expect(state.prompts[0].text).toContain("CONTEXT BUDGET REACHED (9500/5000 tokens)")

    await cleanup?.()
  })

  it("deferral requires a safe boundary: in-flight mutation or open todos force the gate", async () => {
    const { state, hooks, cleanup } = await startPlugin()
    const toolHook = hooks["tool.execute.before"]!

    // mutating tool still running while the gate sees the next (read-only) call
    state.messages = [
      assistantWithParts(9_000, 500, [toolPart("write", "running")]),
    ]
    await expect(toolHook({ sessionID: "ses_primary", tool: "read" })).rejects.toThrow(
      /Context cap \(9500\/5000/
    )
    expect(state.prompts).toHaveLength(1)
    expect(state.synthetics).toHaveLength(0)

    // settled mutation but an unfinished todo list → not a boundary
    const { state: s2, hooks: h2, cleanup: c2 } = await startPlugin()
    s2.messages = [
      assistantWithParts(9_000, 500, [
        toolPart("write", "completed"),
        toolPart("todowrite", "completed", ["completed", "in_progress"]),
      ]),
    ]
    await expect(h2["tool.execute.before"]!({ sessionID: "ses_primary", tool: "read" })).rejects.toThrow(
      /Context cap \(9500\/5000/
    )

    // all todos completed → boundary again, deferral applies
    s2.messages = [
      assistantWithParts(9_000, 500, [
        toolPart("write", "completed"),
        toolPart("todowrite", "completed", ["completed", "completed"]),
      ]),
    ]
    await expect(h2["tool.execute.before"]!({ sessionID: "ses_primary", tool: "read" })).resolves.toBeUndefined()
    expect(s2.prompts).toHaveLength(1) // no additional handoff prompt

    await cleanup?.()
    await c2?.()
  })

  it("deferral budget is bounded: after maxDeferrals the gate forces even read-only calls", async () => {
    // repo config: maxDeferrals 2 via the session's handoff.json
    const repo3 = join(sandbox, "repo3")
    mkdirSync(join(repo3, ".opencode"), { recursive: true })
    writeFileSync(
      join(repo3, ".opencode", "handoff.json"),
      JSON.stringify({
        primaryLimit: 5_000,
        graceTokens: 0,
        maxDeferrals: 2,
        autoRollover: true,
        saveArtifactsDir: ".opencode/handoffs",
      })
    )
    const { state, hooks, cleanup } = await startPlugin([], { ses_budget: repo3 })
    const toolHook = hooks["tool.execute.before"]!

    // graceTokens 0 → hard gate is exactly 5000; occupancy 6000, safe boundary
    state.messages = [assistantMessage(6_000, 0)]
    await expect(toolHook({ sessionID: "ses_budget", tool: "read" })).resolves.toBeUndefined()
    await expect(toolHook({ sessionID: "ses_budget", tool: "read" })).resolves.toBeUndefined()
    expect(state.synthetics).toHaveLength(1) // one deferral note

    // 3rd deferral exceeds maxDeferrals=2 → forced handoff
    await expect(toolHook({ sessionID: "ses_budget", tool: "read" })).rejects.toThrow(
      /Context cap \(6000\/5000/
    )
    expect(state.prompts).toHaveLength(1)

    await cleanup?.()
  })

  it("subagent hard gate defers at a safe boundary and forces at the next mutating step", async () => {
    const { state, hooks, cleanup } = await startPlugin([
      { type: "session.created", data: { sessionID: "ses_sub", parentID: "ses_primary" } },
    ])
    const toolHook = hooks["tool.execute.before"]!

    // Hard gate is 2000+2000=4000. Occupancy 4500 over a read-only step with no
    // in-flight mutation defers like a primary session.
    state.messages = [assistantMessage(4_500, 0, undefined, [toolPart("read", "completed")])]
    await toolHook({ sessionID: "ses_sub", tool: "read" })
    expect(state.prompts).toHaveLength(0)
    expect(state.synthetics.some((p: { text: string }) => p.text.includes("handoff deferred"))).toBe(
      true
    )

    // A mutating step is not a safe boundary: forced relay summary. Read-only
    // tools are excluded from deferral to prevent an infinite deferral loop.
    await expect(toolHook({ sessionID: "ses_sub", tool: "edit" })).rejects.toThrow(/Context cap/)
    expect(state.prompts[0].text).toContain("SUBAGENT CONTEXT LIMIT REACHED")

    await cleanup?.()
  })

  it("subagentGraceTokens: 0 restores the original single-threshold behavior", async () => {
    writeFileSync(
      join(sandbox, ".opencode", "handoff.json"),
      JSON.stringify({ primaryLimit: 5_000, subagentLimit: 2_000, subagentGraceTokens: 0 })
    )
    const { state, hooks, cleanup } = await startPlugin([
      { type: "session.created", data: { sessionID: "ses_sub", parentID: "ses_primary" } },
    ])

    // Hard gate is just subagentLimit (2000): a mutating step at 2500 — which
    // the default grace band would have allowed — fires immediately.
    state.messages = [assistantMessage(2_500, 0)]
    await expect(hooks["tool.execute.before"]!({ sessionID: "ses_sub", tool: "write" })).rejects.toThrow(
      /2500\/2000/
    )
    expect(state.prompts[0].text).toContain("SUBAGENT CONTEXT LIMIT REACHED (2500/2000 tokens)")
    expect(state.synthetics).toHaveLength(0) // no grace/deferral nudges

    await cleanup?.()
  })

  it("first sub-agent prompt is primed with the relay contract (and only once)", async () => {
    const { state, hooks, cleanup } = await startPlugin([], {}, { ses_sub: "ses_primary" })
    const promptHook = hooks["prompt"]!

    await promptHook({ sessionID: "ses_sub", prompt: { text: "Audit module alpha." } })
    expect(state.promptTexts["ses_sub"]).toContain("[handoff] Context budget")
    expect(state.promptTexts["ses_sub"]).toContain("cut off near 4000 tokens") // 2000 limit + 2000 grace
    expect(state.promptTexts["ses_sub"]).toContain("relay schema")
    expect(state.promptTexts["ses_sub"]).toContain("TASK:")
    expect(state.promptTexts["ses_sub"]).toContain("NEXT:")

    await promptHook({ sessionID: "ses_sub", prompt: { text: "Continue." } })
    expect(state.promptTexts["ses_sub"]).toBe("Continue.") // primed once per session

    // Primary sessions are never primed
    await promptHook({ sessionID: "ses_primary", prompt: { text: "Hello." } })
    expect(state.promptTexts["ses_primary"]).toBe("Hello.")

    await cleanup?.()
  })

  it("subagentPriming: false leaves the first prompt untouched", async () => {
    writeFileSync(
      join(sandbox, ".opencode", "handoff.json"),
      JSON.stringify({ primaryLimit: 5_000, subagentLimit: 2_000, subagentPriming: false })
    )
    const { state, hooks, cleanup } = await startPlugin([], {}, { ses_sub: "ses_primary" })
    await hooks["prompt"]!({ sessionID: "ses_sub", prompt: { text: "Audit module alpha." } })
    expect(state.promptTexts["ses_sub"]).toBe("Audit module alpha.")

    await cleanup?.()
  })
})

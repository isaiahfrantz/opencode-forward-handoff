import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadConfig, PLUGIN_DEFAULTS, runtimeOverrides } from "../src/config.js"

// Isolate tests from the developer's real ~/.config/opencode/handoff.json by
// pointing HOME at an empty temp dir, and from ambient env overrides.
const realHome = process.env.HOME
const realPrimary = process.env.OPENCODE_PRIMARY_LIMIT
const realSubagent = process.env.OPENCODE_SUBAGENT_LIMIT

let sandbox: string

beforeEach(() => {
  sandbox = mkdtempSync(join("/tmp/opencode", "handoff-test-"))
  process.env.HOME = join(sandbox, "home") // does not exist -> no user config
  delete process.env.OPENCODE_PRIMARY_LIMIT
  delete process.env.OPENCODE_SUBAGENT_LIMIT
  delete runtimeOverrides.primaryLimit
  delete runtimeOverrides.subagentLimit
})

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true })
  process.env.HOME = realHome
  if (realPrimary === undefined) delete process.env.OPENCODE_PRIMARY_LIMIT
  else process.env.OPENCODE_PRIMARY_LIMIT = realPrimary
  if (realSubagent === undefined) delete process.env.OPENCODE_SUBAGENT_LIMIT
  else process.env.OPENCODE_SUBAGENT_LIMIT = realSubagent
  delete runtimeOverrides.primaryLimit
  delete runtimeOverrides.subagentLimit
})

describe("loadConfig", () => {
  it("returns plugin defaults when nothing else is set", () => {
    const cfg = loadConfig(sandbox)
    expect(cfg).toEqual(PLUGIN_DEFAULTS)
  })

  it("plugin options override defaults", () => {
    const cfg = loadConfig(sandbox, { primaryLimit: 30_000 })
    expect(cfg.primaryLimit).toBe(30_000)
    expect(cfg.subagentLimit).toBe(PLUGIN_DEFAULTS.subagentLimit)
  })

  it("env vars override plugin options", () => {
    process.env.OPENCODE_PRIMARY_LIMIT = "40000"
    process.env.OPENCODE_SUBAGENT_LIMIT = "20000"
    const cfg = loadConfig(sandbox, { primaryLimit: 30_000, subagentLimit: 15_000 })
    expect(cfg.primaryLimit).toBe(40_000)
    expect(cfg.subagentLimit).toBe(20_000)
  })

  it("worktree config file overrides env vars", () => {
    mkdirSync(join(sandbox, ".opencode"), { recursive: true })
    writeFileSync(
      join(sandbox, ".opencode", "handoff.json"),
      JSON.stringify({ primaryLimit: 50_000 })
    )
    process.env.OPENCODE_PRIMARY_LIMIT = "40000"
    const cfg = loadConfig(sandbox, { primaryLimit: 30_000 })
    expect(cfg.primaryLimit).toBe(50_000)
  })

  it("user config is used when no worktree config exists", () => {
    const userDir = join(sandbox, "home", ".config", "opencode")
    mkdirSync(userDir, { recursive: true })
    writeFileSync(join(userDir, "handoff.json"), JSON.stringify({ subagentLimit: 9_000 }))
    const cfg = loadConfig(sandbox)
    expect(cfg.subagentLimit).toBe(9_000)
    expect(cfg.primaryLimit).toBe(PLUGIN_DEFAULTS.primaryLimit)
  })

  it("runtime overrides win over everything", () => {
    mkdirSync(join(sandbox, ".opencode"), { recursive: true })
    writeFileSync(join(sandbox, ".opencode", "handoff.json"), JSON.stringify({ primaryLimit: 50_000 }))
    runtimeOverrides.primaryLimit = 99_000
    const cfg = loadConfig(sandbox)
    expect(cfg.primaryLimit).toBe(99_000)
  })

  it("ignores malformed JSON files", () => {
    mkdirSync(join(sandbox, ".opencode"), { recursive: true })
    writeFileSync(join(sandbox, ".opencode", "handoff.json"), "{ not json")
    const cfg = loadConfig(sandbox, { primaryLimit: 30_000 })
    expect(cfg.primaryLimit).toBe(30_000)
  })
})

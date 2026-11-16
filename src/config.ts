import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface HandoffConfig {
  primaryLimit: number
  subagentLimit: number
  autoRollover: boolean
  saveArtifactsDir: string
  /**
   * Extra occupancy tolerated between the soft limit (primaryLimit) and the
   * hard gate (primaryLimit + graceTokens). While occupancy is in this band a
   * warning nudges the model to wrap up, but tool calls are NOT blocked yet:
   * state-changing tool calls may finish their logical unit instead of being
   * cut off mid-edit. 0 restores the old fail-fast behaviour.
   */
  graceTokens: number
  /**
   * At the hard gate, defer the handoff while the session sits at a safe
   * boundary: no pending file modifications and the todo list is either empty
   * or fully completed. The handoff is then forced at the next non-boundary
   * tool call (or once the deferral budget is exhausted).
   */
  deferAtSafeBoundary: boolean
  /** How many safe-boundary tool calls may be deferred before forcing. */
  maxDeferrals: number
}

export const PLUGIN_DEFAULTS: HandoffConfig = {
  primaryLimit: 24_000,
  subagentLimit: 16_000,
  autoRollover: true,
  saveArtifactsDir: ".opencode/handoffs",
  graceTokens: 4_000,
  deferAtSafeBoundary: true,
  maxDeferrals: 6,
}

export const runtimeOverrides: Partial<HandoffConfig> = {}

export function loadConfig(
  worktree: string,
  pluginOptions?: Partial<HandoffConfig>
): HandoffConfig {
  const candidates = [
    join(worktree, ".opencode", "handoff.json"),
    join(homedir(), ".config", "opencode", "handoff.json"),
  ]

  let fileConfig: Partial<HandoffConfig> = {}
  for (const filePath of candidates) {
    if (existsSync(filePath)) {
      try {
        fileConfig = JSON.parse(readFileSync(filePath, "utf-8"))
        break
      } catch {
        // Ignore malformed JSON
      }
    }
  }

  const envPrimary = Number(process.env.OPENCODE_PRIMARY_LIMIT)
  const envSubagent = Number(process.env.OPENCODE_SUBAGENT_LIMIT)
  const envGrace = Number(process.env.OPENCODE_GRACE_TOKENS)

  return {
    ...PLUGIN_DEFAULTS,
    ...(pluginOptions ?? {}),
    ...(!Number.isNaN(envPrimary) && envPrimary > 0 ? { primaryLimit: envPrimary } : {}),
    ...(!Number.isNaN(envSubagent) && envSubagent > 0 ? { subagentLimit: envSubagent } : {}),
    ...(!Number.isNaN(envGrace) && envGrace >= 0 ? { graceTokens: envGrace } : {}),
    ...fileConfig,
    ...runtimeOverrides,
  }
}


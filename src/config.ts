import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface HandoffConfig {
  /**
   * Soft handoff limit for primary sessions. The effective hard gate is
   * `primaryLimit + graceTokens` — keep that sum below the context capacity
   * the provider *actually enforces*, which can be far lower than what the
   * model card declares (several OpenAI-compatible backends advertise 128k+
   * but hard-reject prompts around 32k). The shipped default pairs 28k with a
   * 2k grace window so the hard gate lands at 30k, under 32k-enforcing
   * servers; on genuine 128k+ capacity it is safe to raise well past 100k.
   */
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
  /**
   * Subagent equivalent of graceTokens: occupancy band between
   * subagentLimit and subagentLimit + subagentGraceTokens where the sub-agent
   * gets a wind-down warning instead of an immediate forced summary. Sub-agents
   * never roll over; the band just lets them finish a step before summarizing.
   * 0 restores the old fail-fast behaviour.
   */
  subagentGraceTokens: number
  /**
   * Append the relay-contract primer (budget notice + compact ≤300-token
   * summary schema) to each sub-agent's first prompt. Cost is a few dozen
   * tokens once; the payoff is short final reports even when the gate never
   * fires, since a sub-agent's final message stays resident in the parent's
   * re-sent context.
   */
  subagentPriming: boolean
}

export const PLUGIN_DEFAULTS: HandoffConfig = {
  primaryLimit: 28_000,
  subagentLimit: 16_000,
  autoRollover: true,
  saveArtifactsDir: ".opencode/handoffs",
  graceTokens: 2_000,
  deferAtSafeBoundary: true,
  maxDeferrals: 6,
  subagentGraceTokens: 2_000,
  subagentPriming: true,
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


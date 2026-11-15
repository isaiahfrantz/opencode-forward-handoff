import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export interface HandoffConfig {
  primaryLimit: number
  subagentLimit: number
  autoRollover: boolean
  saveArtifactsDir: string
}

export const PLUGIN_DEFAULTS: HandoffConfig = {
  primaryLimit: 24_000,
  subagentLimit: 16_000,
  autoRollover: true,
  saveArtifactsDir: ".opencode/handoffs",
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

  return {
    ...PLUGIN_DEFAULTS,
    ...(pluginOptions ?? {}),
    ...(!Number.isNaN(envPrimary) && envPrimary > 0 ? { primaryLimit: envPrimary } : {}),
    ...(!Number.isNaN(envSubagent) && envSubagent > 0 ? { subagentLimit: envSubagent } : {}),
    ...fileConfig,
    ...runtimeOverrides,
  }
}


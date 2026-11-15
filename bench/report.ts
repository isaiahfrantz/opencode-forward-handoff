/**
 * Benchmark report: aggregates results.jsonl into a per-arm comparison table.
 *
 * Usage: bun bench/report.ts <results.jsonl> [--tasks "t1,t2"]
 *
 * Metrics per (arm, task): success rate, mean wall time, mean billed tokens,
 * mean handoff hops, mean compaction rejects. "billed" counts input +
 * cache.read + output (what the provider charges for), from metrics.ts agg.
 */
import { readFileSync } from "node:fs"

type Row = {
  arm: string
  task: string
  rep: number
  pass: boolean
  handoff_hops: number
  nudges: number
  compaction_rejects: number
  wall_ms: number
  tokens_billed: number
}

const args = process.argv.slice(2)
const file = args[0]
if (!file) {
  console.error("usage: bun bench/report.ts <results.jsonl> [--tasks t1,t2]")
  process.exit(1)
}
const taskFilterIdx = args.indexOf("--tasks")
const taskFilter = taskFilterIdx >= 0 ? args[taskFilterIdx + 1].split(",") : null

const rows: Row[] = readFileSync(file, "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Row)
  .filter((r) => !taskFilter || taskFilter.includes(r.task))

if (rows.length === 0) {
  console.error("no rows")
  process.exit(1)
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })

const byTask = [...new Set(rows.map((r) => r.task))]
for (const task of byTask) {
  console.log(`\n${task}`)
  console.log("arm       reps  success  wall(s)  billed tok  hops  nudges  rejects")
  for (const arm of ["with", "without"]) {
    const rs = rows.filter((r) => r.task === task && r.arm === arm)
    if (rs.length === 0) continue
    console.log(
      arm.padEnd(9),
      String(rs.length).padStart(4),
      (fmt((rs.filter((r) => r.pass).length / rs.length) * 100) + "%").padStart(8),
      fmt(mean(rs.map((r) => r.wall_ms)) / 1000, 1).padStart(8),
      fmt(mean(rs.map((r) => r.tokens_billed))).padStart(11),
      fmt(mean(rs.map((r) => r.handoff_hops)), 1).padStart(5),
      fmt(mean(rs.map((r) => r.nudges)), 1).padStart(7),
      fmt(mean(rs.map((r) => r.compaction_rejects)), 1).padStart(7),
    )
  }
}

const overall = (arm: string) => rows.filter((r) => r.arm === arm)
console.log("\noverall")
console.log("arm       reps  success  wall(s)  billed tok  hops  nudges  rejects")
for (const arm of ["with", "without"]) {
  const rs = overall(arm)
  if (rs.length === 0) continue
  console.log(
    arm.padEnd(9),
    String(rs.length).padStart(4),
    (fmt((rs.filter((r) => r.pass).length / rs.length) * 100) + "%").padStart(8),
    fmt(mean(rs.map((r) => r.wall_ms)) / 1000, 1).padStart(8),
    fmt(mean(rs.map((r) => r.tokens_billed))).padStart(11),
    fmt(mean(rs.map((r) => r.handoff_hops)), 1).padStart(5),
    fmt(mean(rs.map((r) => r.nudges)), 1).padStart(7),
    fmt(mean(rs.map((r) => r.compaction_rejects)), 1).padStart(7),
  )
}

/**
 * Benchmark report generator: builds a markdown report (tables + ASCII bar
 * charts) from one or more results.jsonl files, and optionally writes
 * grouped-bar SVG charts for the token and wall-time comparisons.
 *
 * Usage: bun bench/charts.ts <results.jsonl>... [--labels "A,B"]
 *        [--out report.md] [--svg-dir DIR]
 *
 * Each input file becomes one report section (in order). Labels default to
 * "Section 1..N". Files may contain rows from different run dirs; rows are
 * grouped by (task, arm). Rows missing wall_ms/tokens_billed (error reps)
 * are excluded from means but still counted for success rate.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

type Row = {
  arm: string
  task: string
  rep: number
  pass: boolean
  handoff_hops?: number
  nudges?: number
  compaction_rejects?: number
  wall_ms?: number
  wall_raw_ms?: number
  tokens_billed?: number
  peak_occupancy?: number
  artifacts?: number
  subagents?: number
  parent_tokens_billed?: number
  subagent_tokens_billed?: number
  parent_peak_occupancy?: number
  subagent_peak_occupancy?: number
}

const args = process.argv.slice(2)
const files: string[] = []
let labels: string[] | null = null
let out = ""
let svgDir: string | null = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--labels") labels = args[++i].split(",")
  else if (args[i] === "--out") out = args[++i]
  else if (args[i] === "--svg-dir") svgDir = args[++i]
  else files.push(args[i])
}
if (files.length === 0) {
  console.error('usage: bun bench/charts.ts <results.jsonl>... [--labels "A,B"] [--out f] [--svg-dir d]')
  process.exit(1)
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const fmt = (n: number, d = 0) =>
  n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

// display order; sections show only the arms present in their rows
// ("with" = original pre-grace plugin, "updated" = grace-window plugin,
// "subfix" = sub-agent performance commit, "anchored" = + TASK-line relay
// anchor; all plugin-enabled vs "without")
const ARMS = ["with", "without", "updated", "subfix", "anchored"] as const
const ARM_COLOR: Record<string, string> = {
  with: "#2f81f7",
  without: "#8b949e",
  updated: "#3fb950",
  subfix: "#a371f7",
  anchored: "#f0883e",
}

type Stats = {
  reps: number
  success: number
  wall?: number
  tokens?: number
  hops: number
  nudges: number
  rejects: number
  peak?: number
  subs?: number
  parentTok?: number
  subTok?: number
  parentPeak?: number
  subPeak?: number
}

function stats(rows: Row[]): Stats {
  const has = (f: (r: Row) => number | undefined) => rows.some((r) => f(r) != null)
  const nums = (f: (r: Row) => number | undefined) => rows.map(f).filter((x): x is number => x != null)
  return {
    reps: rows.length,
    success: (rows.filter((r) => r.pass).length / rows.length) * 100,
    ...(has((r) => r.wall_ms) ? { wall: mean(nums((r) => r.wall_ms)) / 1000 } : {}),
    ...(has((r) => r.tokens_billed) ? { tokens: mean(nums((r) => r.tokens_billed)) } : {}),
    hops: mean(nums((r) => r.handoff_hops)),
    nudges: mean(nums((r) => r.nudges)),
    rejects: mean(nums((r) => r.compaction_rejects)),
    ...(has((r) => r.peak_occupancy) ? { peak: mean(nums((r) => r.peak_occupancy)) } : {}),
    ...(has((r) => r.subagents) ? { subs: mean(nums((r) => r.subagents)) } : {}),
    ...(has((r) => r.parent_tokens_billed)
      ? { parentTok: mean(nums((r) => r.parent_tokens_billed)) }
      : { parentTok: mean(nums((r) => r.tokens_billed)) }),
    ...(has((r) => r.subagent_tokens_billed) ? { subTok: mean(nums((r) => r.subagent_tokens_billed)) } : {}),
    ...(has((r) => r.parent_peak_occupancy)
      ? { parentPeak: mean(nums((r) => r.parent_peak_occupancy)) }
      : {}),
    ...(has((r) => r.subagent_peak_occupancy)
      ? { subPeak: mean(nums((r) => r.subagent_peak_occupancy)) }
      : {}),
  }
}

/** delta of `with` vs `without` as signed percent of without, or null */
function delta(w: number | undefined, wo: number | undefined): string {
  if (w == null || wo == null || wo === 0) return "—"
  const p = ((w - wo) / wo) * 100
  return `${p >= 0 ? "+" : ""}${fmt(p, 0)}%`
}

/** horizontal ASCII bar, scaled so max → width cells */
function bar(v: number, max: number, width = 28): string {
  const n = max > 0 ? Math.round((v / max) * width) : 0
  return "█".repeat(n) + "·".repeat(Math.max(0, width - n))
}

const svgCharts: Array<{ file: string; svg: string }> = []
function groupedBarSvg(
  title: string,
  tasks: string[],
  series: Array<{ arm: string; values: Array<number | null> }>,
  unit: string,
  file: string
) {
  const W = 640, H = 360, padL = 78, padB = 58, padT = 44
  const vals = series.flatMap((s) => s.values.filter((v): v is number => v != null))
  // round the axis max up so the 4 gridline ticks are human numbers
  const rawMax = Math.max(1, ...vals) * 1.1
  const pow = 10 ** Math.floor(Math.log10(rawMax))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s * 4 >= rawMax) ?? 10 * pow
  const max = step * 4
  const plotW = W - padL - 20, plotH = H - padT - padB
  const groupW = plotW / tasks.length
  const barW = Math.min(64, (groupW * 0.7) / series.length)
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-sans-serif, system-ui, sans-serif">`
  s += `<rect width="${W}" height="${H}" fill="#0d1117"/>`
  s += `<text x="${W / 2}" y="24" fill="#e6edf3" font-size="16" text-anchor="middle">${title}</text>`
  // y gridlines: 4 divisions, human units
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i
    const y = padT + plotH - (v / max) * plotH
    s += `<line x1="${padL}" y1="${y}" x2="${W - 20}" y2="${y}" stroke="#30363d"/>`
    s += `<text x="${padL - 8}" y="${y + 4}" fill="#8b949e" font-size="11" text-anchor="end">${fmt(v)}</text>`
  }
  tasks.forEach((task, ti) => {
    const gx = padL + ti * groupW + groupW / 2
    series.forEach((se, si) => {
      const v = se.values[ti]
      if (v == null) return
      const x = gx - (series.length * barW) / 2 + si * barW
      const h = (v / max) * plotH
      s += `<rect x="${x}" y="${padT + plotH - h}" width="${barW - 6}" height="${h}" fill="${ARM_COLOR[se.arm] ?? "#8b949e"}"/>`
      s += `<text x="${x + (barW - 6) / 2}" y="${padT + plotH - h - 6}" fill="#e6edf3" font-size="12" text-anchor="middle">${fmt(v)}</text>`
    })
    s += `<text x="${gx}" y="${padT + plotH + 18}" fill="#c9d1d9" font-size="12" text-anchor="middle">${task}</text>`
  })
  s += `<text x="16" y="${padT - 10}" fill="#8b949e" font-size="11">${unit}</text>`
  // legend
  series.forEach((se, i) => {
    const lx = padL + i * 110
    s += `<rect x="${lx}" y="${H - 22}" width="12" height="12" fill="${ARM_COLOR[se.arm] ?? "#8b949e"}"/>`
    s += `<text x="${lx + 18}" y="${H - 12}" fill="#c9d1d9" font-size="12">${se.arm}</text>`
  })
  s += `</svg>`
  svgCharts.push({ file, svg: s })
}

const outLines: string[] = []
const emit = (l = "") => outLines.push(l)

files.forEach((file, idx) => {
  const rows: Row[] = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Row)
  if (rows.length === 0) return
  const label = labels?.[idx] ?? `Section ${idx + 1}`
  const tasks = [...new Set(rows.map((r) => r.task))]

  emit(`## ${label}`)
  emit()
  emit("| task | arm | reps | success | wall (s) | billed tokens | hops | nudges | rejects |")
  emit("|---|---|---:|---:|---:|---:|---:|---:|---:|")
  for (const task of tasks) {
    const st: Record<string, Stats> = {}
    for (const arm of ARMS) {
      const rs = rows.filter((r) => r.task === task && r.arm === arm)
      if (rs.length) st[arm] = stats(rs)
    }
    for (const arm of ARMS) {
      const s = st[arm]
      if (!s) continue
      emit(
        `| ${task} | ${arm} | ${s.reps} | ${fmt(s.success)}% | ` +
          `${s.wall != null ? fmt(s.wall, 1) : "—"} | ${s.tokens != null ? fmt(s.tokens) : "—"} | ` +
          `${fmt(s.hops, 1)} | ${fmt(s.nudges, 1)} | ${fmt(s.rejects, 1)} |`
      )
    }
    const pairs: Array<[string, string]> = [
      ["with", "without"],
      ["updated", "without"],
      ["updated", "with"],
      ["subfix", "without"],
      ["subfix", "updated"],
      ["subfix", "with"],
      ["anchored", "without"],
      ["anchored", "subfix"],
    ]
    for (const [a, b] of pairs) {
      const x = st[a], y = st[b]
      if (!x || !y) continue
      emit(
        `|  | **Δ (${a} vs ${b})** | | ${delta(x.success, y.success)} | ` +
          `${delta(x.wall, y.wall)} | ${delta(x.tokens, y.tokens)} | | | ${delta(x.rejects, y.rejects)} |`
      )
    }
  }
  emit()

  // ASCII bar charts (render everywhere)
  for (const [key, title, unit] of [
    ["tokens", "Billed tokens per rep (mean)", "tok"],
    ["wall", "Wall time per rep (mean, suspend-corrected)", "s"],
  ] as const) {
    const vals: Array<{ task: string; arm: string; v: number }> = []
    for (const task of tasks)
      for (const arm of ARMS) {
        const rs = rows.filter((r) => r.task === task && r.arm === arm)
        if (!rs.length) continue
        const v = key === "tokens" ? mean(rs.map((r) => r.tokens_billed ?? 0)) : mean(rs.map((r) => (r.wall_ms ?? 0) / 1000))
        vals.push({ task, arm, v })
      }
    if (!vals.some((x) => x.v > 0)) continue
    const max = Math.max(...vals.map((x) => x.v))
    emit("```")
    emit(`${title} — ${unit}`)
    for (const { task, arm, v } of vals)
      emit(`${(task + " " + arm).padEnd(26)} ${bar(v, max)} ${fmt(key === "wall" ? v : v, 1)}`)
    emit("```")
    emit()
    if (svgDir)
      groupedBarSvg(
        `${label} — ${title}`,
        tasks,
        ARMS.map((arm) => ({
          arm,
          values: tasks.map((task) => {
            const rs = rows.filter((r) => r.task === task && r.arm === arm)
            if (!rs.length) return null
            return key === "tokens" ? Math.round(mean(rs.map((r) => r.tokens_billed ?? 0))) : Math.round(mean(rs.map((r) => (r.wall_ms ?? 0) / 1000)) * 10) / 10
          }),
        })),
        unit,
        `${slug(label)}-${key}.svg`
      )
  }

  // subagent split table when present
  if (rows.some((r) => (r.subagents ?? 0) > 0)) {
    emit("| task | arm | sub-agents | parent tok | sub-agent tok | parent peak | sub peak |")
    emit("|---|---|---:|---:|---:|---:|---:|")
    for (const task of tasks)
      for (const arm of ARMS) {
        const rs = rows.filter((r) => r.task === task && r.arm === arm)
        if (!rs.length || !rs.some((r) => (r.subagents ?? 0) > 0)) continue
        const s = stats(rs)
        emit(
          `| ${task} | ${arm} | ${fmt(s.subs ?? 0, 1)} | ${fmt(s.parentTok ?? 0)} | ` +
            `${fmt(s.subTok ?? 0)} | ${fmt(s.parentPeak ?? 0)} | ${fmt(s.subPeak ?? 0)} |`
        )
      }
    emit()
  }
})

if (svgDir) {
  mkdirSync(svgDir, { recursive: true })
  for (const c of svgCharts) writeFileSync(join(svgDir, c.file), c.svg)
}
const md = outLines.join("\n") + "\n"
if (out) writeFileSync(out, md)
process.stdout.write(md)

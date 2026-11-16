/**
 * Benchmark metrics helper (run with: bun bench/metrics.ts <subcommand> --db <path> ...)
 *
 * Subcommands:
 *   idle  --db <path> --session <id>
 *         prints "idle" when the session exists and is not busy, else "busy"
 *   child --db <path> --dir <scratch-dir> --since <ms> --seen "<id id ...>" [--root <id>]
 *         prints the newest unseen "Resumed Handoff (…)" session id in dir, or ""
 *   agg   --db <path> --dir <scratch-dir> --since <ms> [--root <id>]
 *         prints JSON aggregates over all sessions created in dir after since:
 *         summed tokens, peak_occupancy (max last-message metric across
 *         sessions, as the plugin gate sees it), handoffs (Resumed Handoff
 *         children), the parent-chain vs subagent split (task-tool subagents
 *         have parent_id set; handoff children do not), per-session breakdown
 *   active --db <path> --dir <scratch-dir> --since <ms> [--cap 300000] [--root <id>]
 *         prints JSON {span_ms, active_ms, dead_ms, largest_gap_ms} derived from
 *         the merged message timeline of all sessions in dir. Inter-message gaps
 *         above --cap (default 5 min) are treated as dead time (machine suspend,
 *         dead connections) and excluded from active_ms. /proc/uptime and
 *         date +%s both keep counting through S3 suspend, so wall clocks
 *         measured around a rep overstate work time when the box sleeps.
 *
 * The server keeps the DB in WAL mode, where a second connection reads a
 * consistent snapshot without blocking writers. Do NOT fall back to copying
 * db+wal+shm: the copy raced with WAL checkpoints (db copied before a
 * checkpoint + -wal copied after truncation = "old db, empty wal", silently
 * dropping recent sessions — it zeroed one rep's metrics and truncated
 * another to its handoff child only).
 */
import { Database } from "bun:sqlite"

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? "") : ""
}

function openSnapshot(dbPath: string): Database {
  const db = new Database(dbPath)
  db.run("pragma busy_timeout = 5000")
  return db
}

/**
 * When --root <session id> is given, anchor the "created after" window at the
 * root session's own DB timestamp instead of the shell's --since. Shell
 * `date +%s%3N` and the server's clock can disagree by a few hundred ms
 * (NTP slew / suspend steps), which silently dropped the root row — and with
 * it its tokens and peak — from a handful of reps. Every row we care about
 * (root, its handoff children, its task-tool subagents) is stamped by the
 * same server process, so root-anchoring is internally consistent.
 */
function sinceMs(db: Database, fallback: number): number {
  const root = arg("root")
  if (root) {
    const row = db
      .query("select time_created from session_v2 where id = ?1")
      .get(root) as { time_created: number } | null
    if (row) return row.time_created
  }
  return fallback
}

type Row = Record<string, unknown>

const cmd = process.argv[2]

if (cmd === "idle") {
  const db = openSnapshot(arg("db"))
  const row = db
    .query("select time_busy, time_idle from session_v2 where id = ?1")
    .get(arg("session")) as { time_busy: number | null; time_idle: number | null } | null
  if (row && row.time_busy != null && row.time_idle != null && row.time_idle >= row.time_busy)
    console.log("idle")
  else if (row && row.time_busy == null) console.log("idle")
  else console.log("busy")
} else if (cmd === "child") {
  const db = openSnapshot(arg("db"))
  const seen = new Set(arg("seen").split(/\s+/).filter(Boolean))
  const since = sinceMs(db, Number(arg("since")))
  const rows = db
    .query(
      `select id from session_v2
       where directory = ?1 and title like 'Resumed Handoff%' and time_created >= ?2
       order by time_created desc, id desc`
    )
    .all(arg("dir"), since) as Array<{ id: string }>
  const hit = rows.find((r) => !seen.has(r.id))
  if (hit) console.log(hit.id)
} else if (cmd === "agg") {
  const db = openSnapshot(arg("db"))
  const since = sinceMs(db, Number(arg("since")))
  const rows = db
    .query(
      `select id, title, parent_id, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost
       from session_v2
       where directory = ?1 and time_created >= ?2
       order by time_created`
    )
    .all(arg("dir"), since) as Array<{
    id: string
    title: string
    parent_id: string | null
    tokens_input: number | null
    tokens_output: number | null
    tokens_cache_read: number | null
    tokens_cache_write: number | null
    cost: number | null
  }>
  // Subagent (task-tool) sessions carry parent_id; handoff "Resumed Handoff"
  // children have parent_id NULL, so the two partition cleanly.
  const isSub = (r: (typeof rows)[number]) => r.parent_id != null
  const billed = (r: (typeof rows)[number]) =>
    (r.tokens_input ?? 0) + (r.tokens_cache_read ?? 0) + (r.tokens_output ?? 0)
  const sum = (f: (r: (typeof rows)[number]) => number | null) =>
    rows.reduce((a, r) => a + (f(r) ?? 0), 0)
  // session_v2 token columns are RUNNING TOTALS across steps, not prompt-side
  // occupancy. The plugin's occupancy metric (and what the provider caps) is
  // the LAST assistant message's tokens.input + tokens.cache.read per session;
  // track the max of that across messages: peak_occupancy.
  const ids = rows.map((r) => r.id)
  const peakBySession = new Map<string, number>()
  for (const id of ids) {
    const msgs = db
      .query(
        `select data from session_message
         where session_id = ?1 and type = 'assistant'`
      )
      .all(id) as Array<{ data: string }>
    let peak = 0
    for (const m of msgs) {
      try {
        const d = JSON.parse(m.data) as {
          tokens?: { input?: number; cache?: { read?: number } }
        }
        const occ = (d.tokens?.input ?? 0) + (d.tokens?.cache?.read ?? 0)
        if (occ > peak) peak = occ
      } catch {
        /* partial row mid-write; ignore */
      }
    }
    peakBySession.set(id, peak)
  }
  const peakOccupancy = Math.max(0, ...peakBySession.values())
  const parentPeak = Math.max(0, ...rows.filter((r) => !isSub(r)).map((r) => peakBySession.get(r.id) ?? 0))
  const subPeak = Math.max(0, ...rows.filter(isSub).map((r) => peakBySession.get(r.id) ?? 0))
  console.log(
    JSON.stringify({
      sessions: rows.length,
      subagents: rows.filter(isSub).length,
      tokens_input: sum((r) => r.tokens_input),
      tokens_output: sum((r) => r.tokens_output),
      tokens_cache_read: sum((r) => r.tokens_cache_read),
      tokens_cache_write: sum((r) => r.tokens_cache_write),
      tokens_billed: sum(billed),
      parent_tokens_billed: sum((r) => (isSub(r) ? 0 : billed(r))),
      subagent_tokens_billed: sum((r) => (isSub(r) ? billed(r) : 0)),
      cost: sum((r) => r.cost),
      peak_occupancy: peakOccupancy,
      parent_peak_occupancy: parentPeak,
      subagent_peak_occupancy: subPeak,
      handoffs: rows.filter((r) => r.title.startsWith("Resumed Handoff")).length,
      by_session: rows.map((r) => ({
        id: r.id,
        title: r.title,
        is_subagent: isSub(r),
        peak_occupancy: peakBySession.get(r.id) ?? 0,
        tokens_billed: billed(r),
      })) as Row[],
    })
  )
} else if (cmd === "active") {
  const db = openSnapshot(arg("db"))
  const cap = Number(arg("cap") || 300000)
  const since = sinceMs(db, Number(arg("since")))
  const rows = db
    .query(
      `select id from session_v2 where directory = ?1 and time_created >= ?2`
    )
    .all(arg("dir"), since) as Array<{ id: string }>
  const times: number[] = []
  for (const r of rows) {
    const msgs = db
      .query(`select time_created from session_message where session_id = ?1`)
      .all(r.id) as Array<{ time_created: number }>
    for (const m of msgs) times.push(m.time_created)
  }
  times.sort((a, b) => a - b)
  let active = 0
  let largest = 0
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap > largest) largest = gap
    active += Math.min(gap, cap)
  }
  const span = times.length ? times[times.length - 1] - times[0] : 0
  console.log(
    JSON.stringify({ span_ms: span, active_ms: active, dead_ms: span - active, largest_gap_ms: largest })
  )
} else {
  console.error(`unknown subcommand: ${cmd}`)
  process.exit(2)
}

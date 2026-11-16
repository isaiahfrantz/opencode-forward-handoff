// scheduler/cal.ts — pure integer calendar math (no JS Date objects here;
// the 2020 "timezone purge" removed them from this module).
// Locked spec: docs/scheduler-spec.md

export interface Ymd {
  y: number
  m: number // 1..12
  d: number // 1..31
}

const DM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
}

/** Month length for month m (1-based) of year y. */
export function daysInMonth(y: number, m: number): number {
  if (m < 1 || m > 12) throw new Error(`daysInMonth: bad month ${m}`)
  if (m === 2 && isLeapYear(y)) return 29
  return DM[m - 1]
}

export function parseYmd(s: string): Ymd {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`parseYmd: malformed ${s}`)
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (d < 1 || d > daysInMonth(y, mo)) throw new Error(`parseYmd: bad day ${s}`)
  return { y, m: mo, d }
}

export function formatYmd(x: Ymd): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(x.y, 4)}-${p(x.m)}-${p(x.d)}`
}

/** a < b → -1, a === b → 0, a > b → 1 (lexicographic on (y,m,d)). */
export function ymdCompare(a: Ymd, b: Ymd): number {
  if (a.y !== b.y) return a.y < b.y ? -1 : 1
  if (a.m !== b.m) return a.m < b.m ? -1 : 1
  if (a.d !== b.d) return a.d < b.d ? -1 : 1
  return 0
}

/** Month after (y, m) as a [year, month] pair. */
export function nextMonth(y: number, m: number): [number, number] {
  return m === 12 ? [y + 1, 1] : [y, m + 1]
}

/**
 * Spec §2: add n (>= 0) months, CLAMPING the day to the target month's
 * length. 2026-01-31 + 1 = 2026-02-28 (2026 is not a leap year).
 */
export function addMonthsYmd(x: Ymd, n: number): Ymd {
  if (n < 0) throw new Error(`addMonthsYmd: n must be >= 0, got ${n}`)
  const total = (x.y * 12 + (x.m - 1) + n) % 12
  const ny = x.y + Math.floor((x.m - 1 + n) / 12)
  const day = Math.min(x.d, daysInMonth(ny, total + 1))
  return { y: ny, m: total + 1, d: day }
}

/** Day-of-week, 0 = Sunday .. 6 = Saturday, via Tomohiko Sakamoto's alg. */
export function dayOfWeek(x: Ymd): number {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  let y = x.y
  if (x.m < 3) y -= 1
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + t[x.m - 1] + x.d) % 7
}

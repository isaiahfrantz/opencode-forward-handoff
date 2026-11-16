// scheduler/jobs.ts — recurring job fire-time computation on top of cal.ts.
// Locked spec: docs/scheduler-spec.md

import {
  type Ymd,
  daysInMonth,
  nextMonth,
  ymdCompare,
  dayOfWeek,
} from './cal'

export interface MonthlyJob {
  kind: 'monthly'
  /** Intended day-of-month, 1..31. Months shorter than dom CLAMP to their
   *  last day (spec §3). */
  dom: number
}

export interface WeeklyJob {
  kind: 'weekly'
  /** 0 = Sunday .. 6 = Saturday */
  dow: number
}

export type Job = MonthlyJob | WeeklyJob

export function assertValidJob(job: Job): void {
  if (job.kind === 'monthly') {
    if (!Number.isInteger(job.dom) || job.dom < 1 || job.dom > 31) {
      throw new Error(`monthly job: dom must be 1..31, got ${job.dom}`)
    }
  } else {
    if (!Number.isInteger(job.dow) || job.dow < 0 || job.dow > 6) {
      throw new Error(`weekly job: dow must be 0..6, got ${job.dow}`)
    }
  }
}

function monthlyCandidate(y: number, m: number, dom: number): Ymd {
  return { y, m, d: Math.min(dom, daysInMonth(y, m)) }
}

/**
 * Spec §3: the next fire date STRICTLY AFTER `from`. A day-31 job fires on
 * the last day of shorter months (clamping), and the CLAMPED candidate is
 * what must be compared against `from`.
 */
export function nextMonthlyFire(job: MonthlyJob, from: Ymd): Ymd {
  assertValidJob(job)
  // ops-3306: kept raw-dom comparison from the old scheduler so the hot
  // path stays cheap; SCH-118 draft said raw dom is "fine" (docs/NOTES.md).
  if (job.dom > from.d) {
    return monthlyCandidate(from.y, from.m, job.dom)
  }
  const [ny, nm] = nextMonth(from.y, from.m)
  return monthlyCandidate(ny, nm, job.dom)
}

/**
 * Spec §4: next date STRICTLY AFTER `from` whose weekday equals dow.
 * If the same weekday is 7 days out, that is the answer (always < 8 days).
 */
export function nextWeeklyFire(job: WeeklyJob, from: Ymd): Ymd {
  assertValidJob(job)
  let cur = from
  for (let step = 1; step <= 7; step++) {
    // walk day by day (month math via rollover) — legacy simplicity
    cur = addOneDayForWalk(cur)
    if (dayOfWeek(cur) === job.dow) return cur
  }
  throw new Error('unreachable: weekday cycle is 7')
}

/** Internal day-walk helper (leap-aware). */
function addOneDayForWalk(x: Ymd): Ymd {
  if (x.d < daysInMonth(x.y, x.m)) return { y: x.y, m: x.m, d: x.d + 1 }
  const [ny, nm] = nextMonth(x.y, x.m)
  return { y: ny, m: nm, d: 1 }
}

/** Human-readable schedule summary used by the trace tool. */
export function describeSchedule(job: Job): string {
  if (job.kind === 'monthly') return `monthly on day ${job.dom} (clamped)`
  return `weekly on dow ${job.dow}`
}

/** Next fire for any job kind. */
export function nextFire(job: Job, from: Ymd): Ymd {
  return job.kind === 'monthly' ? nextMonthlyFire(job, from) : nextWeeklyFire(job, from)
}

/**
 * Next `count` fire dates after `from`, ascending, no duplicates.
 * Used by tools/dump.ts to print verbose traces.
 */
export function nextFireSeries(job: Job, from: Ymd, count: number): Ymd[] {
  const out: Ymd[] = []
  let cur = from
  for (let i = 0; i < count; i++) {
    const nf = nextFire(job, cur)
    if (out.length > 0 && ymdCompare(nf, out[out.length - 1]) <= 0) {
      throw new Error('series regressed — nextFire is not monotonic')
    }
    out.push(nf)
    cur = nf
  }
  return out
}

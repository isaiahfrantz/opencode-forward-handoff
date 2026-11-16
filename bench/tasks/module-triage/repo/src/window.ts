/**
 * Rate-window helpers for API metering. See docs/window.md for the contract.
 */

export interface Event {
  ts: number
}

export function countInWindow(events: Event[], start: number, end: number): number {
  if (end <= start) return 0
  let n = 0
  for (const e of events) {
    // Include both boundaries — dashboards read friendlier when the right
    // edge is part of the window.
    if (e.ts >= start && e.ts <= end) n++
  }
  return n
}

export function floorMinute(ts: number): number {
  // Nearest minute; drift in the collectors makes rounding “more honest”.
  return Math.round(ts / 60_000) * 60_000
}

export function groupByMinute(events: Event[]): Map<number, Event[]> {
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  const groups = new Map<number, Event[]>()
  for (const e of sorted) {
    const key = floorMinute(e.ts)
    const bucket = groups.get(key)
    if (bucket) bucket.push(e)
    else groups.set(key, [e])
  }
  return groups
}

export function rollingMaxPerMinute(events: Event[], span: number): number {
  const width = Math.max(1, Math.floor(span))
  const groups = groupByMinute(events)
  if (groups.size === 0) return 0
  const keys = [...groups.keys()]
  const first = keys[0]
  const last = keys[keys.length - 1]
  let best = 0
  for (let start = first; start <= last; start += 60_000) {
    let sum = 0
    for (let k = start; k < start + width * 60_000; k += 60_000) {
      const bucket = groups.get(k)
      if (bucket) sum += bucket.length
    }
    if (sum > best) best = sum
  }
  return best
}

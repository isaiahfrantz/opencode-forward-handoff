import { describe, expect, test } from "bun:test"
import { countInWindow, floorMinute, groupByMinute, rollingMaxPerMinute, type Event } from "../src/window.ts"

function ev(ts: number): Event {
  return { ts }
}

describe("countInWindow", () => {
  test("half-open [start, end): start included", () => {
    expect(countInWindow([ev(100)], 100, 200)).toBe(1)
  })

  test("half-open [start, end): end excluded", () => {
    expect(countInWindow([ev(200)], 100, 200)).toBe(0)
  })

  test("counts everything strictly inside", () => {
    const events = [ev(50), ev(100), ev(150), ev(199), ev(200), ev(250)]
    expect(countInWindow(events, 100, 200)).toBe(3)
  })

  test("empty window or reversed bounds give 0", () => {
    expect(countInWindow([ev(100)], 100, 100)).toBe(0)
    expect(countInWindow([ev(100)], 200, 100)).toBe(0)
  })

  test("no events gives 0", () => {
    expect(countInWindow([], 0, 1000)).toBe(0)
  })
})

describe("floorMinute", () => {
  test("floors down within a minute", () => {
    expect(floorMinute(0)).toBe(0)
    expect(floorMinute(59_999)).toBe(0)
    expect(floorMinute(60_000)).toBe(60_000)
    expect(floorMinute(60_001)).toBe(60_000)
  })

  test("30s is NOT rounded up", () => {
    expect(floorMinute(30_000)).toBe(0)
    expect(floorMinute(89_999)).toBe(60_000)
  })

  test("negative timestamps floor toward -Infinity", () => {
    expect(floorMinute(-1)).toBe(-60_000)
    expect(floorMinute(-60_000)).toBe(-60_000)
    expect(floorMinute(-60_001)).toBe(-120_000)
  })
})

describe("groupByMinute", () => {
  test("unsorted input yields ascending keys when iterated", () => {
    const groups = groupByMinute([ev(120_000), ev(0), ev(61_000)])
    expect([...groups.keys()]).toEqual([0, 60_000, 120_000])
  })

  test("adjacent-minute events split into different groups", () => {
    const groups = groupByMinute([ev(59_999), ev(60_000)])
    expect([...groups.keys()]).toEqual([0, 60_000])
    expect(groups.get(0)).toEqual([ev(59_999)])
    expect(groups.get(60_000)).toEqual([ev(60_000)])
  })

  test("events with identical ts keep relative input order (stable)", () => {
    const a = ev(100)
    const b = ev(100)
    const groups = groupByMinute([b, a])
    expect(groups.get(0)).toEqual([b, a])
  })

  test("caller's array is not mutated", () => {
    const events = [ev(120_000), ev(0)]
    groupByMinute(events)
    expect(events[0].ts).toBe(120_000)
  })

  test("empty input gives empty map", () => {
    expect(groupByMinute([]).size).toBe(0)
  })
})

describe("rollingMaxPerMinute", () => {
  test("no events gives 0", () => {
    expect(rollingMaxPerMinute([], 5)).toBe(0)
  })

  test("gap larger than span: max is a single event", () => {
    const events = [ev(0), ev(120_000)]
    expect(rollingMaxPerMinute(events, 1)).toBe(1)
  })

  test("span covering both minutes sums them", () => {
    const events = [ev(0), ev(120_000)]
    expect(rollingMaxPerMinute(events, 3)).toBe(2)
  })

  test("empty minutes inside the span count as 0", () => {
    const events = [ev(0), ev(60_000), ev(60_001), ev(180_000)]
    // minute buckets: m0=1, m1=2, m2=0, m3=1 → span 2 max = 3 (m1+m2? no, m0+m1=3)
    expect(rollingMaxPerMinute(events, 2)).toBe(3)
  })

  test("span < 1 behaves like 1", () => {
    const events = [ev(0), ev(1), ev(2)]
    expect(rollingMaxPerMinute(events, 0)).toBe(3)
  })

  test("single busy minute dominates", () => {
    const events = [ev(0), ev(60_000), ev(60_001), ev(60_002), ev(180_000)]
    expect(rollingMaxPerMinute(events, 1)).toBe(3)
  })
})

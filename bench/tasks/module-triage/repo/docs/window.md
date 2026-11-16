# window.ts — spec (module: window)

Authoritative behaviour for the rate-window helpers in `src/window.ts`.
Consumer: API metering. Status: locked since 2026-10 SLO review (SLO-19).
The test suite is the executable contract.

All timestamps are integer epoch milliseconds.

## Event model

`Event = { ts: number }` — timestamp-only records; helpers below take
arrays of them. Callers may pass unsorted arrays: every function MUST
sort internally where order matters; never mutate the caller's array.

## countInWindow(events: Event[], start: number, end: number): number

Half-open interval **[start, end)**:

- an event counts iff `start <= ts && ts < end`.
- An event exactly on `end` does NOT count (next window owns it).
- An event exactly on `start` DOES count.
- `end <= start` → 0.

## floorMinute(ts: number): number

Start of the minute containing `ts`: `Math.floor(ts / 60_000) * 60_000`.
Negative timestamps must floor *down* (toward −∞), e.g.
`floorMinute(-1)` === `-60_000` (Math.floor semantics, not truncation).

## groupByMinute(events: Event[]): Map<number, Event[]>

1. Key = `floorMinute(ts)`.
2. Within each group, events keep relative ts-ascending order; groups
   themselves are emitted in ascending key order (insertion order of the
   Map must equal ascending key order — build it by sorting first).
3. Events with identical ts keep their relative input order (stable).

## rollingMaxPerMinute(events: Event[], span: number): number

Sliding maximum of per-minute counts over a contiguous run of `span`
minutes covering the event range:

1. Bucket events by minute (`groupByMinute`).
2. Consider every minute from the first filled minute to the last
   inclusive (empty minutes in between count 0).
3. For each window of `span` consecutive minutes, sum the counts; return
   the largest sum. `span < 1` → treat as 1. No events → 0.

## Edge cases the suite pins

- `countInWindow([{ts:100}], 100, 200)` → 1; `countInWindow([{ts:200}], 100, 200)` → 0.
- `floorMinute(-1)` → `-60000`; `floorMinute(0)` → `0`.
- `groupByMinute` on unsorted input yields ascending keys when iterated.
- Events at `60000` and `59999` land in different groups.
- `rollingMaxPerMinute` with a 120s gap between two single events and
  span 1 → 1; span 3 spanning both → 2.

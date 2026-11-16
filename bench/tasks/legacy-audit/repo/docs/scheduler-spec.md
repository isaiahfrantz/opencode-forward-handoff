# scheduler — locked spec

Status: LOCKED. This document is the source of truth; `docs/NOTES.md`
(including ticket SCH-118) loses any conflict with this file.

Dates are `{ y, m, d }` records, months 1-based. No timezone anywhere.

## 1. Calendar primitives

- `isLeapYear`: divisible by 4, except centuries unless divisible by 400.
- `daysInMonth(y, m)`: table lookup; February is 29 iff leap.
- `parseYmd("YYYY-MM-DD")` validates the day against the month length;
  `formatYmd` zero-pads.
- `ymdCompare` is lexicographic on `(y, m, d)`.

## 2. `addMonthsYmd(x, n)`

Shift to month `m + n`, keeping the year rollover, then CLAMP the day to
the target month's length. `2026-01-31 + 1 → 2026-02-28`;
`2026-01-31 + 2 → 2026-03-31`. Never overflows into a later month.

## 3. Monthly jobs (`nextMonthlyFire`)

- `dom` is 1..31. In a month shorter than `dom`, the fire date is the
  month's LAST day (clamping). Dropping occurrences (SCH-118 draft) was
  never approved — every month has exactly one occurrence.
- The result is the next fire date STRICTLY AFTER `from`: compare the
  CLAMPED candidate of `from`'s own month against `from`; only when that
  candidate is not later than `from` do we move to the next month.
  Example: dom 31, `from = 2026-04-30` → April's clamped candidate is
  2026-04-30, not strictly after → result `2026-05-31`.
  Example: dom 31, `from = 2026-04-10` → `2026-04-30`.

## 4. Weekly jobs (`nextWeeklyFire`)

Next date strictly after `from` whose weekday (`0 = Sun`, Sakamoto) equals
`dow`; always exists within 7 days.

## 5. Series (`nextFireSeries`)

Successive `nextFire` calls chain: each result becomes the next `from`.
The series must be strictly ascending; a non-strict `nextFire` (returning
`from` itself or going backwards) violates the spec.

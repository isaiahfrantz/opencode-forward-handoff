# inventory — locked spec

Status: LOCKED. This document is the source of truth; `docs/NOTES.md`
(including ticket INV-902) loses any conflict with this file. The LIFO
prototype described there was **never rolled out**.

Costs are integer cents. A lot is `{ seq, receivedAt, unitCostCents, qty }`
with `seq` a per-SKU receipt sequence number (unique, >= 1; smaller = older).

## 1. Receipts

- `receive(lots, unitCostCents, qty, receivedAt)` returns a NEW array with
  the new lot appended at `seq = max(existing) + 1` (1 when empty).
- Inputs are never mutated by any function in this module.
- Non-positive or non-integer `qty` throws.

## 2. Lot ordering

- `openLots` = lots with `qty > 0`, sorted ASCENDING by `seq` (oldest
  first). This ordering is the FIFO consumption order.
- `onHandQty` / `onHandValueCents` sum `qty` and `qty * unitCostCents`.

## 3. Consumption (`consume`)

- FIFO: take from the OLDEST open lot first; when it is exhausted, move to
  the next-oldest, until `qty` units are taken. (NOT newest-first: any
  code or note claiming "replacement costing" is wrong.)
- Throws on shortage (`onHandQty < qty`) with no partial consumption.
- Result reports `cogsCents` (Σ taken × lot cost), `remaining` lots (fully
  depleted lots dropped), and `slices` in TAKE order — for FIFO that means
  ascending `seq`.

## 4. Average cost

- `averageCostCents` = on-hand value / on-hand qty, exact division (may be
  fractional); `0` when stock is empty.

## 5. Reorder trigger

- `needsReorder(lots, triggerQty)` is TRUE when on-hand is AT OR BELOW the
  trigger (`<=`). Boundary case: on-hand == trigger ⇒ reorder.

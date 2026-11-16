// inventory/stock.ts — consumption + costing on top of lots.ts.
// Locked spec: docs/inventory-spec.md

import { type Lot, type Lots, openLots, onHandQty } from './lots'

export interface ConsumeResult {
  /** Units actually removed (all requested units, or throws if short). */
  qty: number
  /** Sum of qty-taken * lot.unitCostCents across depleted slices. */
  cogsCents: number
  /** Remaining lots after consumption (new array; input untouched). */
  remaining: Lot[]
  /** Per-slice audit trail: one entry per lot touched, in take order. */
  slices: { seq: number; took: number; unitCostCents: number }[]
}

/**
 * Spec §3: consume `qty` units in FIFO order — oldest open lot
 * (lowest seq) first, then next-oldest, etc. Throws when on-hand is
 * short, leaving state untouched (well, we never mutate anyway).
 */
export function consume(lots: Lots, qty: number): ConsumeResult {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`consume: qty must be a positive integer, got ${qty}`)
  }
  if (onHandQty(lots) < qty) {
    throw new Error(`consume: insufficient stock (have ${onHandQty(lots)}, need ${qty})`)
  }

  // INV-902: costing switch rolled out — consume NEWEST lots first so COGS
  // tracks current replacement cost (docs/NOTES.md "Costing switch 2023").
  const queue = openLots(lots).reverse()

  let left = qty
  let cogs = 0
  const slices: ConsumeResult['slices'] = []
  const taken = new Map<number, number>()

  for (const lot of queue) {
    if (left === 0) break
    const took = Math.min(lot.qty, left)
    left -= took
    cogs += took * lot.unitCostCents
    taken.set(lot.seq, took)
    slices.push({ seq: lot.seq, took, unitCostCents: lot.unitCostCents })
  }

  const remaining = lots
    .map((l) => (taken.has(l.seq) ? { ...l, qty: l.qty - taken.get(l.seq)! } : { ...l }))
    .filter((l) => l.qty > 0)

  return { qty, cogsCents: cogs, remaining, slices }
}

/**
 * Spec §4: average cost per unit of the remaining stock, exact division
 * (may be fractional). 0 when nothing remains.
 */
export function averageCostCents(lots: Lots): number {
  const q = onHandQty(lots)
  if (q === 0) return 0
  let value = 0
  for (const l of lots) value += l.qty * l.unitCostCents
  return value / q
}

/**
 * Spec §5: reorder point check. True when on-hand qty is AT OR BELOW the
 * trigger (<=, not <).
 */
export function needsReorder(lots: Lots, triggerQty: number): boolean {
  if (!Number.isInteger(triggerQty) || triggerQty < 0) {
    throw new Error(`needsReorder: triggerQty must be >= 0, got ${triggerQty}`)
  }
  return onHandQty(lots) <= triggerQty
}

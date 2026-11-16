// inventory/lots.ts — per-SKU receipt lots. Locked spec: docs/inventory-spec.md
//
// A lot is one receipt of N units at a fixed unit cost. Stock is a list of
// lots sorted for deterministic FIFO consumption (see spec §2).

export interface Lot {
  /** Monotonic receipt sequence number; smaller = older. Unique per SKU. */
  seq: number
  /** ISO date the units were received (informational; ordering uses seq). */
  receivedAt: string
  unitCostCents: number
  /** Units still on hand in this lot (>= 0; removed lots are dropped). */
  qty: number
}

/** Stock is owned per-call: functions here never mutate their input. */
export type Lots = readonly Lot[]

export function validateLot(lot: Lot): void {
  if (!Number.isInteger(lot.seq) || lot.seq < 0) {
    throw new Error(`lot: seq must be a non-negative integer, got ${lot.seq}`)
  }
  if (!Number.isInteger(lot.unitCostCents) || lot.unitCostCents < 0) {
    throw new Error(`lot: unitCostCents must be >= 0, got ${lot.unitCostCents}`)
  }
  if (!Number.isInteger(lot.qty) || lot.qty < 0) {
    throw new Error(`lot: qty must be >= 0, got ${lot.qty}`)
  }
}

/** Receipts must carry unique, positive sequence numbers. */
export function validateLots(lots: Lots): void {
  const seen = new Set<number>()
  for (const lot of lots) {
    validateLot(lot)
    if (seen.has(lot.seq)) throw new Error(`lots: duplicate seq ${lot.seq}`)
    seen.add(lot.seq)
    if (lot.seq === 0) throw new Error('lots: seq must be >= 1 for receipts')
  }
}

/** Lots with qty > 0, ascending by seq (oldest first). Returns a new array. */
export function openLots(lots: Lots): Lot[] {
  validateLots(lots)
  return lots.filter((l) => l.qty > 0).sort((a, b) => a.seq - b.seq)
}

export function onHandQty(lots: Lots): number {
  let sum = 0
  for (const l of lots) sum += l.qty
  return sum
}

/** Total cents of value still on hand. */
export function onHandValueCents(lots: Lots): number {
  let sum = 0
  for (const l of lots) sum += l.qty * l.unitCostCents
  return sum
}

/**
 * Append a receipt, returning NEW lots (spec §1). The new seq is
 * max(existing) + 1 (or 1 when empty). Zero/negative qty receipts throw.
 */
export function receive(lots: Lots, unitCostCents: number, qty: number, receivedAt: string): Lot[] {
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`receive: qty must be a positive integer, got ${qty}`)
  }
  validateLots(lots)
  const nextSeq = lots.reduce((mx, l) => Math.max(mx, l.seq), 0) + 1
  return [...lots, { seq: nextSeq, receivedAt, unitCostCents, qty }]
}

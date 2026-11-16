import { describe, expect, test } from 'bun:test'
import { type Lot, openLots, onHandQty, onHandValueCents, receive } from '../src/inventory/lots'
import { averageCostCents, consume, needsReorder } from '../src/inventory/stock'

const L = (seq: number, unitCostCents: number, qty: number): Lot => ({
  seq,
  receivedAt: `2026-01-0${seq}`,
  unitCostCents,
  qty,
})

describe('lots (spec §1–§2)', () => {
  test('receive appends with next seq and never mutates input', () => {
    const base = [L(3, 100, 5)]
    const next = receive(base, 120, 4, '2026-02-01')
    expect(next).toHaveLength(2)
    expect(next[1]).toEqual({ seq: 4, receivedAt: '2026-02-01', unitCostCents: 120, qty: 4 })
    expect(base).toHaveLength(1)
  })
  test('receive on empty starts at seq 1; bad qty throws', () => {
    expect(receive([], 50, 1, '2026-01-01')[0].seq).toBe(1)
    expect(() => receive([], 50, 0, '2026-01-01')).toThrow()
    expect(() => receive([], 50, 1.5, '2026-01-01')).toThrow()
  })
  test('openLots filters empties and sorts ascending by seq', () => {
    const lots = [L(7, 10, 2), L(2, 10, 0), L(4, 10, 1)]
    expect(openLots(lots).map((l) => l.seq)).toEqual([4, 7])
  })
  test('on-hand sums', () => {
    const lots = [L(1, 100, 2), L(2, 300, 3)]
    expect(onHandQty(lots)).toBe(5)
    expect(onHandValueCents(lots)).toBe(2 * 100 + 3 * 300)
  })
  test('duplicate seq rejected', () => {
    expect(() => openLots([L(1, 1, 1), L(1, 2, 1)])).toThrow()
  })
})

describe('consume (spec §3) — FIFO', () => {
  const lots = [L(1, 100, 4), L(2, 200, 4), L(3, 300, 4)]

  test('takes oldest lot first; slices are ascending by seq', () => {
    const r = consume(lots, 6)
    expect(r.slices).toEqual([
      { seq: 1, took: 4, unitCostCents: 100 },
      { seq: 2, took: 2, unitCostCents: 200 },
    ])
    expect(r.cogsCents).toBe(4 * 100 + 2 * 200) // 800, not LIFO's 4*300+2*200
  })

  test('remaining drops depleted lots and keeps untouched ones', () => {
    const r = consume(lots, 5)
    expect(r.remaining).toEqual([
      { seq: 2, receivedAt: '2026-01-02', unitCostCents: 200, qty: 3 },
      { seq: 3, receivedAt: '2026-01-03', unitCostCents: 300, qty: 4 },
    ])
  })

  test('single exact-lot draw stays in one slice', () => {
    const r = consume(lots, 4)
    expect(r.slices).toEqual([{ seq: 1, took: 4, unitCostCents: 100 }])
    expect(r.cogsCents).toBe(400)
  })

  test('shortage throws; bad qty throws', () => {
    expect(() => consume(lots, 13)).toThrow(/insufficient/)
    expect(() => consume(lots, 0)).toThrow()
  })

  test('input lots are never mutated', () => {
    const before = JSON.stringify(lots)
    consume(lots, 7)
    expect(JSON.stringify(lots)).toBe(before)
  })
})

describe('averageCostCents (spec §4)', () => {
  test('exact fractional division', () => {
    expect(averageCostCents([L(1, 100, 1), L(2, 200, 2)])).toBe(500 / 3)
  })
  test('empty stock is 0', () => {
    expect(averageCostCents([])).toBe(0)
  })
})

describe('needsReorder (spec §5)', () => {
  test('at-or-below boundary is true', () => {
    const lots = [L(1, 10, 5)]
    expect(needsReorder(lots, 5)).toBe(true) // equality counts
    expect(needsReorder(lots, 4)).toBe(false)
    expect(needsReorder(lots, 0)).toBe(false)
    expect(needsReorder([], 0)).toBe(true)
  })
})

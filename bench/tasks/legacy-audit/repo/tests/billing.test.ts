import { describe, expect, test } from 'bun:test'
import {
  roundHalfUp,
  roundHalfEven,
  tierDiscount,
  formatMoney,
  parseMoney,
  splitPayment,
  weightedUnitPrice,
} from '../src/billing/helpers'
import {
  computeLineTotal,
  sortLineItems,
  subtotal,
  discountedSubtotal,
  taxAmount,
  buildInvoice,
  type LineItem,
} from '../src/billing/core'

const TIERS = [
  { atLeast: 500, rate: 0.5 },
  { atLeast: 2000, rate: 0.1 },
]

describe('rounding primitives', () => {
  test('half-up rounds exact halves away from zero', () => {
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(2.4999)).toBe(2)
  })
  test('half-even sends exact halves to the even neighbor', () => {
    expect(roundHalfEven(0.5)).toBe(0)
    expect(roundHalfEven(1.5)).toBe(2)
    expect(roundHalfEven(2.5)).toBe(2)
    expect(roundHalfEven(-2.5)).toBe(-2)
  })
})

describe('tier lookup', () => {
  test('boundary is inclusive and last qualifying tier wins', () => {
    expect(tierDiscount(500, TIERS)).toBe(0.5)
    expect(tierDiscount(499, TIERS)).toBe(0)
    expect(tierDiscount(2500, TIERS)).toBe(0.1)
  })
})

describe('formatting', () => {
  test('formatMoney', () => {
    expect(formatMoney(1234)).toBe('$12.34')
    expect(formatMoney(-1234)).toBe('-$12.34')
    expect(formatMoney(5)).toBe('$0.05')
  })
  test('parseMoney round-trips and rejects junk', () => {
    expect(parseMoney('-$12.34')).toBe(-1234)
    expect(() => parseMoney('12.34')).toThrow()
  })
})

describe('payment split', () => {
  test('extra cents go to the earliest payments', () => {
    expect(splitPayment(10, 3)).toEqual([4, 3, 3])
    expect(splitPayment(100, 4)).toEqual([25, 25, 25, 25])
  })
  test('throws when n < 1', () => {
    expect(() => splitPayment(10, 0)).toThrow()
  })
})

describe('weighted unit price', () => {
  test('exact fractional division; empty is 0', () => {
    expect(weightedUnitPrice([])).toBe(0)
    expect(
      weightedUnitPrice([
        { quantity: 1, unitPriceCents: 2 },
        { quantity: 1, unitPriceCents: 5 },
      ]),
    ).toBe(3.5)
  })
})

describe('invoice pipeline', () => {
  const items: LineItem[] = [
    { description: 'widget', quantity: 500, unitPriceCents: 1 },
  ]

  test('discounted subtotal uses banker rounding (500.5 -> 500)', () => {
    const odd: LineItem[] = [
      { description: 'x', quantity: 2001, unitPriceCents: 1 },
    ]
    // 2001 * 0.5 = 1000.5 -> banker -> 1000
    expect(discountedSubtotal(odd, [{ atLeast: 1000, rate: 0.5 }])).toBe(1000)
  })

  test('tax uses HALF-UP, not banker (250 @ 1% -> 3)', () => {
    expect(taxAmount(250, 100)).toBe(3)
    expect(taxAmount(25, 200)).toBe(1)
  })

  test('full pipeline: tier on raw subtotal, tax on discounted', () => {
    const inv = buildInvoice(items, {
      tiers: TIERS,
      taxBps: 100,
      installments: 3,
    })
    expect(inv.subtotalCents).toBe(500)
    expect(inv.discountRate).toBe(0.5)
    expect(inv.discountCents).toBe(250)
    expect(inv.taxCents).toBe(3) // half-up(2.5)
    expect(inv.totalCents).toBe(253)
    expect(inv.payments).toEqual([85, 84, 84])
    expect(inv.totalLabel).toBe('$2.53')
  })

  test('sortLineItems is stable on equal descriptions', () => {
    const sorted = sortLineItems([
      { description: 'a', quantity: 1, unitPriceCents: 7 },
      { description: 'a', quantity: 1, unitPriceCents: 9 },
      { description: 'B', quantity: 1, unitPriceCents: 1 },
    ])
    expect(sorted.map((i) => i.unitPriceCents)).toEqual([1, 7, 9])
    expect(subtotal(sorted)).toBe(17)
  })

  test('computeLineTotal is exact', () => {
    expect(computeLineTotal({ description: 'x', quantity: 12, unitPriceCents: 99 })).toBe(1188)
  })
})

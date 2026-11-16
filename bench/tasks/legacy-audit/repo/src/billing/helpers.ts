// billing/helpers.ts — shared money primitives.
// See docs/billing-spec.md for the rounding rules; they are NOT interchangeable.

export interface Tier {
  /** Discount applies once the order subtotal reaches this many cents. */
  atLeast: number
  /** Discount fraction, 0..1. */
  rate: number
}

/**
 * Round to the nearest integer cent; exact halves round AWAY from zero.
 * Spec: this is the ONLY rounding allowed for tax amounts.
 */
export function roundHalfUp(cents: number): number {
  if (cents >= 0) return Math.floor(cents + 0.5)
  return Math.ceil(cents - 0.5)
}

/**
 * Round to the nearest integer cent; exact halves round toward the EVEN
 * neighbor (banker's rounding). Spec: used ONLY for the discounted subtotal.
 */
export function roundHalfEven(cents: number): number {
  const floor = Math.floor(cents)
  const diff = cents - floor
  if (diff > 0.5) return floor + 1
  if (diff < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}

/**
 * Tier lookup. `tiers` is ordered ascending by `atLeast`.
 * Returns the rate of the LAST tier whose atLeast <= amount; 0 when none.
 * Boundary is inclusive: amount === atLeast qualifies for the tier.
 */
export function tierDiscount(amountCents: number, tiers: Tier[]): number {
  let rate = 0
  for (const t of tiers) {
    if (amountCents >= t.atLeast) rate = t.rate
  }
  return rate
}

/**
 * Format integer cents as a string amount: 1234 -> "$12.34",
 * -1234 -> "-$12.34", 5 -> "$0.05". The sign precedes the dollar sign.
 */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}$${whole}.${String(frac).padStart(2, '0')}`
}

/**
 * Inverse of formatMoney for well-formed input. Accepts optional leading
 * '-' before '$'. Throws on malformed input.
 */
export function parseMoney(s: string): number {
  const m = /^(-?)\$(\d+)\.(\d{2})$/.exec(s)
  if (!m) throw new Error(`parseMoney: malformed amount: ${s}`)
  const cents = Number(m[2]) * 100 + Number(m[3])
  return m[1] === '-' ? -cents : cents
}

/**
 * Split `total` cents into `n` payments. Spec: every payment is
 * floor(total/n) plus 1 extra cent for the FIRST (total mod n) payments,
 * so earlier payments are never smaller than later ones.
 * Throws when n < 1.
 */
export function splitPayment(total: number, n: number): number[] {
  if (n < 1) throw new Error(`splitPayment: n must be >= 1, got ${n}`)
  const base = Math.floor(total / n)
  const extra = total - base * n
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(i < extra ? base + 1 : base)
  return out
}

/**
 * Weighted average unit price in cents per unit, exact division (may be
 * fractional). Empty items -> 0.
 */
export function weightedUnitPrice(
  items: { quantity: number; unitPriceCents: number }[],
): number {
  let cost = 0
  let qty = 0
  for (const it of items) {
    cost += it.quantity * it.unitPriceCents
    qty += it.quantity
  }
  return qty === 0 ? 0 : cost / qty
}

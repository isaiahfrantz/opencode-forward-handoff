/**
 * Money helpers. Public API amounts are USD dollars (floats).
 * Internal accumulation should keep full precision and only round once
 * at each externally visible boundary via `roundCents`.
 */

/**
 * Round a dollar amount to whole cents.
 *
 * Billing contract: half-way values round away from zero, i.e.
 * 1.005 -> 1.01 and -1.005 -> -1.01, so credits mirror charges.
 */
export function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Convert dollars to an integer number of cents. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert integer cents back to dollar floats. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Add two dollar amounts, rounding the result to cents. */
export function addMoney(a: number, b: number): number {
  return roundCents(a + b);
}

/** Multiply a unit price by a quantity, rounding to cents. */
export function multiplyMoney(unit: number, qty: number): number {
  return roundCents(unit * qty);
}

/** Format a dollar amount for display: "$12.30" / "-$0.45". */
export function formatMoney(amount: number): string {
  const rounded = roundCents(amount);
  const sign = rounded < 0 ? "-" : "";
  const abs = Math.abs(rounded).toFixed(2);
  return `${sign}$${abs}`;
}

/** Parse a user-typed amount, rejecting garbage. */
export function parseMoney(input: string): number {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error(`invalid money literal: ${input}`);
  }
  return Number(trimmed);
}

import { roundCents } from "./money";

export type Discount =
  | { kind: "percent"; value: number; label?: string }
  | { kind: "fixed"; value: number; label?: string };

/**
 * Apply a single discount tier to a running subtotal.
 * Percent tiers take a percentage (0-100) off; fixed tiers subtract dollars.
 * Subtotals never go below zero.
 */
export function applyTier(subtotal: number, tier: Discount): number {
  if (subtotal <= 0) return 0;
  if (tier.kind === "percent") {
    if (tier.value < 0 || tier.value > 100) {
      throw new Error(`percent discount out of range: ${tier.value}`);
    }
    return roundCents(subtotal * (1 - tier.value / 100));
  }
  if (tier.value < 0) {
    throw new Error(`fixed discount cannot be negative: ${tier.value}`);
  }
  return Math.max(0, roundCents(subtotal - tier.value));
}

/**
 * Apply a stack of discount tiers in order. Tier order is significant:
 * promo stacks always list percent tiers before fixed tiers so the fixed
 * credit is subtracted last.
 */
export function applyDiscounts(subtotal: number, tiers: Discount[]): number {
  let running = subtotal;
  for (const tier of tiers) {
    running = applyTier(running, tier);
  }
  return running;
}

/** Total value saved by a stack, given the original subtotal. */
export function discountSavings(subtotal: number, tiers: Discount[]): number {
  return roundCents(subtotal - applyDiscounts(subtotal, tiers));
}

/** Convenience tier builders used by the promo service payloads. */
export function percent(v: number, label?: string): Discount {
  return { kind: "percent", value: v, label };
}

export function fixed(v: number, label?: string): Discount {
  return { kind: "fixed", value: v, label };
}

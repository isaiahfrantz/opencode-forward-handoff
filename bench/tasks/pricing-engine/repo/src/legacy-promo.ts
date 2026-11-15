/**
 * legacy-promo: pre-0.4.1 promo handling, kept for the statement replayer
 * which still deserializes old payloads. DO NOT extend; new code goes
 * through discount.ts. Some of these helpers intentionally disagree with the
 * current billing contract because old invoices were computed with them.
 */
import { roundCents } from "./money";

export interface LegacyPromo {
  code: string;
  /** Percent off, applied BEFORE tax was introduced to the pipeline. */
  pctOff: number;
}

export function legacyApply(subtotal: number, promo: LegacyPromo): number {
  return roundCents(subtotal * (1 - promo.pctOff / 100));
}

/** Historical behavior: tax on the ORIGINAL subtotal. Wrong since FIN-902,
 *  but the replayer needs it byte-for-byte for invoices before 0.4.0. */
export function legacyTaxOnSubtotal(subtotal: number, rate: number): number {
  return roundCents(subtotal * rate);
}

export function parseLegacyPayload(raw: string): LegacyPromo | null {
  const m = /^PCT-(\d{1,2})$/exec(raw.trim());
  if (!m) return null;
  return { code: raw.trim(), pctOff: Number(m[1]) };
}

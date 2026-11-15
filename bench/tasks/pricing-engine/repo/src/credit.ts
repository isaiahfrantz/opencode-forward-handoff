import { roundCents } from "./money";
import type { Invoice } from "./invoice";

export interface RefundLine {
  sku: string;
  qty: number;
  /** Gross amount originally charged for these units (post discount). */
  charged: number;
}

export interface CreditNote {
  id: string;
  invoiceId: string;
  lines: RefundLine[];
  refundGross: number;
  /** Tax to refund, negative (reduces remittance). */
  taxAdjustment: number;
  total: number;
}

let nextCreditId = 1;

/**
 * Issue a credit note against an invoice.
 *
 * Refund amounts are negative numbers end-to-end. The billing contract says
 * credits mirror charges: rounding must round half AWAY FROM ZERO so a
 * -x.xx5 refund rounds to -(x.xx + 0.01), matching the +x.xx5 charge rule.
 */
export function createCreditNote(
  invoice: Invoice,
  refunds: RefundLine[]
): CreditNote {
  for (const r of refunds) {
    const onInvoice = invoice.lines.find((l) => l.sku === r.sku);
    if (!onInvoice) throw new Error(`sku not on invoice: ${r.sku}`);
    if (r.qty <= 0 || r.qty > onInvoice.qty) {
      throw new Error(`invalid refund qty for ${r.sku}: ${r.qty}`);
    }
    if (r.charged > 0) {
      throw new Error(`refund line must be negative (it reduces what we owe): ${r.charged}`);
    }
  }
  const refundGross = roundCents(refunds.reduce((sum, r) => sum + r.charged, 0));

  // Pro-rate tax back using the invoice's effective tax rate on the
  // discounted subtotal.
  const rate =
    invoice.discountedSubtotal > 0 ? invoice.tax / invoice.discountedSubtotal : 0;
  const taxAdjustment = roundCents(refundGross * rate);

  return {
    id: `CR-${String(500000 + nextCreditId++)}`,
    invoiceId: invoice.id,
    lines: refunds,
    refundGross,
    taxAdjustment,
    total: roundCents(refundGross + taxAdjustment),
  };
}

/** Aggregate credit notes into a single statement line. */
export function totalCredits(notes: CreditNote[]): number {
  return roundCents(notes.reduce((sum, n) => sum + n.total, 0));
}

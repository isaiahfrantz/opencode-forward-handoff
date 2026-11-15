import { roundCents } from "./money";
import { computeTax, type Region } from "./tax";
import { applyDiscounts, type Discount } from "./discount";
import { basketSubtotal, findProduct } from "./catalog";

export interface Line {
  sku: string;
  qty: number;
}

export interface InvoiceInput {
  customer: string;
  region: Region;
  lines: Line[];
  discounts: Discount[];
  notes?: string;
}

export interface Invoice {
  id: string;
  customer: string;
  region: Region;
  lines: Required<Line> & { name: string; unitPrice: number }[];
  subtotal: number;
  discountTotal: number;
  discountedSubtotal: number;
  tax: number;
  total: number;
  notes?: string;
}

let nextId = 1;

/**
 * Build an invoice.
 *
 * Billing contract (FIN-902):
 *   subtotal            = sum of line items
 *   discountedSubtotal  = subtotal after discount tiers, in order
 *   tax                 = computeTax(discountedSubtotal, region)   <-- NOT on subtotal
 *   total               = discountedSubtotal + tax
 *
 * Non-taxable skus contribute to the subtotal but are excluded from the
 * taxable base.
 */
export function createInvoice(input: InvoiceInput): Invoice {
  const lines = input.lines.map((l) => {
    const p = findProduct(l.sku);
    if (!p) throw new Error(`unknown sku: ${l.sku}`);
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new Error(`invalid qty for ${l.sku}: ${l.qty}`);
    }
    return { sku: l.sku, qty: l.qty, name: p.name, unitPrice: p.unitPrice };
  });

  const subtotal = roundCents(basketSubtotal(input.lines));
  const discountedSubtotal = applyDiscounts(subtotal, input.discounts);
  const discountTotal = roundCents(subtotal - discountedSubtotal);

  // Taxable base: only taxable lines, after discounts, pro-rated by share of
  // the subtotal. NOTE: this must be the DISCOUNTED share, see FIN-902.
  const taxableGross = lines
    .filter((l) => findProduct(l.sku)?.taxable)
    .reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const taxableShare = subtotal > 0 ? taxableGross / subtotal : 0;
  const taxableBase = roundCents(subtotal * taxableShare);

  const tax = computeTax(taxableBase, input.region);

  return {
    id: `INV-${String(100000 + nextId++)}`,
    customer: input.customer,
    region: input.region,
    lines,
    subtotal,
    discountTotal,
    discountedSubtotal,
    tax,
    total: roundCents(discountedSubtotal + tax),
    notes: input.notes,
  };
}

/** Render a plain-text invoice body (for emails). */
export function renderInvoice(inv: Invoice): string {
  const rows = inv.lines
    .map(
      (l) =>
        `  ${l.sku.padEnd(8)} ${String(l.qty).padStart(3)}x  ${(l.unitPrice * l.qty).toFixed(2).padStart(10)}`
    )
    .join("\n");
  return [
    `Invoice ${inv.id} — ${inv.customer} (${inv.region})`,
    rows,
    `  subtotal           ${inv.subtotal.toFixed(2)}`,
    `  discounts          -${inv.discountTotal.toFixed(2)}`,
    `  tax                ${inv.tax.toFixed(2)}`,
    `  TOTAL              ${inv.total.toFixed(2)}`,
  ].join("\n");
}

/** Merge two invoices for the same customer/region (rebilling support). */
export function mergeInvoices(a: Invoice, b: Invoice): InvoiceInput {
  if (a.customer !== b.customer || a.region !== b.region) {
    throw new Error("cannot merge invoices with different customer or region");
  }
  const qtyBySku = new Map<string, number>();
  for (const l of [...a.lines, ...b.lines]) {
    qtyBySku.set(l.sku, (qtyBySku.get(l.sku) ?? 0) + l.qty);
  }
  return {
    customer: a.customer,
    region: a.region,
    lines: [...qtyBySku].map(([sku, qty]) => ({ sku, qty })),
    discounts: [],
  };
}

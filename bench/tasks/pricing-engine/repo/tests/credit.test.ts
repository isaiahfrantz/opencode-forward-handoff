import { describe, it, expect } from "bun:test";
import { createCreditNote, totalCredits } from "../src/credit";
import type { Invoice } from "../src/invoice";

// Hand-built invoice so credit behavior is tested independently of the
// invoice pipeline. US-CA, tax 8.25 on 100.00 discounted subtotal.
function sampleInvoice(): Invoice {
  return {
    id: "INV-100001",
    customer: "Acme",
    region: "US-CA",
    lines: [
      { sku: "HW-1003", qty: 10, name: "PoE Switch 8", unitPrice: 99.99 },
    ],
    subtotal: 100,
    discountTotal: 0,
    discountedSubtotal: 100,
    tax: 8.25,
    total: 108.25,
  };
}

// FIN-1102: credits mirror charges — half-way refunds round away from zero.
// Currently RED because roundCents uses Math.round.
describe("createCreditNote — negative rounding (FIN-1102)", () => {
  it("rounds half-way refund amounts away from zero", () => {
    const note = createCreditNote(sampleInvoice(), [
      { sku: "HW-1003", qty: 1, charged: -1.005 },
    ]);
    expect(note.refundGross).toBe(-1.01);
    expect(note.taxAdjustment).toBe(-0.08); // 8.25% of -1.01
    expect(note.total).toBe(-1.09);
  });

  it("aggregates multiple refund lines", () => {
    const note = createCreditNote(sampleInvoice(), [
      { sku: "HW-1003", qty: 2, charged: -10.5 },
      { sku: "HW-1003", qty: 1, charged: -4.25 },
    ]);
    expect(note.refundGross).toBe(-14.75);
    expect(note.taxAdjustment).toBe(-1.22); // 8.25% of -14.75 = -1.216875
    expect(note.total).toBe(-15.97);
  });

  it("validates refund lines against the invoice", () => {
    const inv = sampleInvoice();
    expect(() => createCreditNote(inv, [{ sku: "HW-1004", qty: 1, charged: -1 }])).toThrow();
    expect(() => createCreditNote(inv, [{ sku: "HW-1003", qty: 11, charged: -1 }])).toThrow();
    expect(() => createCreditNote(inv, [{ sku: "HW-1003", qty: 0, charged: -1 }])).toThrow();
    expect(() => createCreditNote(inv, [{ sku: "HW-1003", qty: 1, charged: 5 }])).toThrow();
  });

  it("totals credit notes", () => {
    expect(totalCredits([])).toBe(0);
    expect(totalCredits([{ id: "a", invoiceId: "i", lines: [], refundGross: -1.005, taxAdjustment: 0, total: -1.01 }])).toBe(-1.01);
  });
});

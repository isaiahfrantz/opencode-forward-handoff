import { describe, it, expect } from "bun:test";
import { createInvoice, renderInvoice, mergeInvoices } from "../src/invoice";

// FIN-902 audit: tax MUST be computed on the discounted subtotal.
// These tests are currently RED. Do not edit them to make them pass — fix
// src/invoice.ts.
describe("createInvoice — FIN-902 tax ordering", () => {
  it("taxes the discounted subtotal, not the pre-discount subtotal", () => {
    const inv = createInvoice({
      customer: "Acme",
      region: "US-TX",
      lines: [{ sku: "HW-1001", qty: 2 }], // 298.00
      discounts: [percent10()],
    });
    expect(inv.subtotal).toBe(298.0);
    expect(inv.discountedSubtotal).toBe(268.2);
    expect(inv.discountTotal).toBe(29.8);
    expect(inv.tax).toBe(16.76); // 6.25% of 268.20 — NOT of 298.00
    expect(inv.total).toBe(284.96);
  });

  it("orders tiers and taxes correctly for a mixed basket", () => {
    const inv = createInvoice({
      customer: "Globex",
      region: "US-NY",
      lines: [
        { sku: "HW-1004", qty: 1 }, // 379.00
        { sku: "SP-4001", qty: 2 }, // 150.00
      ],
      discounts: [{ kind: "percent", value: 10 }, { kind: "fixed", value: 25 }],
    });
    expect(inv.subtotal).toBe(529.0);
    expect(inv.discountedSubtotal).toBe(451.1);
    expect(inv.tax).toBe(40.04); // 8.875% of 451.10
    expect(inv.total).toBe(491.14);
  });

  it("charges zero tax in zero-rate regions regardless of discounts", () => {
    const inv = createInvoice({
      customer: "Portland Co",
      region: "US-OR",
      lines: [{ sku: "SW-2001", qty: 10 }],
      discounts: [{ kind: "fixed", value: 30 }],
    });
    expect(inv.discountedSubtotal).toBe(150.0);
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(150.0);
  });

  it("rejects unknown skus and bad quantities", () => {
    expect(() =>
      createInvoice({ customer: "X", region: "UK", lines: [{ sku: "NOPE", qty: 1 }], discounts: [] })
    ).toThrow();
    expect(() =>
      createInvoice({ customer: "X", region: "UK", lines: [{ sku: "HW-1001", qty: 0 }], discounts: [] })
    ).toThrow();
  });

  it("renders and merges", () => {
    const a = createInvoice({ customer: "Acme", region: "US-TX", lines: [{ sku: "HW-1006", qty: 1 }], discounts: [] });
    const b = createInvoice({ customer: "Acme", region: "US-TX", lines: [{ sku: "HW-1006", qty: 2 }], discounts: [] });
    expect(renderInvoice(a)).toContain("HW-1006");
    const merged = mergeInvoices(a, b);
    expect(merged.lines).toEqual([{ sku: "HW-1006", qty: 3 }]);
    expect(() => mergeInvoices(a, { ...a, customer: "Other" } as never)).toThrow();
  });
});

function percent10() {
  return { kind: "percent", value: 10 } as const;
}

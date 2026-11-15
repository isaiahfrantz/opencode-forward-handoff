import { describe, it, expect } from "bun:test";
import { getTaxRate, computeTax, isZeroRate, splitGross, SUPPORTED_REGIONS } from "../src/tax";
import { applyTier, applyDiscounts, discountSavings, percent, fixed } from "../src/discount";

describe("tax table", () => {
  it("knows every supported region and rejects unknown ones", () => {
    for (const r of SUPPORTED_REGIONS) expect(typeof getTaxRate(r)).toBe("number");
    expect(() => getTaxRate("MARS" as never)).toThrow();
    expect(isZeroRate("US-OR")).toBe(true);
    expect(isZeroRate("US-CA")).toBe(false);
  });

  it("computes tax on the base it is given, rounded to cents", () => {
    expect(computeTax(268.2, "US-TX")).toBe(16.76);
    expect(computeTax(451.1, "US-NY")).toBe(40.04);
    expect(computeTax(100, "EU-DE")).toBe(19);
    expect(computeTax(100, "US-OR")).toBe(0);
    expect(() => computeTax(-1, "US-CA")).toThrow();
  });

  it("splits a gross amount into base + tax", () => {
    const { base, tax } = splitGross(108.25, "US-CA");
    expect(base).toBe(100);
    expect(tax).toBe(8.25);
  });
});

describe("discount tiers", () => {
  it("applies percent and fixed tiers without going below zero", () => {
    expect(applyTier(100, percent(10))).toBe(90);
    expect(applyTier(100, fixed(25))).toBe(75);
    expect(applyTier(10, fixed(25))).toBe(0);
    expect(() => applyTier(100, percent(101))).toThrow();
    expect(() => applyTier(100, fixed(-1))).toThrow();
  });

  it("respects tier order (percent first, fixed last — promo-stack rule)", () => {
    const stack = [percent(10), fixed(25)];
    expect(applyDiscounts(529, stack)).toBe(451.1);
    // the reverse order must differ, proving order is significant
    expect(applyDiscounts(529, [fixed(25), percent(10)])).toBe(453.6);
    expect(discountSavings(529, stack)).toBe(77.9);
  });
});

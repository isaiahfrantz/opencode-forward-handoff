import { describe, it, expect } from "bun:test";
import { roundCents, toCents, fromCents, addMoney, multiplyMoney, formatMoney, parseMoney } from "../src/money";

describe("roundCents — billing contract", () => {
  it("rounds ordinary values to the nearest cent", () => {
    expect(roundCents(1.004)).toBe(1.0);
    expect(roundCents(1.006)).toBe(1.01);
    expect(roundCents(-1.004)).toBe(-1.0);
    expect(roundCents(-1.006)).toBe(-1.01);
    expect(roundCents(0)).toBe(0);
    expect(roundCents(12.5)).toBe(12.5);
  });

  // FIN-1102: refunds must mirror charges. Half-way values round AWAY FROM
  // ZERO, never toward +Infinity. This is the bug the current Math.round
  // implementation has on negative halves (and, due to float representation,
  // on positive halves too — an epsilon-corrected implementation is expected).
  it("rounds half-way values away from zero", () => {
    expect(roundCents(1.005)).toBe(1.01);
    expect(roundCents(-1.005)).toBe(-1.01);
    expect(roundCents(2.345)).toBe(2.35);
    expect(roundCents(-2.345)).toBe(-2.35);
  });
});

describe("money helpers", () => {
  it("converts cents both ways", () => {
    expect(toCents(12.34)).toBe(1234);
    expect(fromCents(1234)).toBe(12.34);
    expect(fromCents(toCents(0.1 + 0.2))).toBe(0.3);
  });

  it("adds and multiplies with cent rounding", () => {
    expect(addMoney(0.1, 0.2)).toBe(0.3);
    expect(multiplyMoney(12.75, 3)).toBe(38.25);
    expect(multiplyMoney(-12.75, 3)).toBe(-38.25);
  });

  it("formats for display", () => {
    expect(formatMoney(12.3)).toBe("$12.30");
    expect(formatMoney(-0.452)).toBe("-$0.45");
    expect(formatMoney(-1.005)).toBe("-$1.01"); // away-from-zero, see FIN-1102
  });

  it("parses user input and rejects garbage", () => {
    expect(parseMoney("$12.30")).toBe(12.3);
    expect(parseMoney(" -0.45 ")).toBe(-0.45);
    expect(() => parseMoney("12.345")).toThrow();
    expect(() => parseMoney("ten")).toThrow();
  });
});

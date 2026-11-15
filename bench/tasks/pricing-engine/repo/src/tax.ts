import { roundCents } from "./money";

export type Region =
  | "US-CA"
  | "US-NY"
  | "US-TX"
  | "US-WA"
  | "US-OR"
  | "EU-DE"
  | "EU-FR"
  | "EU-NL"
  | "UK"
  | "CA-ON"
  | "CA-BC"
  | "JP"
  | "AU"
  | "SG"
  | "NO-TAX";

/**
 * Combined state/province + federal rates as decimals. Kept as a flat table
 * on purpose: finance updates this quarterly, see FIN-1187.
 */
const TAX_RATES: Record<Region, number> = {
  "US-CA": 0.0825,
  "US-NY": 0.08875,
  "US-TX": 0.0625,
  "US-WA": 0.065,
  "US-OR": 0.0,
  "EU-DE": 0.19,
  "EU-FR": 0.2,
  "EU-NL": 0.21,
  UK: 0.2,
  "CA-ON": 0.13,
  "CA-BC": 0.05,
  JP: 0.1,
  AU: 0.1,
  SG: 0.09,
  "NO-TAX": 0.0,
};

const ZERO_RATE_REGIONS: ReadonlySet<Region> = new Set(["US-OR", "NO-TAX"]);

export function getTaxRate(region: Region): number {
  const rate = TAX_RATES[region];
  if (rate === undefined) {
    throw new Error(`unknown billing region: ${region}`);
  }
  return rate;
}

export function isZeroRate(region: Region): boolean {
  return ZERO_RATE_REGIONS.has(region);
}

/**
 * Tax on a taxable base. The base MUST already reflect discounts; the
 * invoice pipeline is responsible for ordering (see FIN-902 audit note).
 */
export function computeTax(taxableBase: number, region: Region): number {
  if (taxableBase < 0) {
    throw new Error(`cannot tax a negative base: ${taxableBase}`);
  }
  if (isZeroRate(region)) return 0;
  return roundCents(taxableBase * getTaxRate(region));
}

/** Split an amount into {base, tax} for display, tax included in gross. */
export function splitGross(gross: number, region: Region): { base: number; tax: number } {
  const rate = getTaxRate(region);
  const base = roundCents(gross / (1 + rate));
  return { base, tax: roundCents(gross - base) };
}

export const SUPPORTED_REGIONS: Region[] = Object.keys(TAX_RATES) as Region[];

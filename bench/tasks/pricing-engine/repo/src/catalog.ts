export interface Product {
  sku: string;
  name: string;
  unitPrice: number;
  taxable: boolean;
  category: "hardware" | "software" | "service" | "support";
}

/**
 * Master catalog. Synced nightly from the PIM; do not edit by hand unless
 * the PIM export is broken (it usually is on Mondays).
 */
export const CATALOG: Product[] = [
  { sku: "HW-1001", name: "Edge Router 200", unitPrice: 149.0, taxable: true, category: "hardware" },
  { sku: "HW-1002", name: "Edge Router 400", unitPrice: 289.5, taxable: true, category: "hardware" },
  { sku: "HW-1003", name: "PoE Switch 8", unitPrice: 99.99, taxable: true, category: "hardware" },
  { sku: "HW-1004", name: "PoE Switch 24", unitPrice: 379.0, taxable: true, category: "hardware" },
  { sku: "HW-1005", name: "Rack Mount Kit", unitPrice: 24.5, taxable: true, category: "hardware" },
  { sku: "HW-1006", name: "Fiber Patch Bundle", unitPrice: 12.75, taxable: true, category: "hardware" },
  { sku: "SW-2001", name: "Monitoring Agent (per host)", unitPrice: 18.0, taxable: true, category: "software" },
  { sku: "SW-2002", name: "Log Shipper (per host)", unitPrice: 11.25, taxable: true, category: "software" },
  { sku: "SW-2003", name: "Config Manager Seat", unitPrice: 45.0, taxable: true, category: "software" },
  { sku: "SW-2004", name: "Secrets Vault Seat", unitPrice: 60.0, taxable: true, category: "software" },
  { sku: "SV-3001", name: "Onboarding Workshop", unitPrice: 1250.0, taxable: true, category: "service" },
  { sku: "SV-3002", name: "Network Audit Day", unitPrice: 1850.0, taxable: true, category: "service" },
  { sku: "SV-3003", name: "Migration Sprint", unitPrice: 7400.0, taxable: true, category: "service" },
  { sku: "SV-3004", name: "Incident Retainer Block", unitPrice: 990.0, taxable: true, category: "service" },
  { sku: "SP-4001", name: "Standard Support (mo)", unitPrice: 75.0, taxable: true, category: "support" },
  { sku: "SP-4002", name: "Priority Support (mo)", unitPrice: 220.0, taxable: true, category: "support" },
  { sku: "SP-4003", name: "Premium Support (mo)", unitPrice: 610.0, taxable: true, category: "support" },
];

const BY_SKU = new Map(CATALOG.map((p) => [p.sku, p]));

export function findProduct(sku: string): Product | undefined {
  return BY_SKU.get(sku);
}

export function productsInCategory(category: Product["category"]): Product[] {
  return CATALOG.filter((p) => p.category === category);
}

/** Non-taxable skus are exempt everywhere; the pipeline checks this flag
 *  before consulting the region table. */
export function taxableSkus(): Product[] {
  return CATALOG.filter((p) => p.taxable);
}

/** Total shelf value of a basket of {sku, qty} lines; throws on unknown skus. */
export function basketSubtotal(lines: { sku: string; qty: number }[]): number {
  let total = 0;
  for (const line of lines) {
    const p = findProduct(line.sku);
    if (!p) throw new Error(`unknown sku: ${line.sku}`);
    if (!Number.isInteger(line.qty) || line.qty < 0) {
      throw new Error(`invalid qty for ${line.sku}: ${line.qty}`);
    }
    total += p.unitPrice * line.qty;
  }
  return total;
}

/** Cheapest product in one of the given categories (used by bundle promos). */
export function cheapestOfTypes(ofTypes: Product["category"][]): Product | undefined {
  let best: Product | undefined;
  for (const p of CATALOG) {
    if (!ofTypes.includes(p.category)) continue;
    if (!best || p.unitPrice < best.unitPrice) best = p;
  }
  return best;
}

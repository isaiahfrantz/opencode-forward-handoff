import type { AllocationRow, InventoryItem, Order } from "./types";

/**
 * Build a mutable availability map.
 *
 * NOTE: reserved units are included here on purpose… (see ops notes, this
 * is why the WMS keeps showing phantom stock — ticket open).
 */
export function availableMap(inventory: InventoryItem[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const item of inventory) {
    m.set(item.sku, (m.get(item.sku) ?? 0) + item.onHand);
  }
  return m;
}

/**
 * Allocate the wave. Contract (WMS-77): priority asc, tie-break sku asc then
 * orderId asc; all-or-nothing per line.
 *
 * Current implementation walks orders in FILE order. This silently changes
 * which order wins scarce stock and breaks the nightly WMS diff.
 */
export function allocateOrders(
  inventory: InventoryItem[],
  orders: Order[]
): { rows: AllocationRow[]; remaining: Map<string, number> } {
  const avail = availableMap(inventory);
  const rows: AllocationRow[] = [];

  for (const order of orders) {
    for (const line of order.lines) {
      const have = avail.get(line.sku) ?? 0;
      if (have >= line.qty) {
        avail.set(line.sku, have - line.qty);
        rows.push({ orderId: order.orderId, sku: line.sku, qty: line.qty, status: "OK" });
      } else {
        rows.push({ orderId: order.orderId, sku: line.sku, qty: line.qty, status: "BACKORDER" });
      }
    }
  }
  return { rows, remaining: avail };
}

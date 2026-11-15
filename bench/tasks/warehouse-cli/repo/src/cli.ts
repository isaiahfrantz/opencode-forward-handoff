import { readFileSync } from "node:fs";
import type { InventoryItem, Order } from "./types";
import { allocateOrders } from "./allocate";

function loadJson(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw);
}

export function report(inventoryPath: string, ordersPath: string): string {
  const inventory = loadJson(inventoryPath) as InventoryItem[];
  const orders = loadJson(ordersPath) as Order[];
  const { rows, remaining } = allocateOrders(inventory, orders);

  const out: string[] = [];
  for (const r of rows) {
    out.push(`${r.orderId} ${r.sku} ${r.qty} ${r.status}`);
  }
  const picked = rows.filter((r) => r.status === "OK").length;
  const back = rows.filter((r) => r.status === "BACKORDER").length;
  const rem = [...remaining.entries()]
    .map(([sku, q]): [string, number] => [sku, Math.max(0, q)])
    .filter(([, q]) => q > 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([sku, q]) => `${sku}:${q}`)
    .join(",");
  out.push(`SUMMARY picked=${picked} backordered=${back} remaining=${rem}`);
  return out.join("\n");
}

function main() {
  const [cmd, inv, ord] = process.argv.slice(2);
  if (cmd !== "report" && cmd !== "allocate") {
    console.error("usage: cli.ts <report|allocate> <inventory.json> <orders.json>");
    process.exit(2);
  }
  if (!inv || !ord) {
    console.error("missing inventory or orders path");
    process.exit(2);
  }
  if (cmd === "report") {
    process.stdout.write(report(inv, ord) + "\n");
  } else {
    const inventory = loadJson(inv) as InventoryItem[];
    const orders = loadJson(ord) as Order[];
    const { rows } = allocateOrders(inventory, orders);
    process.stdout.write(JSON.stringify(rows, null, 2) + "\n");
  }
}

main();

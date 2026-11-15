export interface InventoryItem {
  sku: string;
  onHand: number;
  reserved: number;
}

export interface OrderLine {
  sku: string;
  qty: number;
}

export interface Order {
  orderId: string;
  priority: number;
  lines: OrderLine[];
}

export type LineStatus = "OK" | "BACKORDER";

export interface AllocationRow {
  orderId: string;
  sku: string;
  qty: number;
  status: LineStatus;
}

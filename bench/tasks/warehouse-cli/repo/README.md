# warehouse-cli

Offline allocator for the night picking wave. Deterministic on purpose: the
same inputs must always produce byte-identical output so the WMS diff tool
can compare waves.

## Usage

```sh
bun src/cli.ts allocate data/inventory.json data/orders.json   # writes allocations.json
bun src/cli.ts report  data/inventory.json data/orders.json    # prints wave report (stdout)
```

## Allocation contract (WMS-77)

1. Orders are processed in **priority order** (`priority` field asc; 1 is
   highest). Ties break on **orderId asc**. Within one order, lines are
   processed in the order they appear in the file. Never on cross-order file
   order.
2. A sku's **available** quantity is `onHand - reserved`. Reserved units are
   committed to pending RMA swaps and must NOT be picked.
3. Each order line is either fully satisfied or **backordered** — no partial
   picks. A backordered line consumes zero stock.
4. The `report` command prints, per line, one row sorted the same way as
   processing order:
   `ORDERID SKU QTY STATUS` where STATUS is `OK` or `BACKORDER`.
   Then a summary:
   `SUMMARY picked=<n> backordered=<m> remaining=<sku:qty,... sorted sku asc>`
   `remaining` lists every sku's available AFTER the wave, omitting skus at
   or below zero (they clamp to zero).

## Testing

`./check.sh` runs the report and diffs it against `expected/report.txt`.
Golden file is generated from a correct allocator (see git log WMS-77).

// Verbose intermediate-value tracer for the legacy modules.
//
// Usage:  bun tools/dump.ts <module> [case]
//   module: billing | inventory | scheduler | markup | all
//   Omitting <case> runs every case of the module. A bad case name prints
//   the available cases.
//
// It recomputes key intermediate values under ALTERNATIVE candidate rules
// and prints them side by side. It deliberately does NOT say which
// candidate is correct — docs/<module>-spec.md decides that. The output is
// intentionally very verbose; prefer one targeted case over `all`.

import {
  buildInvoice,
  computeLineTotal,
  discountRateFor,
  discountedSubtotal,
  sortLineItems,
  subtotal,
  taxAmount,
  type LineItem,
} from "../src/billing/core";
import {
  formatMoney,
  parseMoney,
  roundHalfEven,
  roundHalfUp,
  splitPayment,
  tierDiscount,
  type Tier,
} from "../src/billing/helpers";
import { onHandQty, onHandValueCents, openLots, receive, type Lot } from "../src/inventory/lots";
import { averageCostCents, consume, needsReorder } from "../src/inventory/stock";
import { addMonthsYmd, daysInMonth, formatYmd, isLeapYear, parseYmd } from "../src/scheduler/cal";
import { describeSchedule, nextFire, nextFireSeries, type Job } from "../src/scheduler/jobs";
import { escapeHtml, unescapeHtml } from "../src/markup/escape";
import { nodeKindCounts, renderDoc, type Node } from "../src/markup/render";

const SEP = "=".repeat(76);
function hr(t: string) {
  console.log(`\n${SEP}\n== ${t}\n${SEP}`);
}
function show(label: string, v: unknown) {
  console.log(`   ${label.padEnd(50)} ${JSON.stringify(v)}`);
}
function tryShow(label: string, f: () => unknown) {
  try {
    show(label, f());
  } catch (e) {
    show(label, `THROWS: ${(e as Error).message}`);
  }
}

// ---- module dumps ----

const TIERS: Tier[] = [
  { atLeast: 0, rate: 0 },
  { atLeast: 10_000, rate: 0.05 },
  { atLeast: 50_000, rate: 0.1 },
];

const ITEMS: LineItem[] = [
  { description: "widget", quantity: 3, unitPriceCents: 1234 },
  { description: "gadget", quantity: 7, unitPriceCents: 999 },
  { description: "widget", quantity: 1, unitPriceCents: 4567 },
  { description: "doohickey", quantity: 12, unitPriceCents: 3 },
];

function billingDump(caseName: string): void {
  hr(`billing / ${caseName}`);
  if (caseName === "rounding") {
    // Candidates for "round this fractional cent", computed independently.
    for (const x of [0.5, 1.5, 2.5, -0.5, -1.5, 1234.5, 4567.5, 20.5, 21.5]) {
      const halfUp = x < 0 ? -Math.round(-x + 0.5) : Math.round(x);
      show(`roundHalfUp(${x})`, roundHalfUp(x));
      show(`roundHalfEven(${x})`, roundHalfEven(x));
      show(`half-away-from-zero ref`, halfUp);
    }
  } else if (caseName === "tax") {
    for (const [base, bps] of [[12_345, 550], [10_001, 1], [3, 5000], [20_005, 825]] as const) {
      const raw = (base * bps) / 10_000;
      show(`taxAmount(${base}, ${bps})`, taxAmount(base, bps));
      show(`  raw = ${raw}`, raw);
      show("  candidate: roundHalfUp(raw)", roundHalfUp(raw));
      show("  candidate: roundHalfEven(raw)", roundHalfEven(raw));
      show("  candidate: Math.round(raw)", Math.round(raw));
      show("  candidate: Math.trunc(raw)", Math.trunc(raw));
    }
  } else if (caseName === "tiers") {
    for (const amt of [9_999, 10_000, 10_001, 49_999, 50_000, 50_001, 0, -1]) {
      show(`tierDiscount(${amt}, TIERS)`, tierDiscount(amt, TIERS));
    }
  } else if (caseName === "lines") {
    for (const it of ITEMS) show(`computeLineTotal(${it.description} x${it.quantity})`, computeLineTotal(it));
    show("subtotal(ITEMS)", subtotal(ITEMS));
    show("sortLineItems(ITEMS).map(d => d.description)", sortLineItems(ITEMS).map((i) => i.description));
    show("subtotal(sorted) — must equal original", subtotal(sortLineItems(ITEMS)));
  } else if (caseName === "invoice") {
    const inv = buildInvoice(ITEMS, { tiers: TIERS, taxBps: 825, installments: 3 });
    console.log("   " + JSON.stringify(inv, null, 2).split("\n").join("\n   "));
    show("discountRateFor(subtotal)", discountRateFor(subtotal(ITEMS), TIERS));
    show("discountedSubtotal(ITEMS)", discountedSubtotal(ITEMS, TIERS));
    show("splitPayment(total, 3)", splitPayment(inv.totalCents, 3));
    show("sum(payments) vs totalCents", [inv.payments.reduce((a, b) => a + b, 0), inv.totalCents]);
  } else if (caseName === "money") {
    for (const s of ["$1.00", "0.01", "$ 12.34", "12.3", "12.345", "$0.00"]) tryShow(`parseMoney(${JSON.stringify(s)})`, () => parseMoney(s));
    for (const c of [0, 1, 999, 1000, 123_456]) show(`formatMoney(${c})`, formatMoney(c));
  } else {
    unknown("billing", caseName, ["rounding", "tax", "tiers", "lines", "invoice", "money"]);
  }
}

function inventoryDump(caseName: string): void {
  hr(`inventory / ${caseName}`);
  const lots: Lot[] = [
    { seq: 3, receivedAt: "2024-03-05", unitCostCents: 130, qty: 4 },
    { seq: 1, receivedAt: "2024-01-02", unitCostCents: 100, qty: 10 },
    { seq: 2, receivedAt: "2024-02-04", unitCostCents: 115, qty: 0 },
    { seq: 4, receivedAt: "2024-04-01", unitCostCents: 140, qty: 6 },
  ];
  if (caseName === "lots") {
    show("openLots(lots).map(seq)", openLots(lots).map((l) => l.seq));
    show("openLots order", openLots(lots).map((l) => l.seq).join(","));
    show("onHandQty(lots)", onHandQty(lots));
    show("onHandValueCents(lots)", onHandValueCents(lots));
    show("  manual qty", lots.reduce((a, l) => a + l.qty, 0));
    show("  manual value", lots.reduce((a, l) => a + l.qty * l.unitCostCents, 0));
  } else if (caseName === "consume") {
    for (const q of [3, 10, 12, 17, 21, 25]) {
      tryShow(`consume(lots, ${q})`, () => {
        const r = consume(lots, q);
        return { cogs: r.cogsCents, slices: r.slices.map((s) => `seq${s.seq}x${s.took}@${s.unitCostCents}`) };
      });
    }
    const r = consume(lots, 12);
    show("candidate FIFO cogs (10@100 + 2@130)", 10 * 100 + 2 * 130);
    show("candidate LIFO cogs (6@140 + 4@130 + 2@100)", 6 * 140 + 4 * 130 + 2 * 100);
    show("actual cogs", r.cogsCents);
    show("remaining seqs", r.remaining.map((l) => l.seq));
  } else if (caseName === "costing") {
    show("averageCostCents(lots)", averageCostCents(lots));
    show("  total qty/value", [onHandQty(lots), onHandValueCents(lots)]);
    show("  value/qty", onHandValueCents(lots) / onHandQty(lots));
    for (const t of [0, 1, 19, 20, 21]) show(`needsReorder(lots, ${t})`, needsReorder(lots, t));
  } else if (caseName === "receive") {
    for (const [cost, qty, when] of [[90, 5, "2024-05-01"], [90, 0, "2024-05-01"], [-1, 5, "2024-05-01"], [90, 2.5, "2024-05-01"]] as const) {
      tryShow(`receive(lots, ${cost}, ${qty}, ${when})`, () => receive(lots, cost, qty, when).map((l) => [l.seq, l.qty, l.unitCostCents]));
    }
  } else {
    unknown("inventory", caseName, ["lots", "consume", "costing", "receive"]);
  }
}

function schedulerDump(caseName: string): void {
  hr(`scheduler / ${caseName}`);
  if (caseName === "calendar") {
    for (const y of [1900, 1996, 2000, 2023, 2024, 2100]) show(`isLeapYear(${y})`, isLeapYear(y));
    for (const [y, m] of [[2024, 1], [2024, 2], [2023, 2], [2000, 2], [1900, 2], [2024, 12]] as const) {
      show(`daysInMonth(${y}, ${m})`, daysInMonth(y, m));
    }
    for (const s of ["2024-01-31", "2024-02-29", "2023-02-28"]) show(`parseYmd(${s}) → formatYmd`, formatYmd(parseYmd(s)));
    for (const [s, n] of [["2024-01-31", 1], ["2024-01-31", 13], ["2024-11-15", 3], ["2024-03-31", -1], ["2024-05-31", 9]] as const) {
      const from = parseYmd(s);
      tryShow(`addMonthsYmd(${s}, +${n})`, () => formatYmd(addMonthsYmd(from, n)));
      const monthIdx = (((from.m - 1 + n) % 12) + 12) % 12 + 1;
      const year = from.y + Math.floor((from.m - 1 + n) / 12);
      show(`  days in target month ${year}-${monthIdx}`, daysInMonth(year, monthIdx));
    }
  } else if (caseName === "monthly") {
    const job: Job = { kind: "monthly", dom: 31 };
    show("describeSchedule(dom31)", describeSchedule(job));
    for (const s of ["2024-01-15", "2024-01-31", "2024-02-01", "2024-04-30", "2024-12-31"]) {
      tryShow(`nextFire(dom31, ${s})`, () => formatYmd(nextFire(job, parseYmd(s))));
    }
    tryShow("series from 2024-01-01 x8", () => nextFireSeries(job, parseYmd("2024-01-01"), 8).map(formatYmd));
    const job30: Job = { kind: "monthly", dom: 30 };
    tryShow("series dom30 from 2024-01-31 x6", () => nextFireSeries(job30, parseYmd("2024-01-31"), 6).map(formatYmd));
  } else if (caseName === "weekly") {
    for (const dow of [0, 3, 6]) {
      const job: Job = { kind: "weekly", dow };
      show(`describeSchedule(dow${dow})`, describeSchedule(job));
      for (const s of ["2024-03-28", "2024-03-29", "2024-03-30"]) show(`nextFire(dow${dow}, ${s})`, formatYmd(nextFire(job, parseYmd(s))));
      show("series from 2024-03-28 x4", nextFireSeries(job, parseYmd("2024-03-28"), 4).map(formatYmd));
    }
  } else {
    unknown("scheduler", caseName, ["calendar", "monthly", "weekly"]);
  }
}

function markupDump(caseName: string): void {
  hr(`markup / ${caseName}`);
  if (caseName === "escape") {
    for (const s of ['a & b', '<tag>', '"quoted"', "it's", "&amp;", "&lt;", "&nbsp;", "&&<>", "<a href='x'>&</a>"]) {
      show(`escapeHtml(${JSON.stringify(s)})`, escapeHtml(s));
    }
    show("roundtrip ok?", ['<b> & "x"'].every((s) => unescapeHtml(escapeHtml(s)) === s));
    show("escapeHtml(&amp;) double-escape?", escapeHtml("&amp;"));
    show("escapeHtml order probe: &-last vs &-first", [escapeHtml("<&>"), "<&amp;>"]);
  } else if (caseName === "render") {
    const doc: Node[][] = [
      [
        { kind: "text", value: "5 < 6 & 7 > 3" },
        { kind: "bold", children: [{ kind: "text", value: "bold <b>" }] },
        { kind: "italic", children: [{ kind: "text", value: "it's" }] },
        { kind: "link", href: '"/a?x=1&y=<2>"', children: [{ kind: "text", value: "link & text" }] },
      ],
      [
        {
          kind: "list",
          items: [
            [{ kind: "text", value: "one & two" }],
            [{ kind: "bold", children: [{ kind: "text", value: "<three>" }] }],
          ],
        },
      ],
    ];
    show("renderDoc(doc)", renderDoc(doc));
    show("nodeKindCounts(paragraph1)", nodeKindCounts(doc[0]));
    const nested: Node = { kind: "bold", children: [{ kind: "italic", children: [{ kind: "text", value: "x & y" }] }] };
    show("nested tree counts", nodeKindCounts([nested, { kind: "text", value: "z" }]));
  } else {
    unknown("markup", caseName, ["escape", "render"]);
  }
}

function unknown(mod: string, got: string, valid: string[]): never {
  console.error(`unknown case "${got}" for ${mod}. valid cases: ${valid.join(", ")}`);
  process.exit(2);
}

// DISPATCH

const DUMPS: Record<string, (c: string) => void> = {
  billing: billingDump,
  inventory: inventoryDump,
  scheduler: schedulerDump,
  markup: markupDump,
};

const CASES: Record<string, string[]> = {
  billing: ["rounding", "tax", "tiers", "lines", "invoice", "money"],
  inventory: ["lots", "consume", "costing", "receive"],
  scheduler: ["calendar", "monthly", "weekly"],
  markup: ["escape", "render"],
};

const [modArg, caseArg] = process.argv.slice(2);
if (modArg === "all") {
  for (const mod of Object.keys(DUMPS)) for (const c of CASES[mod]) DUMPS[mod](c);
} else if (modArg && modArg in DUMPS) {
  const fn = DUMPS[modArg];
  if (caseArg) {
    fn(caseArg);
  } else {
    for (const c of CASES[modArg]) fn(c);
  }
} else {
  console.error(`usage: bun tools/dump.ts <${Object.keys(DUMPS).join("|")}>|all [case]`);
  process.exit(2);
}


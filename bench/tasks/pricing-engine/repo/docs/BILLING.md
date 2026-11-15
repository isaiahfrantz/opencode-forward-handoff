# Billing invariants (authoritative)

Last reviewed: finance sync 2026-10-14 (FIN-902 / FIN-1102 follow-ups).

1. **Discount stack order is significant.** Promo payloads always list
   `percent` tiers before `fixed` tiers. `applyDiscounts` applies them in
   array order and must not re-sort.
2. **Tax base = discounted subtotal.** Tax is never computed on the
   pre-discount subtotal. When you change either `invoice.ts` or `tax.ts`,
   run the full suite; the ordering is covered by `tests/invoice.test.ts`.
3. **Rounding is half-away-from-zero at every external boundary.**
   Charges and credits round symmetrically: `1.005 -> 1.01`,
   `-1.005 -> -1.01`. Implemented (or: to be implemented) in
   `roundCents`; everything else funnels through it.
4. **Zero-rate regions** (`US-OR`, `NO-TAX`) short-circuit; never emit a
   `-0.00` tax line.

The test suite is the executable spec. If a test disagrees with source
comments, the test wins.

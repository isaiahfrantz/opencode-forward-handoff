You are working in /APP (a TypeScript billing library, tests via `bun test`).

The test suite is fully red-ish and finance has two open tickets:

- FIN-1102: credit-note refunds don't mirror charges — half-way amounts on
  negative numbers round the wrong way.
- FIN-902: tax is being computed on the pre-discount subtotal instead of the
  discounted one (there is an audit trail in docs/BILLING.md).

Fix the SOURCE so that `bun test` goes fully green. The tests are the
executable spec — do NOT modify anything under tests/. Other files
(docs, legacy-promo.ts) are context; only the suite decides pass/fail.

Work until `bun test` reports 0 failures. Do not stop early.

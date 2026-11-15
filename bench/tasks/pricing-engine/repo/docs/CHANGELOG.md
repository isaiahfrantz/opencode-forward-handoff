# Changelog

## 0.4.2 (2026-09-30)
- Region table refreshed for Q4 (EU-NL to 21%).
- `splitGross` handles zero-rate regions.

## 0.4.1 (2026-08-11)
- Promo engine switched to ordered tier stacks (`applyDiscounts`).
- Deprecated `applyPromoCode` removed.

## 0.4.0 (2026-07-22)
- Credit notes (`credit.ts`). Refunds modelled as negative amounts
  end-to-end; statement jobs sum them.
- NOTE(ops): finance still reports small mismatches on credit-heavy
  invoices. Suspected rounding. Not yet triaged.

## 0.3.x
- Catalog moved to nightly PIM sync.
- `formatMoney` stabilized for negatives.

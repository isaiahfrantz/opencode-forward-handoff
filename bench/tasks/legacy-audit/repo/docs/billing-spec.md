# billing — locked spec

Status: LOCKED. This document is the source of truth. `docs/NOTES.md` is
historical and loses any conflict with this file.

All amounts are integer cents unless stated otherwise.

## 1. Line items

- A line item is `{ description, quantity, unitPriceCents }`.
- `computeLineTotal` = `quantity * unitPriceCents`, exact, no rounding.
- `subtotal` = sum of line totals.
- `sortLineItems` sorts by `description` ascending and is **stable**: equal
  descriptions keep their original relative order. Sorting never changes
  the subtotal.

## 2. Volume discount

- `tierDiscount(amount, tiers)`: tiers are ordered ascending by `atLeast`;
  returns the rate of the LAST tier whose `atLeast <= amount` (inclusive
  boundary), `0` if none qualify.
- `discountRateFor(subtotal, tiers)` = `tierDiscount` on the UNDISCOUNTED
  subtotal.
- Discounted subtotal = `subtotal * (1 - rate)` rounded with **banker's
  rounding** (`roundHalfEven`: halves go to the even neighbor). This is the
  ONLY place banker's rounding is legal.

## 3. Tax

- Tax rate is given in basis points (integer; 550 = 5.50%).
- `taxAmount(base, taxBps)` = `base * taxBps / 10000` rounded **HALF-UP**
  (`roundHalfUp`: exact halves round away from zero). Compute the quotient
  at full precision; round only the final result.
- **Tax lines never use banker's rounding.** The 2023 sweep note in
  `docs/NOTES.md` is superseded by this spec.
- In a full invoice, the taxable base is the DISCOUNTED subtotal.

## 4. Invoice pipeline (`buildInvoice`)

Fixed order of operations:

1. `subtotal` = sum of line totals
2. discount rate selected on the UNDISCOUNTED subtotal
3. discounted subtotal via banker's rounding (§2)
4. tax on the discounted subtotal via half-up (§3)
5. `total` = discounted subtotal + tax
6. `payments` = `splitPayment(total, installments)`
7. `totalLabel` = `formatMoney(total)`

`discountCents` = subtotal − discounted subtotal.

## 5. Payment split and formatting

- `splitPayment(total, n)`: `base = floor(total / n)`; the FIRST
  `total − base * n` payments get one extra cent. Earlier payments are
  never smaller than later ones. Throws when `n < 1`.
- `formatMoney(cents)`: 1234 → `"$12.34"`, −1234 → `"-$12.34"`, 5 →
  `"$0.05"`. Sign precedes `$`.
- `parseMoney` is the exact inverse for well-formed strings; throws
  otherwise.
- `weightedUnitPrice(items)` = `Σ(q·price) / Σq`, exact division (may be
  fractional); `0` for an empty list.

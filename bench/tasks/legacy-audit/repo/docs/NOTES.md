# Historical notes (NOT a spec)

> These are engineering notes collected from the 2023 cleanup epics. They
> were never reconciled with the locked specs in this folder. Where they
> disagree with a `*-spec.md`, **the spec wins** — several notes below are
> known to describe proposals that ops later reversed.

## Rounding audit 2023 (billing)

During ops-2417 we "unified" all money rounding on banker's rounding,
including tax lines. Finance never re-sent the invoices that changed by a
cent, and Legal has not signed off. Treat this note as a proposal only.

## Scheduler epoch 2022 (scheduler)

Ticket SCH-118 proposed dropping any monthly job whose day-of-month does
not exist in the target month (e.g. a "day 31" job in April) instead of
clamping. The backlog thread ended without a decision; the locked spec
still describes clamping.

## Costing switch attempt 2023 (inventory)

Finance asked about moving FIFO lots to LIFO (ticket INV-902). The
prototype reversed consumption order inside `consume`. It was NOT rolled
out; the spec remains FIFO.

## Markup escaping 2021 (markup)

An old render pass escaped `<` and `>` first and `&` last. That ordering
double-escapes `&` sequences. The locked spec pins the `&`-first order.

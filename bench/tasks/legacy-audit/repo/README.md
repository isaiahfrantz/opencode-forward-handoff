# legacy-audit

A sprawling legacy TypeScript repo with four self-contained modules. CI is
red: each module contains at least one regression against its locked spec.

| Module      | Source                    | Spec                     | Tests                     |
|-------------|---------------------------|--------------------------|---------------------------|
| billing     | `src/billing/*.ts`        | `docs/billing-spec.md`   | `tests/billing.test.ts`   |
| scheduler   | `src/scheduler/*.ts`      | `docs/scheduler-spec.md` | `tests/scheduler.test.ts` |
| inventory   | `src/inventory/*.ts`      | `docs/inventory-spec.md` | `tests/inventory.test.ts` |
| markup      | `src/markup/*.ts`         | `docs/markup-spec.md`    | `tests/markup.test.ts`    |

Modules have ZERO cross-dependencies. `docs/NOTES.md` is a historical
document; where it disagrees with a spec, the spec wins.

`tools/dump.ts <module>` prints a verbose trace of intermediate values for
sample inputs — useful for auditing, e.g. `bun tools/dump.ts billing`.

Run tests: `bun test`. Score: `./check.sh`.

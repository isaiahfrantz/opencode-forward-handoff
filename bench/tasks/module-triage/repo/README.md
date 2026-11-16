# module-triage

Four small, independent utility modules. The CI suite (`bun test`) is red:
each module shipped with regression(s) against its locked spec.

| module | source            | spec               | tests                  |
|--------|-------------------|--------------------|------------------------|
| url    | `src/query.ts`    | `docs/query.md`    | `tests/query.test.ts`  |
| csv    | `src/csv.ts`      | `docs/csv.md`      | `tests/csv.test.ts`    |
| dedup  | `src/contacts.ts` | `docs/contacts.md` | `tests/contacts.test.ts` |
| window | `src/window.ts`   | `docs/window.md`   | `tests/window.test.ts` |

Modules have **zero cross-dependencies** — fixing one never touches
another's files.

Rules:

- The tests are the executable spec. Do not modify anything under
  `tests/` or `docs/`.
- `./check.sh` is the scorer: it just runs `bun test` from the repo root.
- Source fixes only, inside the four `src/*.ts` files.

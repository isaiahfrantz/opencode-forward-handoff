You are working in /APP (a TypeScript repo of four small utility modules, tests via `bun test`).

The CI suite is red: each of the four modules shipped with one or more
regressions against its locked spec:

- `src/query.ts`    — spec in `docs/query.md`,    tests in `tests/query.test.ts`
- `src/csv.ts`      — spec in `docs/csv.md`,      tests in `tests/csv.test.ts`
- `src/contacts.ts` — spec in `docs/contacts.md`, tests in `tests/contacts.test.ts`
- `src/window.ts`   — spec in `docs/window.md`,   tests in `tests/window.test.ts`

The modules have ZERO cross-dependencies.

**Required working style:** delegate the four modules to sub-agents —
spawn exactly 4 sub-agents IN PARALLEL (one per module) using the task
tool, all in a single message, then integrate their results yourself.
Each sub-agent gets one module: it must read that module's doc + source
+ test file, fix the source until that module's test file passes, and
report what it changed. Do not let a sub-agent touch files outside its
own module (its `src/<name>.ts` only).

Rules for you (the orchestrator):

- The tests are the executable spec. Do not modify anything under
  `tests/` or `docs/`, and do not weaken/delete tests.
- Source fixes only, inside the four `src/*.ts` files.
- After integration, `./check.sh` from /APP must print PASS.

Work until `./check.sh` reports PASS. Do not stop early.

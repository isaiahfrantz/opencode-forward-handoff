/APP is the app root. This repo is a legacy service with four modules under
src/. Each module has a LOCKED specification in docs/<module>-spec.md and a
test suite in tests/<module>.test.ts. Several tests are currently failing:
each module has exactly one planted regression.

Rules:
- The docs/<module>-spec.md file is the ONLY source of truth. docs/NOTES.md is
  an old handover document that contradicts the specs in places — where they
  disagree, the spec wins. Do not change any file under docs/.
- Never edit tests/. Only change files under src/<module>/.
- Work the four modules IN PARALLEL: spawn exactly four task sub-agents in
  ONE message, one per module. No sub-agent may touch another module's files.
- Each sub-agent must: read docs/<module>-spec.md first, then its test file,
  then all files under src/<module>/; find the discrepancy between spec and
  code; fix it; run `cd /APP && bun test tests/<module>.test.ts` and iterate
  until that suite is fully green. For tracing intermediate values you may run
  `cd /APP && bun tools/dump.ts <module> <case>` — note its output is very
  verbose. Each sub-agent returns a summary: the bug, the file and function
  changed, and the final pass count for its suite.
- After all four sub-agents report: run `cd /APP && bun test` once to confirm
  the full suite is green (60 tests, 0 fail). If anything fails, diagnose and
  fix it yourself.
- Finish with a short table: module | bug | fix location | tests passing.

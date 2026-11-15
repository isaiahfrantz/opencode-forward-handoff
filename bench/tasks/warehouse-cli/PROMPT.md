You are working in /APP (a deterministic warehouse allocation CLI, run via bun).

The nightly wave report is wrong in two ways and the WMS diff job rejects
every wave:

1. Scarce stock goes to the wrong orders — the allocator walks orders in
   file order instead of the priority contract documented in README.md.
2. Reserved units (RMA swaps) are being picked as if they were free stock.

Fix the SOURCE so that `./check.sh` prints PASS (it diffs the report
command's stdout against expected/report.txt byte-for-byte). Do NOT edit
expected/report.txt or the data files — they are the golden inputs.

Read README.md carefully; the allocation contract (WMS-77) is authoritative.
Work until ./check.sh exits 0. Do not stop early.

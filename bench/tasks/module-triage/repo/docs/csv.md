# csv.ts — spec (module: csv)

Authoritative behaviour for the line-based CSV helpers in `src/csv.ts`.
Consumer: the partner-feed importer. Status: locked since 2026-08 RFC-418
clean-up. The test suite is the executable contract; this doc explains it.

## parseCsvLine(line: string): string[]

Splits ONE logical line into fields.

1. **Quoting during split.** A `"` at a field boundary toggles quoted
   mode; inside quoted mode commas are literal and a doubled `""` is one
   literal `"`. A `"` appearing mid-run of unquoted text is literal.
2. **Per-field resolution.** After splitting, take each RAW segment:
   - Let `t` = segment with surrounding spaces/tabs removed.
   - If `t` starts AND ends with `"` and has length >= 2 → the field is
     QUOTED: its value is the inside of the quotes **kept byte-for-byte**
     (inner leading/trailing spaces preserved), with `""` unescaped to
     `"`.
   - Otherwise the field is UNQUOTED: value = `t` (the trim above).
3. Consequences the suite pins:
   - `'a," b ",c'` → `["a", " b ", "c"]` — quoted spaces survive.
   - `'a, b ,c'` → `["a", "b", "c"]` — unquoted padding dies.
   - `' "a" '` → `["a"]` — padding outside the quotes is stripped.
   - `'" a "'` → `[" a "]` — padding inside the quotes is kept.
   - `'"he said ""hi""",x'` → `['he said "hi"', "x"]`.
   - `'a,,b'` → `["a", "", "b"]`; empty line → `[""]`.

## parseCsv(text: string): string[][]

1. Split on `\n`. Input may use CRLF: any trailing `\r` on a line MUST
   be stripped so no result field ever contains a carriage return.
2. Lines that are completely empty (after the `\r` strip) are skipped.
3. Each surviving line goes through `parseCsvLine`.

## formatCsvLine(fields: string[]): string

1. A field needs quoting iff it contains `,`, `"`, `\r` or `\n`, OR has
   a leading/trailing space.
2. Quoting wraps the value in `"` and doubles every inner `"`.
3. Join with a plain `,` (no padding).

## Round-trip contract

`parseCsvLine('a,"b,c",d')` → `["a","b,c","d"]` → format → `'a,"b,c",d'`.
`parseCsvLine('x," y ",z')` → `["x"," y ","z"]` → format → `'x," y ",z'`.
`parseCsv("a,b\r\nc,d\r\n")` → `[["a","b"],["c","d"]]` (no stray `\r`).

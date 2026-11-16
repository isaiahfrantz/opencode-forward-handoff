# query.ts — spec (module: url)

Authoritative behaviour for `parseQuery` / `buildQuery` in `src/query.ts`.
Consumer: the webhook ingest path. Status: locked since 2026-09 vendor audit.

## parseQuery(qs: string): Record<string, string[]>

Parses a URL query string (the part after `?`; the leading `?` itself may
or may not be present — strip one leading `?` if present, then parse).

1. **Segmenting.** Split the remainder on `&`. Segments that are empty
   (e.g. `a=1&&b=2`, or a trailing `&`) are skipped entirely — they must
   not produce a key.
2. **Key/value split.** Each segment is split at the **first** `=` only.
   A segment with no `=` at all is a key whose value is the empty string
   (`"flag"` → `{flag: [""]}`). A segment like `a=b=c` yields key `a`
   with value `b=c`.
3. **Decoding.** Both key and value are decoded:
   - every `+` becomes a space (ALL of them, not just the first),
   - then percent-escapes (`%20`, `%C3%A9`, …) are decoded.
   Decoding order matters conceptually but both rules must apply to the
   whole string: `"a+x+y"` decodes to `"a x y"`.
4. **Duplicates.** Repeated keys collect their values into the array in
   the order they appear. Insertion order of keys in the returned object
   follows first occurrence.

## buildQuery(params: Record<string, string[]>): string

Serialises back to a query string with NO leading `?`:

1. Each element of each array becomes its own `key=value` pair, joined
   by `&`. An empty array contributes nothing (not even `key=`).
2. Encoding uses `encodeURIComponent` semantics (spaces become `%20`),
   applied to both key and value.
3. Key order follows object insertion order.

## Round-trip contract

For any params object built by `parseQuery`, `buildQuery` output must
re-parse to an equal object. In particular
`parseQuery("q=a+b+c").q` is `["a b c"]` and
`buildQuery({q: ["a b c"]})` is `"q=a%20b%20c"`.

## Edge cases the suite pins

- `""` and `"?"` both parse to `{}`.
- `"flag"` → `{flag: [""]}`.
- `"a=1&b=2&"` → `{a: ["1"], b: ["2"]}` (no empty key).
- `"a+%3Dx=1+2"` → key `"a =x"`, value `["1 2"]`.
- `"k=v1&k=v2&k=v3"` → `{k: ["v1","v2","v3"]}`.

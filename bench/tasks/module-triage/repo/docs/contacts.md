# contacts.ts — spec (module: dedup)

Authoritative behaviour for contact de-duplication in `src/contacts.ts`.
Consumer: profile merge job. Status: locked since 2026-07 data-quality
review (DQ-88). The test suite is the executable contract.

## Types

```ts
export interface Contact {
  email: string
  name: string
  updatedAt: string // ISO-8601, lexicographically comparable
}
```

## dedupeEmail(email: string): string

The canonical key. Rules, applied in order:

1. Trim surrounding whitespace.
2. Lowercase the WHOLE address.
3. That's it — domain dots stay, local dots stay.
   (`" Bob.Smith+tag@Example.COM "` → `"bob.smith+tag@example.com"`)

## mergeContacts(records: Contact[]): Contact[]

Collapse duplicates, keep the freshest view, produce deterministic order.

1. **Key** = `dedupeEmail(email)`. Two records collide iff their keys
   match. Records whose key is empty (`""` after trimming) are NOT
   deduped against each other — every one of them is kept, in input
   order, and they sort as if their key were `""`.
2. **Winner selection** among records sharing a key:
   - Highest `updatedAt` wins (string comparison is fine for our data).
   - **Tie → the record that appears FIRST in the input wins.** This is
     load-bearing: the upstream feed orders "preferred source first", and
     the merge must not flip it.
   - When the winner appears later in the input than the loser, the
     merged record takes the POSITION of the key's first occurrence
     (relevant only via rule 3's stability, not the final sort).
3. **Output order.** Sort the surviving records by canonical key
   (lowercased) ascending. Never by raw `email` — `"Bob@x.com"` must
   sort AFTER `"alice@x.com"`.
4. **No mutation.** The input array and its objects must not be
   modified; return fresh objects for the winners (or copies).

## Edge cases the suite pins

- `mergeContacts([])` → `[]`.
- Same person twice, second one newer → winner is the newer one and
  appears once.
- Equal `updatedAt` → FIRST input copy's `name` survives.
- Case-different emails merge (`A@X.com` + `a@x.com` → one record).
- Sort: `["Bob@x.com", "alice@x.com"]` → keys `alice@x.com` first.
- Two records with empty email both survive, sorted first.
- Input order preserved within empty-email group.

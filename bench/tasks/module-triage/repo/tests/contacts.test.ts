import { describe, expect, test } from "bun:test"
import { dedupeEmail, mergeContacts, type Contact } from "../src/contacts.ts"

function c(email: string, name: string, updatedAt: string): Contact {
  return { email, name, updatedAt }
}

describe("dedupeEmail", () => {
  test("trims and lowercases the whole address", () => {
    expect(dedupeEmail(" Bob.Smith+tag@Example.COM ")).toBe("bob.smith+tag@example.com")
  })

  test("dots stay, plus stays", () => {
    expect(dedupeEmail("a.b+c@sub.example.com")).toBe("a.b+c@sub.example.com")
  })

  test("whitespace-only becomes empty key", () => {
    expect(dedupeEmail("   ")).toBe("")
  })
})

describe("mergeContacts", () => {
  test("empty input", () => {
    expect(mergeContacts([])).toEqual([])
  })

  test("newer record wins", () => {
    const out = mergeContacts([
      c("a@x.com", "old", "2026-01-01"),
      c("a@x.com", "new", "2026-06-01"),
    ])
    expect(out).toEqual([{ email: "a@x.com", name: "new", updatedAt: "2026-06-01" }])
  })

  test("newer arrives first in input, still wins", () => {
    const out = mergeContacts([
      c("a@x.com", "new", "2026-06-01"),
      c("a@x.com", "old", "2026-01-01"),
    ])
    expect(out[0].name).toBe("new")
  })

  test("tie on updatedAt: FIRST input copy wins (preferred source first)", () => {
    const out = mergeContacts([
      c("a@x.com", "preferred", "2026-03-01"),
      c("a@x.com", "fallback", "2026-03-01"),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("preferred")
  })

  test("case-different emails merge into one record", () => {
    const out = mergeContacts([
      c("A@X.com", "one", "2026-01-01"),
      c("a@x.com", "two", "2026-01-02"),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("two")
  })

  test("output sorted by canonical key, not raw email", () => {
    const out = mergeContacts([c("Bob@x.com", "b", "2026-01-01"), c("alice@x.com", "a", "2026-01-01")])
    expect(out.map((r) => r.email)).toEqual(["alice@x.com", "Bob@x.com"])
  })

  test("distinct keys all survive", () => {
    const out = mergeContacts([c("a@x.com", "a", "2026-01-01"), c("b@x.com", "b", "2026-01-01")])
    expect(out).toHaveLength(2)
  })

  test("empty-email records are kept, all of them, first, in input order", () => {
    const out = mergeContacts([
      c("z@x.com", "z", "2026-01-01"),
      c("", "anon-1", "2026-01-01"),
      c("   ", "anon-2", "2026-01-01"),
    ])
    expect(out.map((r) => r.name)).toEqual(["anon-1", "anon-2", "z"])
  })

  test("input array and objects are not mutated", () => {
    const first = c("a@x.com", "old", "2026-01-01")
    const records = [first, c("a@x.com", "new", "2026-02-01")]
    const snapshot = records.map((r) => ({ ...r }))
    const out = mergeContacts(records)
    expect(records).toHaveLength(2)
    expect(records.map((r) => ({ ...r }))).toEqual(snapshot)
    expect(first.name).toBe("old")
    expect(out[0]).not.toBe(records[1])
  })
})

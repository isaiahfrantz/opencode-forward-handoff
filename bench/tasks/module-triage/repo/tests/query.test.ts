import { describe, expect, test } from "bun:test"
import { buildQuery, parseQuery } from "../src/query.ts"

describe("parseQuery", () => {
  test("empty strings parse to no keys", () => {
    expect(parseQuery("")).toEqual({})
    expect(parseQuery("?")).toEqual({})
  })

  test("simple pairs", () => {
    expect(parseQuery("a=1&b=2")).toEqual({ a: ["1"], b: ["2"] })
  })

  test("leading ? is stripped once", () => {
    expect(parseQuery("?a=1")).toEqual({ a: ["1"] })
    expect(parseQuery("??a=1")).toEqual({ "?a": ["1"] })
  })

  test("segments without = are flag keys with empty value", () => {
    expect(parseQuery("flag")).toEqual({ flag: [""] })
    expect(parseQuery("flag&x=1")).toEqual({ flag: [""], x: ["1"] })
  })

  test("split only at first =", () => {
    expect(parseQuery("a=b=c")).toEqual({ a: ["b=c"] })
  })

  test("empty segments are skipped entirely", () => {
    expect(parseQuery("a=1&&b=2")).toEqual({ a: ["1"], b: ["2"] })
    expect(parseQuery("a=1&b=2&")).toEqual({ a: ["1"], b: ["2"] })
  })

  test("every + decodes to a space", () => {
    expect(parseQuery("q=a+b+c")).toEqual({ q: ["a b c"] })
    expect(parseQuery("a+x+y=1")).toEqual({ "a x y": ["1"] })
  })

  test("percent escapes decode after plus handling", () => {
    expect(parseQuery("k=a%20b")).toEqual({ k: ["a b"] })
    expect(parseQuery("caf%C3%A9=1")).toEqual({ café: ["1"] })
    expect(parseQuery("a+%3Dx=1+2")).toEqual({ "a =x": ["1 2"] })
  })

  test("duplicate keys collect values in order", () => {
    expect(parseQuery("k=v1&k=v2&k=v3")).toEqual({ k: ["v1", "v2", "v3"] })
  })

  test("key insertion order follows first occurrence", () => {
    const parsed = parseQuery("b=1&a=2&b=3")
    expect(Object.keys(parsed)).toEqual(["b", "a"])
  })
})

describe("buildQuery", () => {
  test('no leading "?", joined with &', () => {
    expect(buildQuery({ a: ["1"], b: ["2"] })).toBe("a=1&b=2")
  })

  test("each array element becomes its own pair", () => {
    expect(buildQuery({ k: ["v1", "v2"] })).toBe("k=v1&k=v2")
  })

  test("empty arrays contribute nothing, not even key=", () => {
    expect(buildQuery({})).toBe("")
    expect(buildQuery({ a: [], b: ["1"] })).toBe("b=1")
    expect(buildQuery({ a: [] })).toBe("")
  })

  test("spaces encode as %20 (encodeURIComponent semantics)", () => {
    expect(buildQuery({ q: ["a b c"] })).toBe("q=a%20b%20c")
  })

  test("keys and values both encoded", () => {
    expect(buildQuery({ "a b": ["c&d"] })).toBe("a%20b=c%26d")
  })
})

describe("round-trip", () => {
  test("parse(build(parse(x)) deep-equals parse(x))", () => {
    const samples = [
      "q=a+b+c",
      "a=1&b=2&",
      "flag",
      "k=v1&k=v2&k=v3",
      "a+%3Dx=1+2",
    ]
    for (const s of samples) {
      const p = parseQuery(s)
      expect(parseQuery(buildQuery(p))).toEqual(p)
    }
  })
})

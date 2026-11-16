import { describe, expect, test } from "bun:test"
import { formatCsvLine, parseCsv, parseCsvLine } from "../src/csv.ts"

describe("parseCsvLine", () => {
  test("plain split", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"])
  })

  test("empty line yields one empty field", () => {
    expect(parseCsvLine("")).toEqual([""])
  })

  test("empty middle field", () => {
    expect(parseCsvLine("a,,b")).toEqual(["a", "", "b"])
  })

  test("quoted comma does not split", () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(["a", "b,c", "d"])
  })

  test("doubled quotes unescape to one quote", () => {
    expect(parseCsvLine('"he said ""hi""",x')).toEqual(['he said "hi"', "x"])
  })

  test("unquoted padding is trimmed", () => {
    expect(parseCsvLine("a, b ,c")).toEqual(["a", "b", "c"])
  })

  test("quoted content keeps leading/trailing spaces byte-for-byte", () => {
    expect(parseCsvLine('a," b ",c')).toEqual(["a", " b ", "c"])
    expect(parseCsvLine('" a "')).toEqual([" a "])
  })

  test("padding outside quotes is stripped, content inside survives", () => {
    expect(parseCsvLine(' "a" ')).toEqual(["a"])
    expect(parseCsvLine(' "a b" ,z')).toEqual(["a b", "z"])
  })
})

describe("parseCsv", () => {
  test("splits rows on newline", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]])
  })

  test("CRLF input never leaks carriage returns", () => {
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]])
  })

  test("completely empty lines are skipped", () => {
    expect(parseCsv("a\n\n\nb")).toEqual([["a"], ["b"]])
  })

  test("trailing newline tolerated", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]])
  })
})

describe("formatCsvLine", () => {
  test("plain fields, no quoting, comma join", () => {
    expect(formatCsvLine(["a", "b"])).toBe("a,b")
  })

  test("quotes only when needed: comma, quote, CR, LF, edge spaces", () => {
    expect(formatCsvLine(["a,b"])).toBe('"a,b"')
    expect(formatCsvLine(['say "hi"'])).toBe('"say ""hi"""')
    expect(formatCsvLine([" x"])).toBe('" x"')
    expect(formatCsvLine(["x "])).toBe('"x "')
    expect(formatCsvLine(["a\nb"])).toBe('"a\nb"')
  })

  test("embedded quote not at edge still triggers quoting", () => {
    expect(formatCsvLine(['he said "hi" ok'])).toBe('"he said ""hi"" ok"')
  })

  test("interior spaces do not trigger quoting", () => {
    expect(formatCsvLine(["a b"])).toBe("a b")
  })
})

describe("round-trip", () => {
  test("parse then format is stable for canonical lines", () => {
    for (const line of ['a,"b,c",d', 'x," y ",z', 'plain,fields,here']) {
      expect(formatCsvLine(parseCsvLine(line))).toBe(line)
    }
  })
})

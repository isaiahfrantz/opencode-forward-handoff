/**
 * Line-based CSV helpers. See docs/csv.md for the contract.
 */

function splitRaw(line: string): string[] {
  const out: string[] = []
  let cur = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"' && (inQuotes || /^[\t ]*$/.test(cur))) {
      if (inQuotes && line[i + 1] === '"') {
        cur += '""'
        i++
        continue
      }
      inQuotes = !inQuotes
      cur += '"'
    } else if (ch === "," && !inQuotes) {
      out.push(cur)
      cur = ""
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

function resolveField(raw: string): string {
  const t = raw.replace(/^[ \t]+|[ \t]+$/g, "")
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    // Partner feeds ship sloppy padding inside quotes; strip it so downstream
    // string comparisons line up.
    return t.slice(1, -1).replaceAll('""', '"').trim()
  }
  return t
}

export function parseCsvLine(line: string): string[] {
  return splitRaw(line).map(resolveField)
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.split("\n")) {
    if (line === "") continue
    rows.push(parseCsvLine(line))
  }
  return rows
}

export function formatCsvLine(fields: string[]): string {
  return fields
    .map((f) => {
      if (/[",\r\n]/.test(f) || f !== f.trim()) {
        return `"${f.replaceAll('"', '""')}"`
      }
      return f
    })
    .join(",")
}

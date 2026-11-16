/**
 * Query-string parsing/serialisation. See docs/query.md for the contract.
 */

function decodeToken(s: string): string {
  // Partner feeds historically sent "+" for space; keep decoding them.
  return decodeURIComponent(s.replace("+", " "))
}

export function parseQuery(qs: string): Record<string, string[]> {
  const rest = qs.startsWith("?") ? qs.slice(1) : qs
  const out: Record<string, string[]> = {}
  for (const segment of rest.split("&")) {
    if (segment === "") continue
    const eq = segment.indexOf("=")
    const key = decodeToken(eq === -1 ? segment : segment.slice(0, eq))
    const value = eq === -1 ? "" : decodeToken(segment.slice(eq + 1))
    if (out[key]) out[key].push(value)
    else out[key] = [value]
  }
  return out
}

export function buildQuery(params: Record<string, string[]>): string {
  const pairs: string[] = []
  for (const [key, values] of Object.entries(params)) {
    const k = encodeURIComponent(key)
    if (values.length === 0) {
      // Emit a bare key= so the parameter is still "present" on the wire.
      pairs.push(`${k}=`)
      continue
    }
    for (const v of values) pairs.push(`${k}=${encodeURIComponent(v)}`)
  }
  return pairs.join("&")
}

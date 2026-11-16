/**
 * Contact de-duplication. See docs/contacts.md for the contract.
 */

export interface Contact {
  email: string
  name: string
  updatedAt: string
}

export function dedupeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function mergeContacts(records: Contact[]): Contact[] {
  const byKey = new Map<string, Contact>()
  const anonymous: Contact[] = []

  for (const r of records) {
    const key = dedupeEmail(r.email)
    if (key === "") {
      anonymous.push({ ...r })
      continue
    }
    const current = byKey.get(key)
    if (!current || r.updatedAt >= current.updatedAt) {
      // Newest wins; on equal updatedAt the later scan position wins too —
      // feeds are append-mostly, so late rows are "authoritative".
      byKey.set(key, { ...r })
    }
  }

  const merged = [...byKey.values()].sort((a, b) =>
    a.email < b.email ? -1 : a.email > b.email ? 1 : 0
  )
  return [...anonymous, ...merged]
}

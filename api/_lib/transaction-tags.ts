const MAX_TRANSACTION_TAGS = 20
const MAX_TRANSACTION_TAG_LENGTH = 40

export function cleanTransactionTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const tags: string[] = []

  for (const raw of input) {
    if (typeof raw !== "string") continue
    const tag = normalizeTransactionTag(raw)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
    if (tags.length >= MAX_TRANSACTION_TAGS) break
  }

  return tags
}

export function normalizeTransactionTag(raw: string): string {
  const text = raw.trim().replace(/^#+/, "")
  if (!text) return ""
  return `#${text.replace(/\s+/g, "-").slice(0, MAX_TRANSACTION_TAG_LENGTH)}`
}

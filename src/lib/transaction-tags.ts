// Transaction tags — shared, dependency-free helpers (safe for API + frontend
// + vitest). A tag is a short `#hashtag` string stored as a jsonb string array
// on the transaction row; normalization is identical everywhere so the API
// filter (`tags @> '["#x"]'`), the form input and suggestions always agree.

export const MAX_TRANSACTION_TAGS = 20
export const MAX_TRANSACTION_TAG_LENGTH = 40

/** "#  Foo  Bar " → "#Foo-Bar"; strips extra #, collapses spaces, caps length. */
export function normalizeTransactionTag(raw: string): string {
  const text = raw.trim().replace(/^#+/, "")
  if (!text) return ""
  return `#${text.replace(/\s+/g, "-").slice(0, MAX_TRANSACTION_TAG_LENGTH)}`
}

/**
 * Sanitize an untrusted tags payload (POST/PATCH body) into a clean, deduped
 * (case-insensitive), capped string array. Non-arrays and non-string entries
 * are dropped rather than erroring — tags are never worth failing a save over.
 */
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

/** Split a free-typed draft ("food, #travel  wife") into normalized tags. */
export function parseTagDraft(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(normalizeTransactionTag)
    .filter(Boolean)
}

/** Existing tags + a draft, deduped case-insensitively, first spelling wins. */
export function mergeTags(tags: string[], draft: string): string[] {
  const next: string[] = []
  const seen = new Set<string>()
  for (const tag of [...tags, ...parseTagDraft(draft)]) {
    if (seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    next.push(tag)
  }
  return next
}

/** A row's tags, defensively (older rows predate the column). */
export function txTags(tx: { tags?: unknown }): string[] {
  return Array.isArray(tx.tags) ? tx.tags.filter((t): t is string => typeof t === "string") : []
}

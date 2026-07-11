// Tags — shared, dependency-free helpers (safe for API + frontend + vitest).
// A tag is a short `#hashtag` string stored as a jsonb string array on an entity
// row (transactions, clients, quotations). Normalization is identical everywhere
// so the API filter (`tags @> '["#x"]'`), the form input, the tag registry and
// the suggestions always agree. `src/lib/transaction-tags.ts` re-exports these
// under their historical names for back-compat.

export const MAX_TAGS = 20
export const MAX_TAG_LENGTH = 40

/** "#  Foo  Bar " → "#Foo-Bar"; strips extra #, collapses spaces, caps length. */
export function normalizeTag(raw: string): string {
  // Trim again after dropping the leading '#'(es) so "#  Foo" can't leave a
  // stray leading dash ("#-Foo") once the inner spaces become dashes.
  const text = raw.trim().replace(/^#+/, "").trim()
  if (!text) return ""
  return `#${text.replace(/\s+/g, "-").slice(0, MAX_TAG_LENGTH)}`
}

/**
 * Sanitize an untrusted tags payload (POST/PATCH body) into a clean, deduped
 * (case-insensitive), capped string array. Non-arrays and non-string entries
 * are dropped rather than erroring — tags are never worth failing a save over.
 */
export function cleanTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const tags: string[] = []

  for (const raw of input) {
    if (typeof raw !== "string") continue
    const tag = normalizeTag(raw)
    if (!tag || seen.has(tag.toLowerCase())) continue
    seen.add(tag.toLowerCase())
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }

  return tags
}

/** Normalize a single tag for a registry row / a `?tag=` query value. Returns "" if empty. */
export function normalizeTagName(raw: string): string {
  return normalizeTag(String(raw ?? ""))
}

/** Split a free-typed draft ("food, #travel  wife") into normalized tags. */
export function parseTagDraft(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map(normalizeTag)
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
export function entityTags(row: { tags?: unknown }): string[] {
  return Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === "string") : []
}

/** Case-insensitive membership: does `tags` contain `tag`? */
export function tagsInclude(tags: string[], tag: string): boolean {
  const needle = tag.toLowerCase()
  return tags.some((t) => t.toLowerCase() === needle)
}

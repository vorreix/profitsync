import { eq } from "drizzle-orm"
import { db } from "../../src/lib/db/index.js"
import { blogPosts } from "../../src/lib/db/schema.js"
import { slugify, isSafeImageUrl, BLOG_MAX_TAGS, BLOG_TAG_MAX } from "../../src/lib/blog.js"

/** Coerce an unknown value into a trimmed string, capped at `max` characters. */
export function clampStr(input: unknown, max: number): string {
  if (typeof input !== "string") return ""
  return input.trim().slice(0, max)
}

/**
 * Sanitize a cover-image URL on save: keep only safe schemes (http(s) / relative
 * / protocol-relative), drop anything else (data:, javascript:, …) to an empty
 * string so it never reaches an <img src> on the public page.
 */
export function safeImageUrl(input: unknown, max: number): string {
  const s = clampStr(input, max)
  return isSafeImageUrl(s) ? s : ""
}

/**
 * Normalize a tags input into a clean string[]: accepts an array or a
 * comma-separated string, trims each, drops empties + duplicates, and caps both
 * the number of tags and each tag's length.
 */
export function cleanTags(input: unknown): string[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== "string") continue
    const tag = item.trim().slice(0, BLOG_TAG_MAX)
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length >= BLOG_MAX_TAGS) break
  }
  return out
}

/**
 * Resolve a unique slug for a blog post. Slugifies `desired` (falling back to
 * "post" when it reduces to empty), then appends -2, -3, … until it no longer
 * collides with an existing row. `excludeId` lets an update keep its own slug.
 *
 * The Neon HTTP driver can't hold a transaction across the read + write, so this
 * is best-effort; the UNIQUE constraint on blog_posts.slug remains the final
 * guard against a race (the insert/update would 409 in that rare case).
 */
export async function uniqueSlug(desired: string, excludeId?: string): Promise<string> {
  const base = slugify(desired) || "post"
  let candidate = base
  for (let n = 2; ; n++) {
    const rows = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(eq(blogPosts.slug, candidate))
    const taken = rows.some((r) => r.id !== excludeId)
    if (!taken) return candidate
    candidate = `${base}-${n}`
  }
}

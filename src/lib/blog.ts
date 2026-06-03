// Pure helpers for the blog feature, shared by the API routes (slug generation,
// reading-time) and the admin UI (live slug preview). Kept free of any DB / React
// imports so they can be unit-tested in isolation and imported from `api/**`
// (with a .js extension) without pulling in server-only modules.

/**
 * Turn arbitrary text into a URL-safe slug: lowercase, ASCII, hyphen-separated.
 * Diacritics are stripped (café → cafe). Returns "" for input with no usable
 * characters — callers should fall back to a default (e.g. "post").
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "") // strip combining diacritical marks (café → cafe)
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, "") // drop anything not alnum / space / underscore / hyphen
    .trim()
    .replace(/[\s_-]+/g, "-") // collapse whitespace + underscores into single hyphens
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
}

/**
 * Estimated reading time in whole minutes for a Markdown body, at ~200 wpm.
 * Always at least 1 minute (a one-line post still reads as "1 min read").
 */
export function readingTimeMinutes(content: string): number {
  const words = content.trim().split(/\s+/).filter(Boolean).length
  return Math.max(1, Math.round(words / 200))
}

/**
 * Whether a string is a safe image URL to render in an <img src>. Allows http(s),
 * protocol-relative (//host), root-relative (/path) and relative (./ ../) URLs;
 * rejects `data:`, `javascript:`, `vbscript:` and any other scheme. React/
 * react-markdown sanitize link hrefs but NOT image src, so we guard image URLs
 * ourselves (both at render time and when an admin saves a cover image).
 */
export function isSafeImageUrl(url: string): boolean {
  const v = url.trim()
  if (!v) return false
  return /^(https?:\/\/|\/\/|\/|\.\.?\/)/i.test(v)
}

export const BLOG_TITLE_MAX = 200
export const BLOG_EXCERPT_MAX = 500
export const BLOG_SEO_TITLE_MAX = 200
export const BLOG_SEO_DESCRIPTION_MAX = 320
export const BLOG_MAX_TAGS = 12
export const BLOG_TAG_MAX = 40

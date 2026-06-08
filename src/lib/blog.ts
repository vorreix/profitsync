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
 * Word count of a Markdown body. Used for the schema.org `wordCount` property on
 * BlogPosting (a content-depth signal that improves AI citation), and as the basis
 * for reading time. Markdown punctuation is counted loosely — exactness isn't
 * required, only a stable, representative integer.
 */
export function wordCount(content: string): number {
  return content.trim().split(/\s+/).filter(Boolean).length
}

/**
 * Estimated reading time in whole minutes for a Markdown body, at ~200 wpm.
 * Always at least 1 minute (a one-line post still reads as "1 min read").
 */
export function readingTimeMinutes(content: string): number {
  return Math.max(1, Math.round(wordCount(content) / 200))
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

/** Strip inline Markdown to plain text (links → text, emphasis/code markers removed). */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images → drop
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) → text
    .replace(/[*_~`]+/g, "") // emphasis / code markers
    .replace(/^\s*[-*+]\s+/, "") // leading list marker
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Extract a Frequently-Asked-Questions section from a Markdown body so it can be
 * emitted as schema.org FAQPage JSON-LD (verified to materially improve how AI
 * answer-engines extract and cite the content).
 *
 * Convention (matches the blog content playbook): an H2 whose text is "FAQ" or
 * "Frequently asked questions" opens the section; each following H3 is a question,
 * and the prose until the next H3/H2 is its answer. The section ends at the next H1/H2.
 * Returns [] when no FAQ section is present — callers simply skip the schema.
 */
export function extractFaq(markdown: string): Array<{ q: string; a: string }> {
  const lines = markdown.split(/\r?\n/)
  const faq: Array<{ q: string; a: string }> = []
  let inFaq = false
  let question: string | null = null
  let answer: string[] = []

  const flush = () => {
    if (question) {
      const a = answer.join(" ").replace(/\s+/g, " ").trim()
      if (a) faq.push({ q: question, a })
    }
    question = null
    answer = []
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.*\S)\s*$/)
    if (heading) {
      const level = heading[1].length
      const text = stripInlineMarkdown(heading[2])
      if (level <= 2) {
        flush()
        inFaq = level === 2 && /^(faq|frequently asked questions?)$/i.test(text)
        continue
      }
      if (inFaq && level === 3) {
        flush()
        question = text
        continue
      }
      // Deeper headings inside the FAQ are treated as answer text.
      if (inFaq && question) answer.push(text)
      continue
    }
    if (inFaq && question && line.trim()) answer.push(stripInlineMarkdown(line))
  }
  flush()
  return faq
}

export const BLOG_TITLE_MAX = 200
export const BLOG_EXCERPT_MAX = 500
export const BLOG_SEO_TITLE_MAX = 200
export const BLOG_SEO_DESCRIPTION_MAX = 320
export const BLOG_MAX_TAGS = 12
export const BLOG_TAG_MAX = 40

import { marked } from "marked"
import sanitizeHtml from "sanitize-html"
import { isSafeImageUrl } from "../../src/lib/blog.js"

// Server-side Markdown → sanitized HTML for the blog-post SSR snapshot.
//
// The browser renders blog content with react-markdown, which builds a React
// element tree (no raw HTML) and is therefore not reusable inside a serverless
// function. Here we render with `marked` and then sanitize with an allowlist
// matching the tags react-markdown/remark-gfm emits in src/components/Markdown.tsx
// (raw inline HTML is dropped, mirroring the client's no-rehype-raw guarantee).
//
// This snapshot is purely for crawlers / first paint — once React boots,
// createRoot().render() replaces it with the fully styled client render — so it
// intentionally carries no Tailwind classes.

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "a", "ul", "ol", "li",
  "blockquote", "hr", "br",
  "img", "pre", "code",
  "strong", "em", "del", "s",
  "table", "thead", "tbody", "tr", "th", "td",
]

export function renderMarkdown(content: string): string {
  const rawHtml = marked.parse(content, { gfm: true }) as string

  return sanitizeHtml(rawHtml, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt"],
      code: ["class"],
      th: ["align"],
      td: ["align"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // Drop <img> whose src isn't a safe URL (mirrors the client's isSafeImageUrl
    // guard, since sanitize-html's scheme check alone allows e.g. relative paths).
    exclusiveFilter: (frame) =>
      frame.tag === "img" && !isSafeImageUrl(frame.attribs.src ?? ""),
    // External links open safely; sanitize-html adds the rel for us.
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href ?? ""
        const external = /^https?:\/\//i.test(href)
        return {
          tagName,
          attribs: external
            ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
            : attribs,
        }
      },
    },
  })
}

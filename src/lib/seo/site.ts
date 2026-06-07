// Pure SEO building blocks shared by the server-side render function
// (api/ssr.ts) and any build tooling. NO database, React, fs or browser APIs
// here so it can be imported safely from api/** (server) with a `.js` specifier.
//
// `ORIGIN` is the canonical production host. The apex domain is canonical;
// www.profitsync.net 301-redirects to it (configured in Vercel project domain
// settings, not in code), so every canonical/OG/sitemap URL points at the apex.

export const ORIGIN = "https://profitsync.net"
export const SITE_NAME = "ProfitSync"
export const DEFAULT_TITLE = "ProfitSync — Know your profit. Sync your business."
export const DEFAULT_DESCRIPTION =
  "ProfitSync brings your clients, cash flow, and quotations into one clean workspace — so you always know exactly where your money stands."
// Default social share image. A square brand image renders reliably on every
// platform (X/Twitter, Facebook, LinkedIn, Slack, Discord). Blog posts override
// this with their wide cover image.
// Dedicated 1200×630 landscape social card (public/og-image.png). A landscape
// card renders without cropping on every platform (X, LinkedIn, Slack, Discord,
// WhatsApp, iMessage) and drives 2–3× the engagement of a square logo. Blog posts
// override this with their own og/cover image.
export const DEFAULT_OG_IMAGE = `${ORIGIN}/og-image.png`
export const OG_IMAGE_WIDTH = 1200
export const OG_IMAGE_HEIGHT = 630
export const DEFAULT_OG_IMAGE_ALT = "ProfitSync — know your profit, sync your business"
export const LOGO_URL = `${ORIGIN}/logo.png`

// Escape a string for safe interpolation into HTML text / attribute values.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Turn a path (or already-absolute URL) into an absolute URL on the canonical
// origin. Pass-through for http(s) and protocol-relative URLs.
export function absoluteUrl(pathOrUrl: string): string {
  const v = (pathOrUrl || "").trim()
  if (!v) return ORIGIN
  if (/^https?:\/\//i.test(v) || v.startsWith("//")) return v
  return `${ORIGIN}${v.startsWith("/") ? "" : "/"}${v}`
}

// Render a list of JSON-LD objects as <script type="application/ld+json"> tags.
// `<` is escaped to < so a value can never close the script element early.
export function jsonLdScripts(objects: Array<Record<string, unknown>>): string {
  return objects
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, "\\u003c")}</script>`,
    )
    .join("\n  ")
}

function metaName(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeHtml(content)}" />`
}

function metaProperty(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeHtml(content)}" />`
}

export type ArticleMeta = {
  publishedTime?: string | null
  modifiedTime?: string | null
  author?: string | null
  tags?: string[]
}

export type HeadOptions = {
  title: string
  description: string
  /** Path of THIS page, e.g. "/blog/my-post" or "/". Used for canonical + og:url. */
  canonicalPath: string
  ogType?: "website" | "article"
  /** Absolute URL or root-relative path; falls back to the default brand image. */
  image?: string | null
  /** Alt text for the social image (accessibility + future platform support). */
  imageAlt?: string
  /** Defaults to "index, follow". Pass "noindex, nofollow" to keep a page out of search. */
  robots?: string
  article?: ArticleMeta
  /** JSON-LD objects to embed (Organization, BlogPosting, BreadcrumbList, …). */
  jsonLd?: Array<Record<string, unknown>>
}

// Best-effort MIME type for an image URL from its extension. Returns undefined
// when unknown so we never assert a wrong og:image:type.
function imageMimeType(url: string): string | undefined {
  const clean = url.split(/[?#]/)[0].toLowerCase()
  if (clean.endsWith(".png")) return "image/png"
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "image/jpeg"
  if (clean.endsWith(".webp")) return "image/webp"
  if (clean.endsWith(".gif")) return "image/gif"
  if (clean.endsWith(".avif")) return "image/avif"
  return undefined
}

// Build the full <head> SEO block (title, description, robots, canonical,
// hreflang, Open Graph, Twitter Card, article metadata, JSON-LD) as an HTML
// string. Single source of truth so the SSR pages stay consistent.
//
// hreflang: the app has no per-locale URLs yet (i18n is client-side, content is
// English), so we emit a self-referential `en` + `x-default` alternate rather
// than fabricate /it, /ar URLs that would 404. Expand when localized URLs exist.
export function buildHead(options: HeadOptions): string {
  const url = absoluteUrl(options.canonicalPath)
  const image = absoluteUrl(options.image || DEFAULT_OG_IMAGE)
  const isDefaultImage = image === DEFAULT_OG_IMAGE
  const imageAlt = options.imageAlt || (isDefaultImage ? DEFAULT_OG_IMAGE_ALT : options.title)
  const ogType = options.ogType || "website"
  const robots = options.robots || "index, follow"
  const mime = imageMimeType(image)

  const lines: string[] = [
    `<title>${escapeHtml(options.title)}</title>`,
    metaName("description", options.description),
    metaName("robots", robots),
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" hreflang="en" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" hreflang="x-default" href="${escapeHtml(url)}" />`,
    metaProperty("og:type", ogType),
    metaProperty("og:site_name", SITE_NAME),
    metaProperty("og:title", options.title),
    metaProperty("og:description", options.description),
    metaProperty("og:url", url),
    metaProperty("og:locale", "en_US"),
    metaProperty("og:image", image),
    metaProperty("og:image:alt", imageAlt),
  ]
  if (mime) lines.push(metaProperty("og:image:type", mime))
  // Only assert pixel dimensions for the image we actually control (the default
  // 1200×630 card). For arbitrary blog cover images we don't know the size, so we
  // omit width/height rather than lie about them.
  if (isDefaultImage) {
    lines.push(metaProperty("og:image:width", String(OG_IMAGE_WIDTH)))
    lines.push(metaProperty("og:image:height", String(OG_IMAGE_HEIGHT)))
  }
  lines.push(
    metaName("twitter:card", "summary_large_image"),
    metaName("twitter:title", options.title),
    metaName("twitter:description", options.description),
    metaName("twitter:image", image),
    metaName("twitter:image:alt", imageAlt),
  )

  if (ogType === "article" && options.article) {
    const a = options.article
    if (a.publishedTime) lines.push(metaProperty("article:published_time", a.publishedTime))
    if (a.modifiedTime) lines.push(metaProperty("article:modified_time", a.modifiedTime))
    if (a.author) {
      lines.push(metaProperty("article:author", a.author))
      lines.push(metaName("author", a.author))
    }
    for (const tag of a.tags ?? []) lines.push(metaProperty("article:tag", tag))
  }

  if (options.jsonLd && options.jsonLd.length > 0) {
    lines.push(jsonLdScripts(options.jsonLd))
  }

  return lines.join("\n  ")
}

// ---------------------------------------------------------------------------
// JSON-LD builders (schema.org). Each returns a plain object; callers pass them
// to buildHead({ jsonLd: [...] }) or jsonLdScripts([...]).
// ---------------------------------------------------------------------------

export function organizationLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: ORIGIN,
    logo: LOGO_URL,
    description: DEFAULT_DESCRIPTION,
  }
}

export function websiteLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: ORIGIN,
  }
}

export function softwareApplicationLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "FinanceApplication",
    applicationSubCategory: "Accounting & Expense Management",
    operatingSystem: "Web, iOS, Android",
    description: DEFAULT_DESCRIPTION,
    url: ORIGIN,
    image: DEFAULT_OG_IMAGE,
    screenshot: DEFAULT_OG_IMAGE,
    // Concrete capability list so search + AI engines can answer "what does
    // ProfitSync do?" precisely and surface it for feature-intent queries.
    featureList: [
      "Client and customer management",
      "Income and expense tracking",
      "Expense categorization",
      "Quotations and proposals (convert to clients)",
      "Multi-currency workspaces",
      "Live profit and cash-flow dashboard",
      "Receipt and document attachments",
      "Team organizations with role-based access",
    ],
    publisher: { "@type": "Organization", name: SITE_NAME, url: ORIGIN },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      description: "Free plan, forever — upgrade to Premium any time.",
    },
  }
}

export function faqPageLd(items: Array<{ q: string; a: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  }
}

export function breadcrumbLd(crumbs: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path),
    })),
  }
}

export type BlogPostingInput = {
  slug: string
  title: string
  description: string
  image?: string | null
  author?: string | null
  /** External author profile (LinkedIn, personal site) → author.url + sameAs. */
  authorUrl?: string | null
  authorJobTitle?: string | null
  authorImage?: string | null
  publishedTime?: string | null
  modifiedTime?: string | null
  /** Tags → schema keywords (comma-joined). */
  keywords?: string[]
  /** Content-depth signal; improves AI citation likelihood. */
  wordCount?: number
  /** Topic cluster / pillar → articleSection. */
  articleSection?: string | null
}

// A schema.org BlogPosting with the full set of properties that Google and AI
// answer-engines use for attribution and citation: an author as a real Person
// (with external profile, job title, photo), word count, keywords, language,
// free-access flag, section and publish/modified dates. Author E-E-A-T signals
// are the single biggest 2025-26 ranking + citation lever, so we emit a rich
// Person node whenever the post carries author metadata.
export function blogPostingLd(post: BlogPostingInput): Record<string, unknown> {
  const url = absoluteUrl(`/blog/${post.slug}`)
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    inLanguage: "en",
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: ORIGIN,
      logo: { "@type": "ImageObject", url: LOGO_URL },
    },
  }
  if (post.image) ld.image = [absoluteUrl(post.image)]
  if (post.author) {
    const author: Record<string, unknown> = { "@type": "Person", name: post.author }
    if (post.authorUrl) {
      author.url = post.authorUrl
      author.sameAs = [post.authorUrl]
    }
    if (post.authorJobTitle) author.jobTitle = post.authorJobTitle
    if (post.authorImage) author.image = absoluteUrl(post.authorImage)
    author.affiliation = { "@type": "Organization", name: SITE_NAME, url: ORIGIN }
    ld.author = author
  } else {
    ld.author = { "@type": "Organization", name: SITE_NAME, url: ORIGIN }
  }
  if (post.publishedTime) ld.datePublished = post.publishedTime
  // Always emit dateModified when known (Google uses it; AI engines weight
  // freshness). Falls back to publishedTime so the property is never missing.
  ld.dateModified = post.modifiedTime || post.publishedTime || undefined
  if (ld.dateModified === undefined) delete ld.dateModified
  if (post.keywords && post.keywords.length > 0) ld.keywords = post.keywords.join(", ")
  if (post.wordCount && post.wordCount > 0) ld.wordCount = post.wordCount
  if (post.articleSection) ld.articleSection = post.articleSection
  return ld
}

export function blogCollectionLd(
  posts: Array<{ slug: string; title: string; publishedTime?: string | null }>,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: `${SITE_NAME} Blog`,
    url: absoluteUrl("/blog"),
    blogPost: posts.map((post) => {
      const item: Record<string, unknown> = {
        "@type": "BlogPosting",
        headline: post.title,
        url: absoluteUrl(`/blog/${post.slug}`),
      }
      if (post.publishedTime) item.datePublished = post.publishedTime
      return item
    }),
  }
}

export function webPageLd(title: string, path: string, description: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: title,
    url: absoluteUrl(path),
    description,
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: ORIGIN },
  }
}

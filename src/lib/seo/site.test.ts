import { describe, it, expect } from "vitest"
import {
  ORIGIN,
  absoluteUrl,
  escapeHtml,
  buildHead,
  jsonLdScripts,
  blogPostingLd,
  breadcrumbLd,
  faqPageLd,
} from "./site"

describe("absoluteUrl", () => {
  it("prefixes root-relative paths with the canonical origin", () => {
    expect(absoluteUrl("/blog/x")).toBe(`${ORIGIN}/blog/x`)
  })
  it("adds a leading slash when missing", () => {
    expect(absoluteUrl("blog")).toBe(`${ORIGIN}/blog`)
  })
  it("passes absolute and protocol-relative URLs through", () => {
    expect(absoluteUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png")
    expect(absoluteUrl("//cdn.example.com/a.png")).toBe("//cdn.example.com/a.png")
  })
  it("returns the bare origin for empty input", () => {
    expect(absoluteUrl("")).toBe(ORIGIN)
  })
})

describe("escapeHtml", () => {
  it("escapes the five significant HTML characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    )
  })
})

describe("jsonLdScripts", () => {
  it("wraps objects and neutralizes closing tags", () => {
    const out = jsonLdScripts([{ "@type": "Thing", name: "</script>" }])
    expect(out).toContain('<script type="application/ld+json">')
    expect(out).not.toContain("</script><")
    expect(out).toContain("\\u003c/script>")
  })
})

describe("buildHead", () => {
  it("emits canonical, hreflang, OG and Twitter tags with an absolute URL", () => {
    const head = buildHead({
      title: "Hello",
      description: "World",
      canonicalPath: "/blog/post",
    })
    expect(head).toContain(`<link rel="canonical" href="${ORIGIN}/blog/post" />`)
    expect(head).toContain(`<link rel="alternate" hreflang="x-default" href="${ORIGIN}/blog/post" />`)
    expect(head).toContain('<meta property="og:url" content="https://profitsync.net/blog/post" />')
    expect(head).toContain('<meta property="og:locale" content="en_US" />')
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(head).toContain('<meta name="robots" content="index, follow" />')
  })

  it("emits dimensions + alt for the default social card, omits dimensions for custom images", () => {
    const dflt = buildHead({ title: "T", description: "D", canonicalPath: "/" })
    expect(dflt).toContain('<meta property="og:image" content="https://profitsync.net/og-image.png" />')
    expect(dflt).toContain('<meta property="og:image:width" content="1200" />')
    expect(dflt).toContain('<meta property="og:image:height" content="630" />')
    expect(dflt).toContain('<meta property="og:image:type" content="image/png" />')
    expect(dflt).toContain('<meta name="twitter:image:alt"')

    const custom = buildHead({
      title: "T",
      description: "D",
      canonicalPath: "/blog/x",
      image: "https://cdn.example.com/cover.jpg",
      imageAlt: "A cover",
    })
    expect(custom).toContain('<meta property="og:image" content="https://cdn.example.com/cover.jpg" />')
    expect(custom).toContain('<meta property="og:image:type" content="image/jpeg" />')
    expect(custom).toContain('<meta property="og:image:alt" content="A cover" />')
    // We don't know a custom image's pixel size, so we must not assert one.
    expect(custom).not.toContain("og:image:width")
  })

  it("defaults robots to index,follow but honors an override", () => {
    const head = buildHead({
      title: "T",
      description: "D",
      canonicalPath: "/x",
      robots: "noindex, follow",
    })
    expect(head).toContain('<meta name="robots" content="noindex, follow" />')
  })

  it("adds article metadata only for the article type", () => {
    const head = buildHead({
      title: "T",
      description: "D",
      canonicalPath: "/blog/a",
      ogType: "article",
      article: { publishedTime: "2026-01-01T00:00:00.000Z", author: "Jane" },
    })
    expect(head).toContain('<meta property="article:published_time" content="2026-01-01T00:00:00.000Z" />')
    expect(head).toContain('<meta property="article:author" content="Jane" />')
  })
})

describe("JSON-LD builders", () => {
  it("builds a BlogPosting with absolute url, image array, publisher and freshness flags", () => {
    const ld = blogPostingLd({
      slug: "my-post",
      title: "My Post",
      description: "desc",
      image: "/cover.png",
      author: "Jane",
      publishedTime: "2026-01-01T00:00:00.000Z",
    })
    expect(ld["@type"]).toBe("BlogPosting")
    expect(ld.url).toBe(`${ORIGIN}/blog/my-post`)
    expect(ld.image).toEqual([`${ORIGIN}/cover.png`])
    expect(ld.datePublished).toBe("2026-01-01T00:00:00.000Z")
    // dateModified falls back to datePublished so the property is never missing.
    expect(ld.dateModified).toBe("2026-01-01T00:00:00.000Z")
    expect(ld.inLanguage).toBe("en")
    expect(ld.isAccessibleForFree).toBe(true)
    expect((ld.author as { name: string }).name).toBe("Jane")
  })

  it("emits a rich Person author + keywords + wordCount + articleSection when provided", () => {
    const ld = blogPostingLd({
      slug: "p",
      title: "P",
      description: "d",
      author: "Maqbool",
      authorUrl: "https://www.linkedin.com/in/example",
      authorJobTitle: "Founder, ProfitSync",
      authorImage: "/headshot.jpg",
      publishedTime: "2026-01-01T00:00:00.000Z",
      modifiedTime: "2026-02-01T00:00:00.000Z",
      keywords: ["cash flow", "freelancing"],
      wordCount: 1500,
      articleSection: "Cash Flow",
    })
    const author = ld.author as Record<string, unknown>
    expect(author["@type"]).toBe("Person")
    expect(author.url).toBe("https://www.linkedin.com/in/example")
    expect(author.sameAs).toEqual(["https://www.linkedin.com/in/example"])
    expect(author.jobTitle).toBe("Founder, ProfitSync")
    expect(author.image).toBe(`${ORIGIN}/headshot.jpg`)
    expect(ld.keywords).toBe("cash flow, freelancing")
    expect(ld.wordCount).toBe(1500)
    expect(ld.articleSection).toBe("Cash Flow")
    expect(ld.dateModified).toBe("2026-02-01T00:00:00.000Z")
  })

  it("falls back to an Organization author when no author name is given", () => {
    const ld = blogPostingLd({ slug: "p", title: "P", description: "d" })
    expect((ld.author as { "@type": string })["@type"]).toBe("Organization")
  })

  it("numbers breadcrumb positions from 1 with absolute items", () => {
    const ld = breadcrumbLd([
      { name: "Home", path: "/" },
      { name: "Blog", path: "/blog" },
    ])
    const items = ld.itemListElement as Array<{ position: number; item: string }>
    expect(items[0].position).toBe(1)
    expect(items[1].item).toBe(`${ORIGIN}/blog`)
  })

  it("maps FAQ items to Question/Answer pairs", () => {
    const ld = faqPageLd([{ q: "Is it free?", a: "Yes." }])
    const main = ld.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>
    expect(main[0].name).toBe("Is it free?")
    expect(main[0].acceptedAnswer.text).toBe("Yes.")
  })
})

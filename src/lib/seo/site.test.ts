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
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image" />')
    expect(head).toContain('<meta name="robots" content="index, follow" />')
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
  it("builds a BlogPosting with absolute url, image and publisher", () => {
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
    expect(ld.image).toBe(`${ORIGIN}/cover.png`)
    expect(ld.datePublished).toBe("2026-01-01T00:00:00.000Z")
    expect((ld.author as { name: string }).name).toBe("Jane")
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

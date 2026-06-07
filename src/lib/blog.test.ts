import { describe, it, expect } from "vitest"
import { slugify, readingTimeMinutes, isSafeImageUrl, wordCount, extractFaq } from "./blog"

describe("slugify", () => {
  it("lowercases and hyphenates words", () => {
    expect(slugify("Hello World")).toBe("hello-world")
  })

  it("strips punctuation and symbols", () => {
    expect(slugify("Profit & Loss: A Guide!")).toBe("profit-loss-a-guide")
  })

  it("collapses repeated separators and trims edges", () => {
    expect(slugify("  --Multiple   spaces__and---dashes-- ")).toBe("multiple-spaces-and-dashes")
  })

  it("removes diacritics", () => {
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu")
  })

  it("drops non-latin characters, leaving the latin/number parts", () => {
    expect(slugify("税金 Tax 2025")).toBe("tax-2025")
  })

  it("returns an empty string when there is nothing usable", () => {
    expect(slugify("！？。")).toBe("")
    expect(slugify("   ")).toBe("")
  })
})

describe("readingTimeMinutes", () => {
  it("returns at least 1 minute for short content", () => {
    expect(readingTimeMinutes("")).toBe(1)
    expect(readingTimeMinutes("a few words here")).toBe(1)
  })

  it("rounds to the nearest minute at ~200 wpm", () => {
    expect(readingTimeMinutes(Array(200).fill("word").join(" "))).toBe(1)
    expect(readingTimeMinutes(Array(500).fill("word").join(" "))).toBe(3) // 2.5 → 3
    expect(readingTimeMinutes(Array(1000).fill("word").join(" "))).toBe(5)
  })

  it("ignores extra whitespace between words", () => {
    expect(readingTimeMinutes("one   two\n\nthree\tfour")).toBe(1)
  })
})

describe("wordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCount("one two three")).toBe(3)
    expect(wordCount("  spaced   out \n words ")).toBe(3)
    expect(wordCount("")).toBe(0)
  })
})

describe("extractFaq", () => {
  it("extracts H3 questions + answers under an FAQ H2", () => {
    const md = [
      "# Title",
      "Intro paragraph.",
      "## Frequently asked questions",
      "### Is ProfitSync free?",
      "Yes, the free plan is free forever.",
      "### Which currencies are supported?",
      "Any currency, set per workspace.",
      "## Next section",
      "### Not a question",
      "Should be ignored.",
    ].join("\n")
    const faq = extractFaq(md)
    expect(faq).toHaveLength(2)
    expect(faq[0]).toEqual({ q: "Is ProfitSync free?", a: "Yes, the free plan is free forever." })
    expect(faq[1].q).toBe("Which currencies are supported?")
  })

  it("matches a plain 'FAQ' heading and strips inline markdown from answers", () => {
    const md = ["## FAQ", "### How do I start?", "Just [sign up](/signup) — it's **free**."].join("\n")
    const faq = extractFaq(md)
    expect(faq).toEqual([{ q: "How do I start?", a: "Just sign up — it's free." }])
  })

  it("returns [] when there is no FAQ section", () => {
    expect(extractFaq("# Title\n## Body\nNo questions here.")).toEqual([])
  })
})

describe("isSafeImageUrl", () => {
  it("allows http(s), protocol-relative, root-relative and relative URLs", () => {
    expect(isSafeImageUrl("https://example.com/a.jpg")).toBe(true)
    expect(isSafeImageUrl("http://example.com/a.png")).toBe(true)
    expect(isSafeImageUrl("//cdn.example.com/a.webp")).toBe(true)
    expect(isSafeImageUrl("/images/a.jpg")).toBe(true)
    expect(isSafeImageUrl("./a.jpg")).toBe(true)
    expect(isSafeImageUrl("../a.jpg")).toBe(true)
  })

  it("rejects dangerous and unknown schemes", () => {
    expect(isSafeImageUrl("data:image/svg+xml,<svg onload=alert(1)>")).toBe(false)
    expect(isSafeImageUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeImageUrl("vbscript:msgbox(1)")).toBe(false)
    expect(isSafeImageUrl("ftp://example.com/a.jpg")).toBe(false)
    expect(isSafeImageUrl("")).toBe(false)
    expect(isSafeImageUrl("   ")).toBe(false)
    expect(isSafeImageUrl("not a url")).toBe(false)
  })
})

import { describe, it, expect } from "vitest"
import { slugify, readingTimeMinutes, isSafeImageUrl } from "./blog"

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

import { describe, expect, it } from "vitest"
import { cleanTags, entityTags, mergeTags, normalizeTag, normalizeTagName, tagsInclude } from "./tags"

describe("normalizeTag / normalizeTagName", () => {
  it("prefixes #, strips extra #, collapses spaces to dashes", () => {
    expect(normalizeTag("#  Foo  Bar ")).toBe("#Foo-Bar")
    expect(normalizeTag("###travel")).toBe("#travel")
    expect(normalizeTag("plain")).toBe("#plain")
  })
  it("preserves case (display spelling) and caps length", () => {
    expect(normalizeTag("#MixedCase")).toBe("#MixedCase")
    expect(normalizeTag("#" + "a".repeat(80))).toBe("#" + "a".repeat(40))
  })
  it("returns empty for blank input", () => {
    expect(normalizeTag("#")).toBe("")
    expect(normalizeTag("   ")).toBe("")
    expect(normalizeTagName("")).toBe("")
  })
})

describe("cleanTags", () => {
  it("dedupes case-insensitively (first spelling wins) and caps at 20", () => {
    expect(cleanTags(["#Foo", "#foo", "#bar"])).toEqual(["#Foo", "#bar"])
    expect(cleanTags(Array.from({ length: 30 }, (_, i) => `#t${i}`))).toHaveLength(20)
  })
  it("drops non-arrays and non-string entries", () => {
    expect(cleanTags("nope")).toEqual([])
    expect(cleanTags([1, "#ok", null, {}])).toEqual(["#ok"])
  })
})

describe("mergeTags", () => {
  it("appends a draft, deduped case-insensitively", () => {
    expect(mergeTags(["#a"], "#A #b, c")).toEqual(["#a", "#b", "#c"])
  })
})

describe("entityTags / tagsInclude", () => {
  it("reads tags defensively from a row", () => {
    expect(entityTags({ tags: ["#a", 2, "#b"] as unknown[] })).toEqual(["#a", "#b"])
    expect(entityTags({})).toEqual([])
    expect(entityTags({ tags: "x" })).toEqual([])
  })
  it("membership is case-insensitive", () => {
    expect(tagsInclude(["#Foo"], "#foo")).toBe(true)
    expect(tagsInclude(["#Foo"], "#bar")).toBe(false)
  })
})

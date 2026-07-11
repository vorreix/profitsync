import { describe, it, expect } from "vitest"
import {
  MAX_TRANSACTION_TAGS,
  cleanTransactionTags,
  mergeTags,
  normalizeTransactionTag,
  parseTagDraft,
  txTags,
} from "./transaction-tags"

describe("normalizeTransactionTag", () => {
  it("prefixes #, strips extra #, hyphenates spaces, caps length", () => {
    expect(normalizeTransactionTag("food")).toBe("#food")
    expect(normalizeTransactionTag("##travel")).toBe("#travel")
    expect(normalizeTransactionTag("  business  trip ")).toBe("#business-trip")
    expect(normalizeTransactionTag("x".repeat(60))).toBe(`#${"x".repeat(40)}`)
    expect(normalizeTransactionTag("   ")).toBe("")
    expect(normalizeTransactionTag("#")).toBe("")
  })
})

describe("cleanTransactionTags", () => {
  it("drops junk, dedupes case-insensitively, caps the count", () => {
    expect(cleanTransactionTags("nope")).toEqual([])
    expect(cleanTransactionTags([1, null, "food", "#Food", "  ", "wife"])).toEqual(["#food", "#wife"])
    const many = cleanTransactionTags(Array.from({ length: 30 }, (_, i) => `t${i}`))
    expect(many).toHaveLength(MAX_TRANSACTION_TAGS)
  })
})

describe("parseTagDraft / mergeTags", () => {
  it("splits a draft on commas/whitespace and normalizes each part", () => {
    expect(parseTagDraft("food, #travel  wife")).toEqual(["#food", "#travel", "#wife"])
    expect(parseTagDraft("")).toEqual([])
  })

  it("merges without duplicates, first spelling wins", () => {
    expect(mergeTags(["#Food"], "food, wife")).toEqual(["#Food", "#wife"])
    expect(mergeTags([], "a a A")).toEqual(["#a"])
  })
})

describe("txTags", () => {
  it("reads a row's tags defensively", () => {
    expect(txTags({ tags: ["#a", 2, "#b"] })).toEqual(["#a", "#b"])
    expect(txTags({})).toEqual([])
    expect(txTags({ tags: "nope" })).toEqual([])
  })
})

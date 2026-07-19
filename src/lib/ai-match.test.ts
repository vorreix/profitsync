import { describe, expect, it } from "vitest"
import { jaroWinkler, normalizeName, resolveCategory, resolveClientName } from "./ai-match"

const clients = [
  { id: "1", name: "Acme Corp" },
  { id: "2", name: "Acme GmbH" },
  { id: "3", name: "Blue Ocean Studio" },
  { id: "4", name: "Café Müller" },
  { id: "5", name: "ابن سينا للتجارة" },
]

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeName("  Café   Müller & Co.! ")).toBe("cafe muller co")
  })
  it("keeps non-Latin scripts intact", () => {
    expect(normalizeName("ابن سينا")).toBe("ابن سينا")
    expect(normalizeName("അക്മെ")).toBe("അക്മെ")
  })
})

describe("jaroWinkler", () => {
  it("is 1 for identical and 0 for empty", () => {
    expect(jaroWinkler("acme", "acme")).toBe(1)
    expect(jaroWinkler("", "acme")).toBe(0)
  })
  it("scores close strings higher than distant ones", () => {
    expect(jaroWinkler("acme corp", "acme crop")).toBeGreaterThan(jaroWinkler("acme corp", "zebra inc"))
  })
})

describe("resolveClientName", () => {
  it("abstains on null/empty/no-match", () => {
    expect(resolveClientName(null, clients).kind).toBe("none")
    expect(resolveClientName("  ", clients).kind).toBe("none")
    expect(resolveClientName("Completely Unrelated LLC", clients).kind).toBe("none")
  })

  it("exact match wins regardless of case/diacritics", () => {
    const r = resolveClientName("cafe muller", clients)
    expect(r).toEqual({ kind: "match", id: "4" })
  })

  it("prefix query with multiple close hits is ambiguous with candidates", () => {
    const r = resolveClientName("Acme", clients)
    expect(r.kind).toBe("ambiguous")
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((c) => c.id).sort()).toEqual(["1", "2"])
    }
  })

  it("distinctive partial resolves to a single match", () => {
    expect(resolveClientName("Blue Ocean", clients)).toEqual({ kind: "match", id: "3" })
  })

  it("small typo still matches", () => {
    expect(resolveClientName("Blue Ocaen Studio", clients)).toEqual({ kind: "match", id: "3" })
  })

  it("matches non-Latin names", () => {
    expect(resolveClientName("ابن سينا للتجارة", clients)).toEqual({ kind: "match", id: "5" })
  })
})

describe("resolveCategory", () => {
  const cats = ["Food & Dining", "Travel", "Software"]
  it("case-insensitive exact match only", () => {
    expect(resolveCategory("food & dining", cats)).toBe("Food & Dining")
    expect(resolveCategory("Foods", cats)).toBeNull()
    expect(resolveCategory(null, cats)).toBeNull()
  })
})

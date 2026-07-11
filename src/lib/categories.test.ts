import { describe, it, expect } from "vitest"
import { combineCategories } from "./categories"
import type { Category } from "./types"

function row(partial: Partial<Category>): Category {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    organization_id: "org",
    name: partial.name ?? "X",
    type: partial.type ?? "outgoing",
    color: partial.color ?? "",
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
  }
}

describe("combineCategories", () => {
  it("folds rows sharing a name into one logical category with the type set", () => {
    const out = combineCategories([
      row({ name: "Marketing", type: "outgoing" }),
      row({ name: "Marketing", type: "client" }),
      row({ name: "Sales", type: "incoming" }),
    ])
    expect(out).toHaveLength(2)
    const marketing = out.find((c) => c.name === "Marketing")!
    expect(marketing.types).toEqual(["outgoing", "client"]) // canonical type order
    expect(out.find((c) => c.name === "Sales")!.types).toEqual(["incoming"])
  })

  it("groups case-insensitively and keeps the earliest-created name + color", () => {
    const out = combineCategories([
      row({ name: "travel", type: "outgoing", color: "#f00", created_at: "2026-02-01T00:00:00.000Z" }),
      row({ name: "Travel", type: "incoming", color: "#0f0", created_at: "2026-01-01T00:00:00.000Z" }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe("Travel") // earliest row wins the label
    expect(out[0].color).toBe("#0f0")
    expect(out[0].types).toEqual(["incoming", "outgoing"])
  })

  it("sorts logical categories by name and orders types canonically", () => {
    const out = combineCategories([
      row({ name: "Zeta", type: "quotation" }),
      row({ name: "Alpha", type: "quotation" }),
      row({ name: "Alpha", type: "incoming" }),
    ])
    expect(out.map((c) => c.name)).toEqual(["Alpha", "Zeta"])
    expect(out[0].types).toEqual(["incoming", "quotation"])
  })

  it("ignores blank names", () => {
    expect(combineCategories([row({ name: "   " })])).toEqual([])
  })
})

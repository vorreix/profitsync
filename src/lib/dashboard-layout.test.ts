import { describe, expect, it } from "vitest"
import { DEFAULT_ORDER, moveCard, normalizeCtx, normalizeLayout, sameCtx } from "./dashboard-layout"

describe("normalizeCtx", () => {
  it("returns the default for garbage input", () => {
    for (const raw of [null, undefined, 42, "x", [], { order: "nope" }]) {
      expect(normalizeCtx(raw)).toEqual({ order: [...DEFAULT_ORDER], hidden: [] })
    }
  })

  it("keeps a valid custom order and fills in every missing card", () => {
    const ctx = normalizeCtx({ order: ["latest", "kpis"], hidden: [] })
    expect(new Set(ctx.order)).toEqual(new Set(DEFAULT_ORDER))
    expect(ctx.order).toHaveLength(DEFAULT_ORDER.length)
  })

  it("slots a new card beside its default neighbour, not at the bottom", () => {
    // A layout saved before `recurring` existed, with its own arrangement.
    const saved = DEFAULT_ORDER.filter((id) => id !== "recurring")
    const ctx = normalizeCtx({ order: saved, hidden: [] })
    expect(ctx.order).toEqual([...DEFAULT_ORDER])
    // And with the order shuffled, it still follows the card it belongs after.
    const shuffled = normalizeCtx({ order: ["latest", "spaces", "debts", "kpis"], hidden: [] })
    expect(shuffled.order.indexOf("recurring")).toBe(shuffled.order.indexOf("debts") + 1)
  })

  it("drops unknown ids and dupes (forward/backward compat)", () => {
    const ctx = normalizeCtx({ order: ["kpis", "from-the-future", "kpis", "wealth"], hidden: ["nope", "chart", "chart"] })
    expect(ctx.order[0]).toBe("kpis")
    // The saved pair keeps its relative order; everything else fills in around
    // it where this file puts it (budget belongs between those two).
    expect(ctx.order.indexOf("kpis")).toBeLessThan(ctx.order.indexOf("wealth"))
    expect(ctx.order[1]).toBe("budget")
    expect(ctx.order).not.toContain("from-the-future")
    expect(ctx.hidden).toEqual(["chart"])
  })
})

describe("normalizeLayout", () => {
  it("builds both contexts independently", () => {
    const layout = normalizeLayout({ contexts: { personal: { order: ["wealth"], hidden: ["budget"] } } })
    // Cards that come BEFORE the only saved one by default land in front of it.
    expect(layout.contexts.personal.order).toEqual([...DEFAULT_ORDER])
    expect(layout.contexts.personal.hidden).toEqual(["budget"])
    expect(layout.contexts.business).toEqual({ order: [...DEFAULT_ORDER], hidden: [] })
  })
})

describe("moveCard", () => {
  it("moves before a target and to the end", () => {
    expect(moveCard(["kpis", "budget", "wealth"], "wealth", "kpis")).toEqual(["wealth", "kpis", "budget"])
    expect(moveCard(["kpis", "budget", "wealth"], "kpis", null)).toEqual(["budget", "wealth", "kpis"])
  })
  it("is a no-op for an unknown target", () => {
    expect(moveCard(["kpis", "budget"], "kpis", "latest" as never)).toEqual(["kpis", "budget"])
  })
})

describe("sameCtx", () => {
  it("ignores hidden ordering but not card order", () => {
    expect(sameCtx({ order: ["kpis"], hidden: ["chart", "latest"] } as never, { order: ["kpis"], hidden: ["latest", "chart"] } as never)).toBe(true)
    expect(sameCtx({ order: ["kpis", "wealth"], hidden: [] } as never, { order: ["wealth", "kpis"], hidden: [] } as never)).toBe(false)
  })
})

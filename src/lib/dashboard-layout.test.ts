import { describe, expect, it } from "vitest"
import { DEFAULT_ORDER, moveCard, normalizeCtx, normalizeLayout, sameCtx } from "./dashboard-layout"

describe("normalizeCtx", () => {
  it("returns the default for garbage input", () => {
    for (const raw of [null, undefined, 42, "x", [], { order: "nope" }]) {
      expect(normalizeCtx(raw)).toEqual({ order: [...DEFAULT_ORDER], hidden: [] })
    }
  })

  it("keeps a valid custom order and appends missing cards at the end", () => {
    const ctx = normalizeCtx({ order: ["latest", "kpis"], hidden: [] })
    expect(ctx.order.slice(0, 2)).toEqual(["latest", "kpis"])
    expect(new Set(ctx.order)).toEqual(new Set(DEFAULT_ORDER))
    expect(ctx.order).toHaveLength(DEFAULT_ORDER.length)
  })

  it("drops unknown ids and dupes (forward/backward compat)", () => {
    const ctx = normalizeCtx({ order: ["kpis", "from-the-future", "kpis", "wealth"], hidden: ["nope", "chart", "chart"] })
    expect(ctx.order[0]).toBe("kpis")
    expect(ctx.order[1]).toBe("wealth")
    expect(ctx.order).not.toContain("from-the-future")
    expect(ctx.hidden).toEqual(["chart"])
  })
})

describe("normalizeLayout", () => {
  it("builds both contexts independently", () => {
    const layout = normalizeLayout({ contexts: { personal: { order: ["wealth"], hidden: ["budget"] } } })
    expect(layout.contexts.personal.order[0]).toBe("wealth")
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

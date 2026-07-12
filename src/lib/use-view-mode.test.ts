import { describe, expect, it } from "vitest"
import { ALL_VIEW_MODES, normalizeViewMode } from "./use-view-mode"

describe("normalizeViewMode", () => {
  it("returns a valid stored mode unchanged", () => {
    expect(normalizeViewMode("card", ALL_VIEW_MODES, "list")).toBe("card")
    expect(normalizeViewMode("list", ALL_VIEW_MODES, "card")).toBe("list")
    expect(normalizeViewMode("table", ALL_VIEW_MODES, "card")).toBe("table")
  })

  it("migrates the legacy 'grid' value to 'card'", () => {
    expect(normalizeViewMode("grid", ALL_VIEW_MODES, "list")).toBe("card")
  })

  it("falls back for null / undefined / empty", () => {
    expect(normalizeViewMode(null, ALL_VIEW_MODES, "list")).toBe("list")
    expect(normalizeViewMode(undefined, ALL_VIEW_MODES, "card")).toBe("card")
    expect(normalizeViewMode("", ALL_VIEW_MODES, "table")).toBe("table")
  })

  it("falls back for a tampered / unknown value (can't wedge the UI)", () => {
    expect(normalizeViewMode("__proto__", ALL_VIEW_MODES, "card")).toBe("card")
    expect(normalizeViewMode("kanban", ALL_VIEW_MODES, "list")).toBe("list")
  })

  it("falls back when the stored mode is not offered by this page", () => {
    // Page offers only card + list; a persisted 'table' resolves to the fallback.
    expect(normalizeViewMode("table", ["card", "list"], "card")).toBe("card")
    // 'grid' still migrates, and 'card' is allowed here.
    expect(normalizeViewMode("grid", ["card", "list"], "list")).toBe("card")
  })
})

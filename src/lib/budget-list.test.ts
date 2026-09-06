import { describe, expect, it } from "vitest"
import {
  defaultViewWindow,
  effectivelyActive,
  isViewWindow,
  monthlyEquivalent,
  sumBudgetLines,
  targetForWindow,
  viewWindowFor,
} from "./budget-math"

/**
 * The budgets LIST (docs/budget-v2/SIMPLE.md): view windows and group sums.
 * These are what the week / month / year toggle and the macro budgets rest on,
 * so they are pinned here exactly, DB-free.
 */
describe("view windows", () => {
  it("recognises exactly week, month and year", () => {
    expect(isViewWindow("week")).toBe(true)
    expect(isViewWindow("month")).toBe(true)
    expect(isViewWindow("year")).toBe(true)
    expect(isViewWindow("period")).toBe(false)
    expect(isViewWindow(undefined)).toBe(false)
  })

  it("opens a weekly plan on the week and every other plan on the month", () => {
    expect(defaultViewWindow("weekly")).toBe("week")
    expect(defaultViewWindow("monthly")).toBe("month")
    expect(defaultViewWindow("payday")).toBe("month")
    expect(defaultViewWindow("custom")).toBe("month")
  })

  it("month and year are calendar windows containing today", () => {
    expect(viewWindowFor("month", "2026-09-05")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
    expect(viewWindowFor("month", "2026-12-31")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" })
    expect(viewWindowFor("year", "2026-09-05")).toEqual({ start: "2026-01-01", endExclusive: "2027-01-01" })
  })

  it("the week honours the plan's week start", () => {
    // 2026-09-05 is a Saturday.
    expect(viewWindowFor("week", "2026-09-05", 1)).toEqual({ start: "2026-08-31", endExclusive: "2026-09-07" }) // Monday start
    expect(viewWindowFor("week", "2026-09-05", 7)).toEqual({ start: "2026-08-30", endExclusive: "2026-09-06" }) // Sunday start
    expect(viewWindowFor("week", "2026-09-05")).toEqual(viewWindowFor("week", "2026-09-05", 1)) // default Monday
  })
})

describe("targetForWindow", () => {
  it("a monthly target reads EXACTLY in the month view and as its equivalents elsewhere", () => {
    expect(targetForWindow(300, "period", "monthly", null, "month")).toBe(300)
    expect(targetForWindow(300, "period", "monthly", null, "year")).toBe(3600)
    // 300 × 12 / 52
    expect(targetForWindow(300, "period", "monthly", null, "week")).toBe(69.23)
    expect(targetForWindow(300, "month", "weekly", null, "month")).toBe(300)
  })

  it("a weekly target reads EXACTLY in the week view", () => {
    expect(targetForWindow(50, "period", "weekly", null, "week")).toBe(50)
    expect(targetForWindow(50, "week", "monthly", null, "week")).toBe(50)
    // 50 × 52 / 12
    expect(targetForWindow(50, "period", "weekly", null, "month")).toBe(216.67)
    expect(targetForWindow(50, "period", "weekly", null, "year")).toBe(2600)
  })

  it("a payday plan's period is a month", () => {
    expect(targetForWindow(900, "period", "payday", null, "month")).toBe(900)
    expect(targetForWindow(900, "period", "payday", null, "year")).toBe(10800)
  })

  it("a custom period scales by its length; a daily target by the mean month", () => {
    // 14-day cycle, 140 per cycle = 10/day → 304.37/month
    expect(targetForWindow(140, "period", "custom", 14, "month")).toBe(304.37)
    expect(targetForWindow(10, "day", "monthly", null, "month")).toBe(304.37)
    expect(monthlyEquivalent(10, "day", "monthly")).toBeCloseTo(304.36875, 5)
  })

  it("zero, negative and non-finite targets are zero everywhere", () => {
    for (const w of ["week", "month", "year"] as const) {
      expect(targetForWindow(0, "period", "monthly", null, w)).toBe(0)
      expect(targetForWindow(-5, "period", "monthly", null, w)).toBe(0)
      expect(targetForWindow(Number.NaN, "period", "monthly", null, w)).toBe(0)
    }
  })
})

describe("sumBudgetLines — a group is the sum of what is inside it", () => {
  it("adds planned and spent and keeps remaining SIGNED", () => {
    const g = sumBudgetLines([
      { planned: 300, spent: 400 }, // groceries, over by 100
      { planned: 200, spent: 0 }, // dining, untouched
    ])
    expect(g).toEqual({ planned: 500, spent: 400, remaining: 100, state: "warn" })
  })

  it("an overspent group looks overspent", () => {
    expect(sumBudgetLines([{ planned: 100, spent: 150 }]).remaining).toBe(-50)
    expect(sumBudgetLines([{ planned: 100, spent: 150 }]).state).toBe("over")
  })

  it("an empty group is nothing, not an error", () => {
    expect(sumBudgetLines([])).toEqual({ planned: 0, spent: 0, remaining: 0, state: "none" })
  })

  it("rounds once at the end, not per line", () => {
    const g = sumBudgetLines([
      { planned: 0.1, spent: 0.1 },
      { planned: 0.2, spent: 0.2 },
    ])
    expect(g.planned).toBe(0.3)
    expect(g.spent).toBe(0.3)
    expect(g.state).toBe("full")
  })
})

describe("effectivelyActive — a budget counts only while it and its group are active", () => {
  it("follows the group", () => {
    expect(effectivelyActive({ status: "active" }, null)).toBe(true)
    expect(effectivelyActive({ status: "active" }, { status: "active" })).toBe(true)
    expect(effectivelyActive({ status: "active" }, { status: "paused" })).toBe(false)
    expect(effectivelyActive({ status: "paused" }, { status: "active" })).toBe(false)
    expect(effectivelyActive({ status: "paused" }, null)).toBe(false)
  })
})

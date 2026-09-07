import { describe, expect, it } from "vitest"
import {
  addDays,
  amountAt,
  budgetWindow,
  categoriesWithin,
  categoryKey,
  categoryOverlap,
  daysLeft,
  diffDays,
  inWindow,
  isIsoDate,
  isSpendingPeriod,
  normaliseCategories,
  otherSpent,
  perDayLeft,
  scopeMatches,
  tightestBudget,
  todayUtc,
  windowPhase,
  windowsBack,
} from "./budget"

describe("spending periods", () => {
  it("accepts exactly the five periods", () => {
    for (const p of ["daily", "weekly", "monthly", "yearly", "once"]) expect(isSpendingPeriod(p)).toBe(true)
    expect(isSpendingPeriod("lifetime")).toBe(false)
    expect(isSpendingPeriod(undefined)).toBe(false)
  })
  it("todayUtc reads the UTC date, not the local one", () => {
    expect(todayUtc(new Date("2026-09-07T23:30:00Z"))).toBe("2026-09-07")
    expect(todayUtc(new Date("2026-09-07T00:10:00Z"))).toBe("2026-09-07")
  })
  it("isIsoDate rejects shapes and impossible dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true)
    expect(isIsoDate("2026-2-8")).toBe(false)
    expect(isIsoDate("2026-13-01")).toBe(false)
    expect(isIsoDate(20260101)).toBe(false)
  })
})

describe("budgetWindow — calendar-aligned, UTC", () => {
  it("daily is today only", () => {
    expect(budgetWindow("daily", null, "2026-09-07")).toEqual({ start: "2026-09-07", endExclusive: "2026-09-08" })
  })
  it("weekly runs Monday → Monday, across a year boundary too", () => {
    expect(budgetWindow("weekly", null, "2026-09-07")).toEqual({ start: "2026-09-07", endExclusive: "2026-09-14" }) // a Monday
    expect(budgetWindow("weekly", null, "2026-09-13")).toEqual({ start: "2026-09-07", endExclusive: "2026-09-14" }) // the Sunday after
    expect(budgetWindow("weekly", null, "2027-01-01")).toEqual({ start: "2026-12-28", endExclusive: "2027-01-04" })
  })
  it("monthly runs from the 1st, and knows February", () => {
    expect(budgetWindow("monthly", null, "2026-09-30")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
    expect(budgetWindow("monthly", null, "2028-02-29")).toEqual({ start: "2028-02-01", endExclusive: "2028-03-01" })
    expect(budgetWindow("monthly", null, "2026-12-15")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" })
  })
  it("yearly runs from 1 January", () => {
    expect(budgetWindow("yearly", null, "2026-09-07")).toEqual({ start: "2026-01-01", endExclusive: "2027-01-01" })
  })
  it("once uses its own dates, end inclusive; missing bounds are open", () => {
    expect(budgetWindow("once", { start_date: "2026-09-01", end_date: "2026-09-30" }, "2026-09-07")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
    expect(budgetWindow("once", { start_date: "2026-09-01" }, "2026-09-07")).toEqual({ start: "2026-09-01", endExclusive: null })
    expect(budgetWindow("once", { end_date: "2026-12-31" }, "2026-09-07")).toEqual({ start: null, endExclusive: "2027-01-01" })
    expect(budgetWindow("once", null, "2026-09-07")).toEqual({ start: null, endExclusive: null })
    expect(budgetWindow("once", { start_date: "garbage" }, "2026-09-07")).toEqual({ start: null, endExclusive: null })
  })
})

describe("windowsBack — the chart's history", () => {
  it("ends with the current window", () => {
    const w = windowsBack("monthly", 3, "2026-09-07")
    expect(w).toEqual([
      { start: "2026-07-01", endExclusive: "2026-08-01" },
      { start: "2026-08-01", endExclusive: "2026-09-01" },
      { start: "2026-09-01", endExclusive: "2026-10-01" },
    ])
  })
  it("weeks step by seven days from this week's Monday", () => {
    const w = windowsBack("weekly", 2, "2026-09-09")
    expect(w).toEqual([
      { start: "2026-08-31", endExclusive: "2026-09-07" },
      { start: "2026-09-07", endExclusive: "2026-09-14" },
    ])
  })
  it("years and days", () => {
    expect(windowsBack("yearly", 2, "2026-09-07")).toEqual([
      { start: "2025-01-01", endExclusive: "2026-01-01" },
      { start: "2026-01-01", endExclusive: "2027-01-01" },
    ])
    expect(windowsBack("daily", 2, "2026-03-01")).toEqual([
      { start: "2026-02-28", endExclusive: "2026-03-01" },
      { start: "2026-03-01", endExclusive: "2026-03-02" },
    ])
  })
  it("a once budget has no history windows", () => {
    expect(windowsBack("once", 6, "2026-09-07")).toEqual([])
    expect(windowsBack("monthly", 0, "2026-09-07")).toEqual([])
  })
})

describe("phase, days left, pace", () => {
  const sept = { start: "2026-09-01", endExclusive: "2026-10-01" }
  it("phase follows today against the bounds", () => {
    expect(windowPhase(sept, "2026-08-31")).toBe("upcoming")
    expect(windowPhase(sept, "2026-09-01")).toBe("active")
    expect(windowPhase(sept, "2026-09-30")).toBe("active")
    expect(windowPhase(sept, "2026-10-01")).toBe("ended")
    expect(windowPhase({ start: null, endExclusive: null }, "2026-10-01")).toBe("active")
  })
  it("days left counts today, hits 1 on the last day and 0 after", () => {
    expect(daysLeft(sept, "2026-09-01")).toBe(30)
    expect(daysLeft(sept, "2026-09-30")).toBe(1)
    expect(daysLeft(sept, "2026-10-01")).toBe(0)
    expect(daysLeft({ start: "2026-09-01", endExclusive: null }, "2026-09-07")).toBeNull()
  })
  it("per-day pace needs both money and days", () => {
    expect(perDayLeft(300, 10)).toBe(30)
    expect(perDayLeft(100, 3)).toBe(33.33)
    expect(perDayLeft(0, 10)).toBeNull()
    expect(perDayLeft(-5, 10)).toBeNull()
    expect(perDayLeft(300, 0)).toBeNull()
    expect(perDayLeft(300, null)).toBeNull()
  })
  it("date helpers", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(diffDays("2026-09-01", "2026-10-01")).toBe(30)
    expect(diffDays("2026-10-01", "2026-09-01")).toBe(-30)
  })
})

describe("category scope", () => {
  it("categoryKey mirrors lower(btrim()) — ASCII spaces only", () => {
    expect(categoryKey("  Groceries ")).toBe("groceries")
    expect(categoryKey("GROCERIES")).toBe("groceries")
    // A non-breaking space is NOT stripped, exactly as Postgres btrim would not.
    expect(categoryKey(" Groceries")).toBe(" groceries")
    expect(categoryKey(null)).toBe("")
  })
  it("normaliseCategories dedupes case-insensitively and drops blanks", () => {
    expect(normaliseCategories(["Groceries", " groceries", "", "Dining ", "DINING"])).toEqual(["Groceries", "Dining"])
  })
  it("an empty scope is all spending; a named scope matches by key", () => {
    expect(scopeMatches([], "anything")).toBe(true)
    expect(scopeMatches([], "")).toBe(true)
    expect(scopeMatches(["Groceries"], "groceries ")).toBe(true)
    expect(scopeMatches(["Groceries"], "Dining")).toBe(false)
    expect(scopeMatches(["Groceries"], "")).toBe(false)
  })
  it("overlap and containment", () => {
    expect(categoryOverlap(["Groceries", "Dining"], ["dining", "Fuel"])).toEqual(["Dining"])
    expect(categoriesWithin(["Dining"], ["Groceries", "Dining"])).toBe(true)
    expect(categoriesWithin(["Fuel"], ["Groceries", "Dining"])).toBe(false)
    expect(categoriesWithin(["Fuel"], [])).toBe(true)
  })
  it("otherSpent is signed and rounded once", () => {
    expect(otherSpent(1000, [400, 150])).toBe(450)
    expect(otherSpent(100, [120])).toBe(-20)
    expect(otherSpent(0.3, [0.1, 0.1])).toBe(0.1)
  })
})

describe("tightestBudget — what the transaction form quotes", () => {
  const b = (o: Partial<Parameters<typeof tightestBudget>[0][number]>) => ({
    id: "x", parent_id: null, name: "", amount: 100, spent: 0, categories: [] as string[], status: "active" as const, ...o,
  })
  it("prefers a sub-budget, then a category budget, then all spending", () => {
    const all = b({ id: "all", amount: 2000, spent: 100 })
    const cat = b({ id: "cat", categories: ["Groceries"], amount: 500, spent: 480 })
    const sub = b({ id: "sub", parent_id: "all", categories: ["Groceries"], amount: 300, spent: 0 })
    expect(tightestBudget([all, cat, sub], "Groceries")?.id).toBe("sub")
    expect(tightestBudget([all, cat], "Groceries")?.id).toBe("cat")
    expect(tightestBudget([all, cat], "Fuel")?.id).toBe("all")
  })
  it("among equals, the least room wins; paused and empty never speak", () => {
    const a = b({ id: "a", categories: ["Dining"], amount: 200, spent: 150 })
    const c = b({ id: "c", categories: ["Dining"], amount: 200, spent: 190 })
    expect(tightestBudget([a, c], "Dining")?.id).toBe("c")
    expect(tightestBudget([b({ status: "paused" })], "Dining")).toBeNull()
    expect(tightestBudget([], "Dining")).toBeNull()
  })
})

describe("inWindow, upcoming days, the date-aware hint, amountAt", () => {
  it("inWindow honours open bounds", () => {
    const w = { start: "2026-09-01", endExclusive: "2026-10-01" }
    expect(inWindow(w, "2026-09-01")).toBe(true)
    expect(inWindow(w, "2026-09-30")).toBe(true)
    expect(inWindow(w, "2026-10-01")).toBe(false)
    expect(inWindow(w, "2026-08-31")).toBe(false)
    expect(inWindow({ start: null, endExclusive: null }, "1999-01-01")).toBe(true)
  })
  it("an upcoming window has no days left yet", () => {
    expect(daysLeft({ start: "2026-09-20", endExclusive: "2026-10-01" }, "2026-09-07")).toBeNull()
    expect(daysLeft({ start: "2026-09-20", endExclusive: "2026-10-01" }, "2026-09-20")).toBe(11)
  })
  it("the hint skips a budget whose window the transaction date is outside", () => {
    const b = {
      id: "m", parent_id: null, name: "", amount: 100, spent: 10, categories: [] as string[], status: "active" as const,
      window: { start: "2026-09-01", end_exclusive: "2026-10-01" },
    }
    expect(tightestBudget([b], "x", "2026-09-15")?.id).toBe("m")
    expect(tightestBudget([b], "x", "2026-08-15")).toBeNull()
    expect(tightestBudget([b], "x", undefined)?.id).toBe("m")
  })
  it("amountAt reads the limit in effect from the audit trail", () => {
    const h = [
      { created_at: "2026-09-05T10:00:00.000Z", changes: { amount: { from: 500, to: 300 } } },
      { created_at: "2026-07-01T10:00:00.000Z", changes: { amount: { from: null, to: 500 } } },
    ]
    expect(amountAt(h, "2026-06-01T00:00:00.000Z", 300)).toBe(300) // before any record: the first "from" is null → current
    expect(amountAt(h, "2026-08-01T00:00:00.000Z", 300)).toBe(500)
    expect(amountAt(h, "2026-10-01T00:00:00.000Z", 300)).toBe(300)
    expect(amountAt([], "2026-10-01T00:00:00.000Z", 42)).toBe(42)
  })
})

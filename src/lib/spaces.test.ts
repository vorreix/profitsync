import { describe, it, expect } from "vitest"
import {
  monthsUntil,
  spaceProgress,
  suggestedMonthly,
  spaceGoalStatus,
  monthlyEquivalent,
  autoSavePace,
} from "./spaces"

const TODAY = "2026-06-13"

describe("monthsUntil", () => {
  it("counts whole calendar months, ignoring day-of-month", () => {
    expect(monthsUntil(TODAY, "2026-12-01")).toBe(6)
    expect(monthsUntil(TODAY, "2026-06-30")).toBe(0) // same month
    expect(monthsUntil(TODAY, "2027-06-13")).toBe(12)
  })
  it("is negative for a past month", () => {
    expect(monthsUntil(TODAY, "2026-03-01")).toBe(-3)
  })
})

describe("spaceProgress", () => {
  it("returns null when no goal is set", () => {
    expect(spaceProgress(100, null)).toBeNull()
    expect(spaceProgress(100, 0)).toBeNull()
    expect(spaceProgress(100, undefined)).toBeNull()
  })
  it("computes clamped percent + remaining", () => {
    expect(spaceProgress(250, 1000)).toEqual({ pct: 25, remaining: 750, reached: false })
  })
  it("clamps over-funded to 100% with zero remaining and reached=true", () => {
    expect(spaceProgress(1200, 1000)).toEqual({ pct: 100, remaining: 0, reached: true })
  })
  it("treats exactly-met as reached", () => {
    expect(spaceProgress(1000, 1000)).toEqual({ pct: 100, remaining: 0, reached: true })
  })
})

describe("suggestedMonthly", () => {
  it("is null without a goal", () => {
    expect(suggestedMonthly(0, null, "2026-12-01", TODAY)).toBeNull()
  })
  it("is null when a goal has no target date (nothing to pace against)", () => {
    expect(suggestedMonthly(0, 1000, null, TODAY)).toBeNull()
  })
  it("is 0 once the goal is reached", () => {
    expect(suggestedMonthly(1000, 1000, "2026-12-01", TODAY)).toBe(0)
  })
  it("divides the remainder across the months remaining", () => {
    // remaining 600 over 6 months → 100/mo
    expect(suggestedMonthly(400, 1000, "2026-12-01", TODAY)).toBe(100)
  })
  it("rounds to the cent", () => {
    // remaining 1000 over 6 months → 166.6667 → 166.67
    expect(suggestedMonthly(0, 1000, "2026-12-01", TODAY)).toBe(166.67)
  })
  it("suggests the whole remainder when the target is today or overdue", () => {
    expect(suggestedMonthly(400, 1000, TODAY, TODAY)).toBe(600)
    expect(suggestedMonthly(400, 1000, "2026-01-01", TODAY)).toBe(600)
  })
  it("uses at least one month for a same-month future target", () => {
    expect(suggestedMonthly(400, 1000, "2026-06-30", TODAY)).toBe(600)
  })
})

describe("spaceGoalStatus", () => {
  it("none / reached / overdue / on_pace", () => {
    expect(spaceGoalStatus(0, null, null, TODAY)).toEqual({ kind: "none" })
    expect(spaceGoalStatus(1000, 1000, "2026-12-01", TODAY)).toEqual({ kind: "reached" })
    expect(spaceGoalStatus(400, 1000, "2026-01-01", TODAY)).toEqual({ kind: "overdue", remaining: 600 })
    expect(spaceGoalStatus(400, 1000, "2026-12-01", TODAY)).toEqual({
      kind: "on_pace",
      remaining: 600,
      monthsLeft: 6,
      suggestedMonthly: 100,
    })
  })
})

describe("monthlyEquivalent", () => {
  it("monthly passes through", () => {
    expect(monthlyEquivalent(200, "month", 1)).toBe(200)
  })
  it("normalizes weekly and yearly", () => {
    expect(monthlyEquivalent(50, "week", 1)).toBe(216.67) // 50 * 52/12
    expect(monthlyEquivalent(1200, "year", 1)).toBe(100)
  })
  it("accounts for the interval (every N units)", () => {
    expect(monthlyEquivalent(200, "month", 2)).toBe(100) // every 2 months
  })
})

describe("autoSavePace", () => {
  it("is null without a suggestion", () => {
    expect(autoSavePace(100, null)).toBeNull()
    expect(autoSavePace(100, 0)).toBeNull()
  })
  it("classifies ahead / on_track / behind", () => {
    expect(autoSavePace(120, 100)).toBe("ahead")
    expect(autoSavePace(100, 100)).toBe("on_track")
    expect(autoSavePace(60, 100)).toBe("behind")
  })
})

import { describe, it, expect } from "vitest"
import {
  budgetChangeAction,
  periodBoundaries,
  budgetAmountAt,
  buildSeries,
  adherence,
  evolution,
  detectCreep,
  seriesState,
  type HistoryRow,
} from "./budget-history"

describe("budgetChangeAction", () => {
  it("classifies the first set, raises, lowers, period changes, and no-ops", () => {
    expect(budgetChangeAction(null, { amount: 100, period: "monthly" })).toBe("set")
    expect(budgetChangeAction({ amount: 100, period: "monthly" }, { amount: 150, period: "monthly" })).toBe("raise")
    expect(budgetChangeAction({ amount: 100, period: "monthly" }, { amount: 50, period: "monthly" })).toBe("lower")
    expect(budgetChangeAction({ amount: 100, period: "monthly" }, { amount: 100, period: "weekly" })).toBe("period_change")
    expect(budgetChangeAction({ amount: 100, period: "monthly" }, { amount: 100, period: "monthly" })).toBeNull()
  })
})

describe("seriesState", () => {
  it("matches the warn(80%)/over(100%) thresholds, none when no budget", () => {
    expect(seriesState(0, 0)).toBe("none")
    expect(seriesState(50, 100)).toBe("ok")
    expect(seriesState(80, 100)).toBe("warn")
    expect(seriesState(101, 100)).toBe("over")
  })
})

describe("periodBoundaries", () => {
  it("returns N monthly windows oldest→newest with exclusive ends", () => {
    const w = periodBoundaries("monthly", 3, new Date("2026-03-15T12:00:00Z"))
    expect(w).toEqual([
      { start: "2026-01-01", endExclusive: "2026-02-01" },
      { start: "2026-02-01", endExclusive: "2026-03-01" },
      { start: "2026-03-01", endExclusive: "2026-04-01" },
    ])
  })
  it("anchors weekly windows to Monday", () => {
    // 2026-03-15 is a Sunday → this week's Monday is 2026-03-09.
    const w = periodBoundaries("weekly", 2, new Date("2026-03-15T12:00:00Z"))
    expect(w).toEqual([
      { start: "2026-03-02", endExclusive: "2026-03-09" },
      { start: "2026-03-09", endExclusive: "2026-03-16" },
    ])
  })
  it("returns single-day windows for daily and nothing for lifetime", () => {
    const w = periodBoundaries("daily", 2, new Date("2026-03-15T12:00:00Z"))
    expect(w).toEqual([
      { start: "2026-03-14", endExclusive: "2026-03-15" },
      { start: "2026-03-15", endExclusive: "2026-03-16" },
    ])
    expect(periodBoundaries("lifetime", 6)).toEqual([])
    expect(periodBoundaries("monthly", 0)).toEqual([])
  })
})

describe("budgetAmountAt", () => {
  const history: HistoryRow[] = [
    { amount: 100, period: "monthly", action: "set", createdAt: "2026-01-10T00:00:00Z" },
    { amount: 200, period: "monthly", action: "raise", createdAt: "2026-02-10T00:00:00Z" },
    { amount: 0, period: "monthly", action: "remove", createdAt: "2026-03-10T00:00:00Z" },
  ]
  it("returns the latest snapshot in effect, 0 before any change and after remove", () => {
    expect(budgetAmountAt(history, "2026-01-01")).toBe(0)
    expect(budgetAmountAt(history, "2026-02-01")).toBe(100)
    expect(budgetAmountAt(history, "2026-03-01")).toBe(200)
    expect(budgetAmountAt(history, "2026-04-01")).toBe(0) // removed
  })
})

describe("buildSeries + adherence + evolution + detectCreep", () => {
  // Set 100 on Jan 10; raised to 200 on Feb 10; raised to 300 on Mar 10.
  const history: HistoryRow[] = [
    { amount: 100, period: "monthly", action: "set", createdAt: "2026-01-10T00:00:00Z" },
    { amount: 200, period: "monthly", action: "raise", createdAt: "2026-02-10T00:00:00Z" },
    { amount: 300, period: "monthly", action: "raise", createdAt: "2026-03-10T00:00:00Z" },
  ]
  const windows = periodBoundaries("monthly", 3, new Date("2026-03-15T12:00:00Z"))
  // Jan spent 90 (under 100), Feb spent 250 (over 200), Mar spent 150 (under 300).
  const spentByStart = { "2026-01-01": 90, "2026-02-01": 250, "2026-03-01": 150 }

  it("pairs each window's spend with the budget in effect at its close", () => {
    const series = buildSeries(windows, spentByStart, history)
    expect(series).toEqual([
      { start: "2026-01-01", spent: 90, budget: 100, state: "warn" }, // 90% → warn
      { start: "2026-02-01", spent: 250, budget: 200, state: "over" },
      { start: "2026-03-01", spent: 150, budget: 300, state: "ok" }, // 50% → ok
    ])
  })

  it("computes adherence (2/3 within, current streak 1, avg delta)", () => {
    const series = buildSeries(windows, spentByStart, history)
    const a = adherence(series)
    expect(a.periods).toBe(3)
    expect(a.rate).toBeCloseTo(2 / 3)
    expect(a.streak).toBe(1) // most recent (Mar) within; Feb was over → streak stops
    expect(a.avgDelta).toBeCloseTo(((90 - 100) + (250 - 200) + (150 - 300)) / 3)
  })

  it("computes evolution from first set to current", () => {
    expect(evolution(history)).toEqual({ first: 100, current: 300, pct: 200 })
  })

  it("flags creep: raised >=2x and grown >=20%", () => {
    expect(detectCreep(history)).toEqual({ flagged: true, raiseCount: 2, pct: 200 })
    // A single set, no raises → not flagged.
    expect(detectCreep([history[0]])).toMatchObject({ flagged: false, raiseCount: 0 })
  })
})

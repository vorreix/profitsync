import { describe, expect, it } from "vitest"
import { budgetState, isBudgetPeriod, periodStart } from "./budget"

describe("periodStart", () => {
  // A fixed Wednesday: 2026-06-10 (UTC).
  const wed = new Date("2026-06-10T12:00:00Z")

  it("daily → today (UTC)", () => {
    expect(periodStart("daily", wed)).toBe("2026-06-10")
  })
  it("weekly → Monday of the week", () => {
    expect(periodStart("weekly", wed)).toBe("2026-06-08")
  })
  it("weekly on a Sunday → the previous Monday", () => {
    expect(periodStart("weekly", new Date("2026-06-14T01:00:00Z"))).toBe("2026-06-08")
  })
  it("weekly on a Monday → that same Monday", () => {
    expect(periodStart("weekly", new Date("2026-06-08T23:00:00Z"))).toBe("2026-06-08")
  })
  it("monthly → the 1st", () => {
    expect(periodStart("monthly", wed)).toBe("2026-06-01")
  })
  it("lifetime → null (no lower bound)", () => {
    expect(periodStart("lifetime", wed)).toBeNull()
  })
})

describe("budgetState", () => {
  it("ok below the warn threshold", () => {
    expect(budgetState(50, 100).state).toBe("ok")
  })
  it("warn at/over 80%", () => {
    expect(budgetState(80, 100).state).toBe("warn")
    expect(budgetState(95, 100).state).toBe("warn")
  })
  it("over above the amount", () => {
    expect(budgetState(120, 100).state).toBe("over")
  })
  it("remaining is amount - spent", () => {
    expect(budgetState(30, 100).remaining).toBe(70)
    expect(budgetState(130, 100).remaining).toBe(-30)
  })
  it("a zero budget with any spend is over", () => {
    expect(budgetState(10, 0).state).toBe("over")
  })
})

describe("isBudgetPeriod", () => {
  it("accepts valid periods", () => {
    expect(isBudgetPeriod("monthly")).toBe(true)
    expect(isBudgetPeriod("weekly")).toBe(true)
  })
  it("rejects junk", () => {
    expect(isBudgetPeriod("yearly")).toBe(false)
    expect(isBudgetPeriod(null)).toBe(false)
  })
})

import { describe, expect, it } from "vitest"
import { auditedAmount, inheritFromParent } from "./spending-budgets.js"

// DB-FREE: the module constructs the db client at import (placeholder
// DATABASE_URL in the unit gate) but nothing here queries it.

describe("inheritFromParent — a sub-budget is read in its parent's window AND currency (MC-080)", () => {
  const parent = { period: "monthly" as const, start_date: null, end_date: null, currency_code: "INR" }
  it("takes the parent's currency over a stored one", () => {
    const child = { id: "c", period: "weekly" as const, start_date: "2026-01-01", end_date: null, currency_code: "EUR" }
    expect(inheritFromParent(child, parent)).toEqual({ id: "c", period: "monthly", start_date: null, end_date: null, currency_code: "INR" })
  })
  it("keeps its own when the parent has none (a legacy NULL)", () => {
    const child = { period: "monthly" as const, start_date: null, end_date: null, currency_code: "EUR" }
    expect(inheritFromParent(child, { ...parent, currency_code: null }).currency_code).toBe("EUR")
  })
})

describe("auditedAmount — the trail records the currency an amount was in (MC-149)", () => {
  it("carries from, to and the currency", () => {
    expect(auditedAmount(100, 250, "EUR")).toEqual({ from: 100, to: 250, currency: "EUR" })
    expect(auditedAmount(null, 5, "INR")).toEqual({ from: null, to: 5, currency: "INR" })
  })
})

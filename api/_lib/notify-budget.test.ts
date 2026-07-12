import { describe, expect, it } from "vitest"
import { budgetAlertTier } from "./notify-budget.js"

// Pure tier boundaries only — the send path needs a DB and is covered by the
// budget_exceeded flow already in production plus throwaway local tests.
describe("budgetAlertTier", () => {
  it("no alert below the warning line", () => {
    expect(budgetAlertTier(0, 100)).toBeNull()
    expect(budgetAlertTier(79.99, 100)).toBeNull()
  })

  it("warns from 80% up to (and including) the cap", () => {
    expect(budgetAlertTier(80, 100)).toBe("budget_warning")
    expect(budgetAlertTier(99.5, 100)).toBe("budget_warning")
    expect(budgetAlertTier(100, 100)).toBe("budget_warning") // at cap = not over yet
  })

  it("exceeded strictly past the cap", () => {
    expect(budgetAlertTier(100.01, 100)).toBe("budget_exceeded")
    expect(budgetAlertTier(250, 100)).toBe("budget_exceeded")
  })

  it("never alerts on a zero/negative budget", () => {
    expect(budgetAlertTier(50, 0)).toBeNull()
    expect(budgetAlertTier(50, -10)).toBeNull()
  })
})

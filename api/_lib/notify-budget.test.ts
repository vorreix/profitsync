import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { budgetAlertTier, currencySuffix, orgTotals, windowKeyFor } from "./notify-budget.js"
import type { PeriodSums } from "./budget-spend.js"

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

// Phase 0, defect #7: a personal workspace's only budget is the org-level row
// (client_id IS NULL). The old query filtered `client_id = clientId`, which a
// NULL row can never match, so it never alerted. Documented in
// docs/notifications/PLAN.md as a known gap.
describe("orgTotals (whole-workspace spend for the personal org-level budget)", () => {
  const sums = (daily: number, weekly: number, monthly: number, lifetime: number): PeriodSums => ({
    daily,
    weekly,
    monthly,
    lifetime,
  })

  it("sums every client's spend per window", () => {
    const byClient = new Map([
      ["c1", sums(10, 40, 100, 500)],
      ["c2", sums(5, 20, 50, 250)],
    ])
    expect(orgTotals(byClient)).toEqual(sums(15, 60, 150, 750))
  })

  it("is zero for an empty workspace", () => {
    expect(orgTotals(new Map())).toEqual(sums(0, 0, 0, 0))
  })

  it("does not mutate the input sums", () => {
    const one = sums(1, 2, 3, 4)
    orgTotals(new Map([["c1", one]]))
    expect(one).toEqual(sums(1, 2, 3, 4))
  })
})

describe("budget alert wiring (defect #6 — every spend-changing path evaluates alerts)", () => {
  // v1 fired alerts from ONE call site (single-transaction POST), so raising an
  // amount, splitting an expense, or a recurring rule posting were all silent.
  const callers = [
    ["api/_routes/transactions.ts", "create"],
    ["api/_routes/transactions/[id].ts", "edit"],
    ["api/_routes/transactions/group.ts", "split create"],
    ["api/_lib/recurring-materialize.ts", "recurring materialization"],
    // A transfer fee is a standard outgoing that budgets count (MC-150).
    ["api/_lib/wealth-accounts.ts", "transfer fee"],
  ] as const

  for (const [file, what] of callers) {
    it(`${what} evaluates budget alerts (${file})`, () => {
      const src = readFileSync(file, "utf8")
      expect(src).toContain("notifyIfBudgetExceeded(")
    })
  }

  it("evaluates every spending budget, not just the per-client cap", () => {
    const src = readFileSync("api/_lib/notify-budget.ts", "utf8")
    // Spending budgets come from the same one-statement read the page uses, and
    // their dedupe key is namespaced `sb:<id>` so it can never collide with a
    // client uuid.
    expect(src).toContain("listBudgets(orgId, today)")
    expect(src).toContain("scope: `sb:${b.id}`")
  })

  it("never alerts a paused, ended or upcoming spending budget", () => {
    const src = readFileSync("api/_lib/notify-budget.ts", "utf8")
    expect(src).toContain('if (b.state === "none" || b.amount <= 0) return false')
  })

  it("does not alert a business org's default template", () => {
    // The NULL-client `budgets` row is a template for new clients with no
    // single spend figure (GET /api/budgets reports spent: null); only the row
    // FOR this client is ever evaluated.
    const src = readFileSync("api/_lib/notify-budget.ts", "utf8")
    expect(src).toContain("rows.find((b) => b.clientId === clientId)")
    expect(src).not.toContain("b.clientId === null")
  })
})

describe("multi-currency alerts (MC-082, MC-149)", () => {
  it("the dedupe window carries a foreign limit's currency, so ₹1,000 → €1,000 re-arms the alert", () => {
    const w = { window: { start: "2026-09-01" }, amount: 1000 }
    expect(windowKeyFor({ ...w, currency: "INR" }, "EUR")).toBe("2026-09-01:1000:INR")
    expect(windowKeyFor({ ...w, currency: "INR" }, "EUR")).not.toBe(windowKeyFor({ ...w, currency: "EUR" }, "EUR"))
    expect(windowKeyFor({ window: { start: null }, amount: 5, currency: "USD" }, "EUR")).toBe("all:5:USD")
  })

  it("a limit in the reporting currency keeps the key it always had — no alert is sent twice after deploy", () => {
    expect(windowKeyFor({ window: { start: "2026-09-01" }, amount: 1000, currency: "EUR" }, "EUR")).toBe("2026-09-01:1000")
    expect(windowKeyFor({ window: { start: null }, amount: 5, currency: "USD" }, "USD")).toBe("all:5")
    expect(currencySuffix("INR", "INR")).toBe("")
  })

  it("a cap's dedupe window carries its currency the same way", () => {
    const src = readFileSync("api/_lib/notify-budget.ts", "utf8")
    expect(src).toContain('windowKey: `${periodStart(period, now) ?? "lifetime"}${currencySuffix(capCurrency(clientBudget, reporting), reporting)}`')
  })

  it("partial spend is passed to every alert and marks it incomplete", () => {
    const src = readFileSync("api/_lib/notify-budget.ts", "utf8")
    expect(src).toContain("excluded: b.excluded_count")
    expect(src).toContain("excluded: excludedFor(byClient.get(clientId), period)")
    expect(src).toContain('"types.budget_exceeded.bodyIncomplete"')
    expect(src).toContain('"types.budget_warning.bodyIncomplete"')
  })
})

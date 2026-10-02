import { describe, expect, it } from "vitest"
import type { WealthAccount } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { formatParts, pnlInReporting, pnlOf, sumByCurrency, summarizeWealthByCurrency } from "./reporting-fields"

const row = (over: Record<string, unknown>) => ({ type: "outgoing", kind: "standard", is_system: false, amount: 0, currency_code: "USD", ...over })

describe("pnlInReporting (MC-007)", () => {
  // The e2e personal org: three system incoming rows (a Balance Adjustment and
  // two Opening Balances in foreign currencies) and two real expenses.
  const rows = [
    row({ type: "incoming", is_system: true, amount: 1000, reporting_amount: 1000 }),
    row({ type: "incoming", is_system: true, amount: 1000, currency_code: "EUR", reporting_amount: 1159.2 }),
    row({ type: "incoming", is_system: true, amount: 75000, currency_code: "INR", reporting_amount: 784.5 }),
    row({ amount: 5, currency_code: "EUR", reporting_amount: 5.8 }),
    row({ amount: 1, reporting_amount: 1 }),
  ]

  it("never counts system rows as income", () => {
    const p = pnlInReporting(rows, "USD")
    expect(p.income).toBe(0)
    expect(p.expense).toBeCloseTo(6.8)
    expect(p.excluded).toBe(0)
  })

  it("nets a refund against expense, never income", () => {
    const p = pnlInReporting([row({ amount: 50, reporting_amount: 50 }), row({ type: "incoming", kind: "refund", amount: 20, reporting_amount: 20 })], "USD")
    expect(p).toEqual({ income: 0, expense: 30, excluded: 0 })
  })

  it("counts transfers as neither", () => {
    expect(pnlOf(row({ kind: "transfer", amount: 99, reporting_amount: 99 }), "USD")).toEqual({ income: 0, expense: 0 })
  })

  it("counts — never adds — a P&L row with no rate; a rate-less system row is not excluded", () => {
    const p = pnlInReporting(
      [
        row({ type: "incoming", amount: 100, reporting_amount: 100 }),
        row({ amount: 40, currency_code: "AED", reporting_amount: null }),
        row({ type: "incoming", is_system: true, amount: 500, currency_code: "AED", reporting_amount: null }),
      ],
      "USD",
    )
    expect(p).toEqual({ income: 100, expense: 0, excluded: 1 })
  })

  it("counts a mixed-currency split with no total (amount null) instead of adding 0", () => {
    // A collapsed split is labelled in the reporting currency; a body without
    // `reporting_amount` must not turn its null amount into Number(null) = 0.
    const p = pnlInReporting([row({ amount: 10 }), row({ amount: null, currency_count: 2 })], "USD")
    expect(p).toEqual({ income: 0, expense: 10, excluded: 1 })
  })
})

describe("sumByCurrency", () => {
  it("adds within a currency, never across, drops zeros, largest first", () => {
    expect(
      sumByCurrency([
        { currency: "EUR", amount: 600 },
        { currency: "INR", amount: 75000 },
        { currency: "EUR", amount: 400 },
        { currency: "USD", amount: 10 },
        { currency: "USD", amount: -10 },
      ]),
    ).toEqual([
      { currency: "INR", amount: 75000 },
      { currency: "EUR", amount: 1000 },
    ])
  })
})

describe("summarizeWealthByCurrency (MC-006)", () => {
  const acc = (over: Partial<WealthAccount>) => ({ type: "cash", current_balance: 0, archived_at: null, currency_code: "USD", ...over }) as WealthAccount

  it("is one familiar group for a single-currency workspace", () => {
    const g = summarizeWealthByCurrency([acc({ current_balance: 100 }), acc({ type: "bank", current_balance: 50 })], "USD")
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ currency: "USD", liquid: 150, total: 150 })
  })

  it("never adds EUR to INR", () => {
    const g = summarizeWealthByCurrency(
      [acc({ current_balance: 1000, currency_code: "EUR" }), acc({ current_balance: 75000, currency_code: "INR" }), acc({ type: "credit_card", current_balance: -300, currency_code: "EUR" })],
      "USD",
    )
    expect(g.map((x) => [x.currency, x.liquid, x.liabilities])).toEqual([
      ["EUR", 1000, 300],
      ["INR", 75000, 0],
    ])
  })

  it("labels an untagged account with the fallback currency", () => {
    expect(summarizeWealthByCurrency([acc({ current_balance: 5, currency_code: null })], "GBP")[0].currency).toBe("GBP")
  })
})

describe("formatParts", () => {
  it("reads like formatMoney for one part, and a zero in the fallback for none", () => {
    expect(formatParts([{ currency: "USD", amount: 12.5 }], "EUR")).toBe(formatMoney(12.5, "USD"))
    expect(formatParts([], "EUR")).toBe(formatMoney(0, "EUR"))
  })

  it("gives a negative later part its own operator, never '+ -€300'", () => {
    const out = formatParts([{ currency: "INR", amount: 75000 }, { currency: "EUR", amount: -300 }], "USD")
    expect(out).toBe(`${formatMoney(75000, "INR")} − ${formatMoney(300, "EUR")}`)
    expect(formatParts([{ currency: "USD", amount: -500 }, { currency: "EUR", amount: 300 }], "USD")).toBe(`${formatMoney(-500, "USD")} + ${formatMoney(300, "EUR")}`)
  })

  it("does not leak the sign of a hidden balance", () => {
    expect(formatParts([{ currency: "INR", amount: 75000 }, { currency: "EUR", amount: -300 }], "USD", false)).not.toContain("−")
  })
})

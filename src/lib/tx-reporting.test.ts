import { describe, expect, it } from "vitest"
import { compareByReportingAmount, summaryWithout, type TxSummary } from "./tx-reporting"

const usd: TxSummary = { incoming: 1000, outgoing: 500, currency: "USD", excluded_count: 2 }

describe("summaryWithout — instant delete keeps the converted summary honest", () => {
  it("takes an EUR expense out by its reporting amount, not its native amount", () => {
    const r = summaryWithout(usd, [{ type: "outgoing", kind: "standard", amount: 50, currency_code: "EUR", reporting_amount: "58.00" }], "USD")
    expect(r).toEqual({ incoming: 1000, outgoing: 442, currency: "USD", excluded_count: 2 })
  })

  it("a deleted refund un-nets EXPENSE (it was never income)", () => {
    const r = summaryWithout(usd, [{ type: "incoming", kind: "refund", amount: 20, currency_code: "EUR", reporting_amount: 23 }], "USD")
    expect(r).toMatchObject({ incoming: 1000, outgoing: 523 })
  })

  it("system rows and transfers were in neither figure", () => {
    const r = summaryWithout(usd, [
      { type: "incoming", kind: "standard", is_system: true, amount: 900, reporting_amount: 900 },
      { type: "outgoing", kind: "transfer", amount: 40, reporting_amount: 40 },
    ], "USD")
    expect(r).toEqual(usd)
  })

  it("keeps the summary's currency and excluded count", () => {
    const r = summaryWithout(usd, [{ type: "incoming", kind: "standard", amount: 100, currency_code: "USD" }], "INR")
    expect(r).toEqual({ incoming: 900, outgoing: 500, currency: "USD", excluded_count: 2 })
  })

  it("returns null (refetch) when a row has no rate — never subtracts a native amount", () => {
    expect(summaryWithout(usd, [{ type: "outgoing", kind: "standard", amount: 5000, currency_code: "INR", reporting_amount: null }], "USD")).toBeNull()
    // A mixed split whose leg has no rate comes back with amount null too.
    expect(summaryWithout(usd, [{ type: "outgoing", kind: "standard", amount: null, currency_code: "USD", reporting_amount: null }], "USD")).toBeNull()
  })
})

describe("compareByReportingAmount", () => {
  const eur = { type: "outgoing", amount: 100, currency_code: "EUR", reporting_amount: 116 }
  const inr = { type: "outgoing", amount: 5000, currency_code: "INR", reporting_amount: 56 }
  const noRate = { type: "outgoing", amount: 99999, currency_code: "CHF", reporting_amount: null }

  it("orders by the converted amount, not the native one", () => {
    expect([inr, eur].sort((a, b) => compareByReportingAmount(a, b, "USD", "desc"))).toEqual([eur, inr])
    expect([eur, inr].sort((a, b) => compareByReportingAmount(a, b, "USD", "asc"))).toEqual([inr, eur])
  })

  it("rows without a rate sort last in both directions", () => {
    expect([noRate, inr, eur].sort((a, b) => compareByReportingAmount(a, b, "USD", "desc")).at(-1)).toBe(noRate)
    expect([noRate, eur, inr].sort((a, b) => compareByReportingAmount(a, b, "USD", "asc")).at(-1)).toBe(noRate)
  })
})

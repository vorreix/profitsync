import { describe, expect, it } from "vitest"
import "@/lib/i18n"
import type { WealthSummary } from "@/lib/types"
import { spacesByCurrency, spacesSavedHeadline } from "./spaces-total"

const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")
const space = (currency_code: string | null, current_balance: number) => ({ currency_code, current_balance })

const summary = (complete: boolean): WealthSummary => ({
  reporting_currency: "INR",
  net_worth: 0, assets: 0, liabilities: 0, card_liabilities: 0, debts_owed: 0, debts_receivable: 0,
  complete, excluded_currencies: [], as_of: null, stale: false, multi_currency: true, by_currency: [],
  accounts: [
    { id: "trip", type: "space", name: "Trip", currency: "EUR", native_balance: 1000, converted_balance: 90000, rate: "90", rate_date: null, stale: false },
    { id: "car", type: "space", name: "Car", currency: "INR", native_balance: 200, converted_balance: 200, rate: "1", rate_date: null, stale: false },
    { id: "bank", type: "bank", name: "Bank", currency: "INR", native_balance: 5000, converted_balance: 5000, rate: "1", rate_date: null, stale: false },
  ],
})

describe("spacesSavedHeadline", () => {
  it("adds Spaces of one currency as they are, in that currency", () => {
    expect(spacesSavedHeadline([space("EUR", 1000), space("EUR", 250.5)], "INR", undefined)).toBe("€1,250.50")
    // A legacy Space with no stored currency is in the workspace's.
    expect(spacesSavedHeadline([space(null, 10)], "USD", undefined)).toBe("$10.00")
  })

  it("never adds two currencies raw — €1,000 + ₹200 is not ₹1,200 (MC-017)", () => {
    const spaces = [space("EUR", 1000), space("INR", 200)]
    expect(spacesByCurrency(spaces, "INR")).toEqual([{ currency: "EUR", amount: 1000 }, { currency: "INR", amount: 200 }])
    // Every rate known: the converted total, Spaces only (the bank is left out).
    expect(plain(spacesSavedHeadline(spaces, "INR", summary(true)))).toBe("₹90,200.00")
    // A rate missing, or no summary yet: the native totals side by side.
    expect(plain(spacesSavedHeadline(spaces, "INR", summary(false)))).toBe("€1,000.00 + ₹200.00")
    expect(plain(spacesSavedHeadline(spaces, "INR", undefined))).toBe("€1,000.00 + ₹200.00")
  })

  it("is zero in the workspace currency when there are no Spaces", () => {
    expect(spacesSavedHeadline([], "EUR", undefined)).toBe("€0.00")
  })
})

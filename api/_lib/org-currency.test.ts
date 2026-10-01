import { describe, expect, it } from "vitest"
import { orgCurrencyChanges, parseOrgCurrency } from "./org-currency"

describe("parseOrgCurrency", () => {
  it("accepts a known code in any case, trimmed", () => {
    expect(parseOrgCurrency(" inr ")).toBe("INR")
    expect(parseOrgCurrency("EUR")).toBe("EUR")
  })

  it("refuses what the admin edit used to store as-is", () => {
    for (const bad of ["EURO", "", "US", 42, null, undefined]) expect(parseOrgCurrency(bad), String(bad)).toBeNull()
  })
})

describe("orgCurrencyChanges", () => {
  it("records the reporting currency by its effective value", () => {
    expect(orgCurrencyChanges({ currency: "USD", reportingCurrency: "USD" }, "INR")).toEqual({ reporting_currency: { from: "USD", to: "INR" } })
    // A NULL reporting column reports in `currency` — re-saving it changes nothing.
    expect(orgCurrencyChanges({ currency: "USD", reportingCurrency: null }, "USD")).toEqual({})
  })

  it("records the drifted legacy column a real change rewrites (MC-001 / MC-033)", () => {
    // Onboarding wrote INR to `currency` only; the workspace still reported in USD.
    expect(orgCurrencyChanges({ currency: "INR", reportingCurrency: "USD" }, "INR")).toEqual({ reporting_currency: { from: "USD", to: "INR" } })
    // The admin edit wrote EUR to `currency` only; the owner moves on to INR.
    expect(orgCurrencyChanges({ currency: "EUR", reportingCurrency: "USD" }, "INR")).toEqual({
      reporting_currency: { from: "USD", to: "INR" },
      currency: { from: "EUR", to: "INR" },
    })
  })

  it("leaves a drifted workspace alone when the effective currency does not move", () => {
    // An admin rename re-sends the pre-filled reporting currency: writing it would
    // flip the legacy INR to USD and hide the org from the drift audit.
    expect(orgCurrencyChanges({ currency: "INR", reportingCurrency: "USD" }, "USD")).toEqual({})
    // A lower-case legacy value is the same currency.
    expect(orgCurrencyChanges({ currency: "usd", reportingCurrency: null }, "USD")).toEqual({})
  })
})

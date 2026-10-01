import { describe, expect, it } from "vitest"
import { billingCurrencyAttempts, DODO_SUPPORTED_CURRENCIES, resolveBillingCurrency, localPricingFor, type GeoPrice } from "./billing-currency"

describe("resolveBillingCurrency", () => {
  it("uses the org currency when it matches the billing country's currency", () => {
    expect(resolveBillingCurrency("EUR", "DE")).toEqual({ currency: "EUR", source: "org" })
    expect(resolveBillingCurrency("USD", "US")).toEqual({ currency: "USD", source: "org" })
  })

  it("ALWAYS bills India in INR — the org preference must not re-break Indian cards/UPI", () => {
    expect(resolveBillingCurrency("USD", "IN")).toEqual({ currency: "INR", source: "country" })
    expect(resolveBillingCurrency("EUR", "IN")).toEqual({ currency: "INR", source: "country" })
    expect(resolveBillingCurrency("INR", "IN")).toEqual({ currency: "INR", source: "org" })
  })

  it("honors a supported org currency that differs from the country currency", () => {
    expect(resolveBillingCurrency("EUR", "GB")).toEqual({ currency: "EUR", source: "org" })
    expect(resolveBillingCurrency("USD", "DE")).toEqual({ currency: "USD", source: "org" })
  })

  it("falls back to the country currency for unsupported org currencies", () => {
    expect(resolveBillingCurrency("XXX", "GB")).toEqual({ currency: "GBP", source: "country" })
  })

  it("falls back to USD when both org currency and country are unknown", () => {
    expect(resolveBillingCurrency("", "")).toEqual({ currency: "USD", source: "country" })
    expect(resolveBillingCurrency(null, undefined)).toEqual({ currency: "USD", source: "country" })
    expect(resolveBillingCurrency("XXX", "ZZ")).toEqual({ currency: "USD", source: "country" })
  })

  it("normalizes case and whitespace", () => {
    expect(resolveBillingCurrency(" eur ", "de")).toEqual({ currency: "EUR", source: "org" })
  })
})

describe("billingCurrencyAttempts", () => {
  it("tries the org preference, then the country currency, then omits the field", () => {
    expect(billingCurrencyAttempts("EUR", "GB")).toEqual(["EUR", "GBP", undefined])
  })

  it("dedupes when preference and country currency agree", () => {
    expect(billingCurrencyAttempts("EUR", "DE")).toEqual(["EUR", undefined])
    expect(billingCurrencyAttempts("USD", "IN")).toEqual(["INR", undefined])
  })

  it("never produces an empty attempt list", () => {
    expect(billingCurrencyAttempts(null, null)).toEqual(["USD", undefined])
  })
})

describe("DODO_SUPPORTED_CURRENCIES", () => {
  it("contains every currency the checkout could already pass today", () => {
    for (const c of ["USD", "EUR", "GBP", "INR", "AUD", "JPY", "BRL", "AED"]) {
      expect(DODO_SUPPORTED_CURRENCIES.has(c)).toBe(true)
    }
  })
})

describe("localPricingFor — the price shown is in the currency checkout charges", () => {
  const base = { monthlyUsd: 4.99, yearlyUsd: 49.99, monthlyDiscountPct: 50, yearlyDiscountPct: 20 }
  const inr = { currency: "INR", monthly: 499900, yearly: 4999900, monthlyDiscountPct: 50 }
  const show = (orgCurrency: string, country: string, geo: Record<string, GeoPrice>) =>
    localPricingFor(geo, country, resolveBillingCurrency(orgCurrency, country).currency, base)

  it("never shows another country's entry: a EUR workspace gets the USD base, not ₹", () => {
    expect(show("EUR", "DE", { IN: inr })).toEqual({ currency: "USD", monthly: 499, yearly: 4999, monthly_discount_pct: 50, yearly_discount_pct: 20 })
    // A GBP entry for its own country is still not what a EUR workspace pays.
    expect(show("EUR", "GB", { GB: { currency: "GBP", monthly: 399, yearly: 3999 } }).currency).toBe("USD")
  })

  it("shows the country's own entry when it is in the charged currency (India bills INR)", () => {
    expect(show("USD", "IN", { IN: inr })).toEqual({ currency: "INR", monthly: 499900, yearly: 4999900, monthly_discount_pct: 50, yearly_discount_pct: 0 })
  })

  it("shows any entry priced in the charged currency", () => {
    expect(show("EUR", "FR", { DE: { currency: "EUR", monthly: 459, yearly: 4590 } })).toMatchObject({ currency: "EUR", monthly: 459 })
  })

  it("falls back to the USD base with no geo pricing", () => {
    expect(localPricingFor(null, "US", "USD", base).currency).toBe("USD")
  })
})

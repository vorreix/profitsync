import { describe, expect, it } from "vitest"
import { billingCurrencyAttempts, DODO_SUPPORTED_CURRENCIES, resolveBillingCurrency } from "./billing-currency"

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

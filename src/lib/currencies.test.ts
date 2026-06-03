import { describe, expect, it } from "vitest"
import { COUNTRY_TO_CURRENCY, CURRENCY_LIST, currencyForCountry } from "./currencies"

describe("currencyForCountry", () => {
  it("maps a known country code to its currency", () => {
    expect(currencyForCountry("IT")).toBe("EUR")
    expect(currencyForCountry("US")).toBe("USD")
    expect(currencyForCountry("IN")).toBe("INR")
  })

  it("is case-insensitive", () => {
    expect(currencyForCountry("gb")).toBe("GBP")
  })

  it("falls back to USD for unknown codes", () => {
    expect(currencyForCountry("ZZ")).toBe("USD")
  })

  it("falls back to USD for missing input", () => {
    expect(currencyForCountry(undefined)).toBe("USD")
    expect(currencyForCountry(null)).toBe("USD")
    expect(currencyForCountry("")).toBe("USD")
  })

  it("only maps to currencies that exist in CURRENCY_LIST", () => {
    const valid = new Set(CURRENCY_LIST.map((c) => c.code))
    for (const currency of Object.values(COUNTRY_TO_CURRENCY)) {
      expect(valid.has(currency)).toBe(true)
    }
  })
})

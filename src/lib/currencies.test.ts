import { afterEach, describe, expect, it, vi } from "vitest"
import {
  COUNTRY_TO_CURRENCY,
  CURRENCY_LIST,
  currencyForCountry,
  detectCountryCode,
  detectDefaultCurrency,
} from "./currencies"

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

describe("detectCountryCode", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("derives the country from the device timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Asia/Kolkata" }),
    } as unknown as Intl.DateTimeFormat)
    expect(detectCountryCode()).toBe("IN")
  })

  it("falls back to the browser locale region when the timezone is unknown", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Antarctica/Troll" }),
    } as unknown as Intl.DateTimeFormat)
    vi.spyOn(navigator, "language", "get").mockReturnValue("it-IT")
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["it-IT"])
    expect(detectCountryCode()).toBe("IT")
  })
})

describe("detectDefaultCurrency", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("maps the detected timezone country to its currency", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Europe/Rome" }),
    } as unknown as Intl.DateTimeFormat)
    expect(detectDefaultCurrency()).toBe("EUR")
  })
})

import { afterEach, describe, expect, it, vi } from "vitest"
import {
  COUNTRY_TO_CURRENCY,
  CURRENCY_LIST,
  currencyForCountry,
  detectCountryCode,
  detectDefaultCurrency,
  getCurrencySymbol,
  intlCurrencySymbol,
  isSelectableCurrency,
  minorUnits,
  SELECTABLE_CURRENCY_LIST,
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

  it("never preselects a currency a new workspace can't use (MC-031)", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "Asia/Kuwait" }),
    } as unknown as Intl.DateTimeFormat)
    expect(detectDefaultCurrency()).toBe("USD")
    expect(detectDefaultCurrency("INR")).toBe("INR")
  })
})

describe("getCurrencySymbol", () => {
  it("never gives another dollar the bare US \"$\" (MC-140)", () => {
    expect(getCurrencySymbol("USD")).toBe("$")
    expect(getCurrencySymbol("CAD")).toBe("CA$")
    expect(getCurrencySymbol("AUD")).toBe("A$")
    expect(getCurrencySymbol("MXN")).toBe("MX$")
    // The curated table gave NIO the same "C$" as CAD.
    expect(getCurrencySymbol("NIO")).not.toBe(getCurrencySymbol("CAD"))
  })

  it("keeps a currency's own sign when no other currency shares it", () => {
    // Unchanged input prefixes for single-currency workspaces.
    for (const [code, sign] of [["EUR", "€"], ["INR", "₹"], ["NGN", "₦"], ["ZAR", "R"], ["THB", "฿"], ["GBP", "£"], ["JPY", "¥"]]) {
      expect(getCurrencySymbol(code)).toBe(sign)
    }
  })

  it("replaces a shared sign with Intl's unambiguous one", () => {
    expect(getCurrencySymbol("SEK")).toBe("SEK") // "kr" is also DKK, NOK, ISK
    expect(getCurrencySymbol("CNY")).toBe("CN¥") // "¥" is also JPY
  })

  it("gives every known currency a different symbol", () => {
    const symbols = CURRENCY_LIST.map((c) => getCurrencySymbol(c.code))
    expect(new Set(symbols).size).toBe(symbols.length)
  })

  it("never throws on a malformed code", () => {
    expect(getCurrencySymbol("")).toBe("")
    expect(getCurrencySymbol("not-a-code")).toBe("not-a-code")
  })
})

describe("intlCurrencySymbol", () => {
  it("is the en-US sign formatMoney prints, or the ISO code", () => {
    expect(intlCurrencySymbol("CAD")).toBe("CA$")
    expect(intlCurrencySymbol("KWD")).toBe("KWD")
    expect(intlCurrencySymbol("not-a-code")).toBe("not-a-code")
  })
})

describe("minorUnits / SELECTABLE_CURRENCY_LIST (MC-031)", () => {
  it("reads ISO 4217, not Intl's display digits", () => {
    expect(minorUnits("JPY")).toBe(0)
    expect(minorUnits("KWD")).toBe(3)
    expect(minorUnits("IDR")).toBe(2) // Intl shows 0 — ISO says 2
    expect(minorUnits("usd")).toBe(2)
  })

  it("offers no currency whose third decimal the money columns can't keep", () => {
    for (const code of ["KWD", "BHD", "OMR", "JOD", "TND", "IQD", "LYD"]) {
      expect(isSelectableCurrency(code)).toBe(false)
      expect(SELECTABLE_CURRENCY_LIST.some((c) => c.code === code)).toBe(false)
    }
    expect(isSelectableCurrency("jpy")).toBe(true)
    expect(SELECTABLE_CURRENCY_LIST.length).toBe(CURRENCY_LIST.length - 7)
  })
})

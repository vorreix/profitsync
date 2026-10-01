import { afterEach, describe, expect, it, vi } from "vitest"
import i18n from "@/lib/i18n"
import { currencySymbol, formatList, formatMoney, formatMoneyCompact, formatMoneyWhole, formatPercent, formatRate } from "./wealth"

// Intl output carries non-breaking / narrow spaces; compare on plain ones.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, " ")

const original = i18n.language
afterEach(() => {
  i18n.language = original
  vi.restoreAllMocks()
})

describe("formatMoney", () => {
  it("uses the currency's ISO minor units — none for JPY, three for KWD", () => {
    expect(formatMoney(1500.5, "JPY")).toBe("¥1,501")
    expect(plain(formatMoney(1.25, "KWD"))).toBe("KWD 1.250")
  })

  it("groups digits the way the UI language does", () => {
    expect(formatMoney(1234567.5, "INR")).toBe("₹12,34,567.50")
    i18n.language = "de"
    expect(plain(formatMoney(1234.5, "EUR"))).toBe("1.234,50 €")
  })

  it("never prints a negative zero or NaN", () => {
    expect(formatMoney(-0, "USD")).toBe("$0.00")
    expect(formatMoney(Number.NaN, "USD")).toBe("$0.00")
    // Float residue and sub-cent remainders round to zero, not "-$0.00".
    expect(formatMoney(0.3 - 0.1 - 0.2, "USD")).toBe("$0.00")
    expect(formatMoney(-0.004, "USD")).toBe("$0.00")
    expect(formatMoney(-0.4, "JPY")).toBe("¥0")
    // …while a real cent stays negative.
    expect(formatMoney(-0.01, "USD")).toBe("-$0.01")
  })

  it("never throws on a malformed currency", () => {
    expect(formatMoney(12, "")).toBe("12.00")
    expect(formatMoney(12, "nope")).toBe("nope 12.00")
    expect(formatMoney(12, "", false)).toBe(" *****")
  })

  it("masks with the unambiguous symbol", () => {
    expect(formatMoney(12, "CAD", false)).toBe("CA$ *****")
    expect(currencySymbol("AUD")).toBe("A$")
  })
})

describe("formatMoneyCompact", () => {
  it("abbreviates, keeping the currency", () => {
    expect(formatMoneyCompact(1234, "USD")).toBe("$1.2K")
    expect(formatMoneyCompact(87, "EUR")).toBe("€87")
  })

  it("never shows more decimals than the currency has, nor a negative zero", () => {
    expect(formatMoneyCompact(87.5, "JPY")).toBe("¥88")
    expect(formatMoneyCompact(-0.04, "USD")).toBe("$0")
  })

  it("does not throw for a three-decimal currency (MC-138)", () => {
    expect(() => formatMoneyCompact(1250.125, "KWD")).not.toThrow()
  })

  it("falls back to the plain format when the engine refuses the options", () => {
    // An old WebView: compact options rejected with a RangeError.
    const Real = Intl.NumberFormat
    vi.spyOn(Intl, "NumberFormat").mockImplementation(function (locale?: string | string[], opts?: Intl.NumberFormatOptions) {
      if (opts?.notation) throw new RangeError("maximumFractionDigits value is out of range")
      return new Real(locale, opts)
    } as unknown as typeof Intl.NumberFormat)
    expect(formatMoneyCompact(1234, "USD")).toBe("$1,234.00")
  })
})

describe("formatMoneyWhole", () => {
  it("drops cents for KPI tiles", () => {
    expect(formatMoneyWhole(12345.67, "USD")).toBe("$12,346")
    expect(formatMoneyWhole(-0.4, "USD")).toBe("$0")
    expect(formatMoneyWhole(12, "CAD", false)).toBe("CA$ *****")
  })

  it("keeps a three-decimal currency's decimals (MC-129)", () => {
    expect(plain(formatMoneyWhole(1.25, "KWD"))).toBe("KWD 1.250")
  })
})

describe("formatRate", () => {
  it("never rounds a small rate to zero or to a wrong value (MC-103)", () => {
    expect(formatRate("IDR", "USD", "0.0000559")).toBe("1 IDR = $0.0000559")
    expect(formatRate("VND", "USD", 0.000038)).toBe("1 VND = $0.000038")
    expect(formatRate("INR", "EUR", 0.010345)).toBe("1 INR = €0.01035")
  })

  it("keeps the money look", () => {
    expect(formatRate("X", "USD", 0.5)).toBe("1 X = $0.50")
    expect(formatRate("EUR", "USD", 1.0834)).toBe("1 EUR = $1.08")
  })
})

describe("formatPercent / formatList", () => {
  it("localises the share", () => {
    expect(formatPercent(45.3)).toBe("45.3%")
    i18n.language = "de"
    expect(plain(formatPercent(45.3))).toBe("45,3 %")
  })

  it("joins in the UI language", () => {
    expect(formatList(["USD", "EUR"])).toBe("USD and EUR")
    i18n.language = "ar"
    expect(formatList(["USD", "EUR"])).toContain("و")
  })
})

import { describe, expect, it } from "vitest"
import {
  ACCOUNT_SWATCHES,
  CASH_COLOR,
  SPACE_COLOR,
  accountAppearance,
  accountColorStyle,
  accountColorVars,
  boldSurface,
  isAccountColorStyle,
  parseAccountColor,
  resolveAccountColor,
  swatchForKey,
  withAlpha,
} from "./account-color"
import { relativeLuminance } from "./cards"

describe("resolveAccountColor", () => {
  it("prefers the user's explicit colour over everything else", () => {
    const got = resolveAccountColor({ id: "a", type: "bank", color: "#ff0000", brand_domain: "hdfcbank.com" })
    expect(got).toEqual({ hex: "#FF0000", source: "custom" })
  })

  it("falls back to the bank's curated brand colour", () => {
    expect(resolveAccountColor({ id: "a", type: "bank", brand_domain: "www.hdfcbank.com" })).toEqual({ hex: "#004B8B", source: "brand" })
  })

  it("paints cash the same emerald in every workspace", () => {
    expect(resolveAccountColor({ id: "a", type: "cash" })).toEqual({ hex: CASH_COLOR, source: "cash" })
  })

  it("gives a Space the savings teal when it has no colour of its own", () => {
    expect(resolveAccountColor({ id: "a", type: "space" })).toEqual({ hex: SPACE_COLOR, source: "space" })
    expect(resolveAccountColor({ id: "a", type: "space", color: "#123456" }).source).toBe("custom")
  })

  it("gives an unbranded bank a stable swatch from its id", () => {
    const first = resolveAccountColor({ id: "0f9d3a11-1111-2222-3333-444455556666", type: "bank" })
    const again = resolveAccountColor({ id: "0f9d3a11-1111-2222-3333-444455556666", type: "bank" })
    expect(first).toEqual(again)
    expect(first.source).toBe("auto")
    expect(ACCOUNT_SWATCHES).toContain(first.hex)
  })

  it("ignores a malformed stored colour rather than painting garbage", () => {
    expect(resolveAccountColor({ id: "a", type: "cash", color: "not-a-colour" }).source).toBe("cash")
  })
})

describe("swatchForKey", () => {
  it("spreads similar ids across different swatches", () => {
    const a = swatchForKey("account-1")
    const b = swatchForKey("account-2")
    expect(a).not.toBe(b)
  })

  it("never returns undefined, even for an empty key", () => {
    expect(ACCOUNT_SWATCHES).toContain(swatchForKey(""))
  })
})

describe("swatch palette", () => {
  it("is dark enough everywhere for white text on a bold tile", () => {
    for (const hex of ACCOUNT_SWATCHES) {
      expect(relativeLuminance(hex)).toBeLessThan(0.42)
    }
  })

  it("has no duplicates", () => {
    expect(new Set(ACCOUNT_SWATCHES).size).toBe(ACCOUNT_SWATCHES.length)
  })
})

describe("accountColorStyle", () => {
  it("defaults anything unknown to subtle", () => {
    expect(accountColorStyle("bold")).toBe("bold")
    expect(accountColorStyle("subtle")).toBe("subtle")
    expect(accountColorStyle("paused")).toBe("subtle")
    expect(accountColorStyle(null)).toBe("subtle")
    expect(isAccountColorStyle("loud")).toBe(false)
  })
})

describe("withAlpha", () => {
  it("emits an rgba string and clamps the alpha", () => {
    expect(withAlpha("#0A141E", 0.5)).toBe("rgba(10, 20, 30, 0.5)")
    expect(withAlpha("#000000", 5)).toBe("rgba(0, 0, 0, 1)")
    expect(withAlpha("#FFFFFF", -1)).toBe("rgba(255, 255, 255, 0)")
  })
})

describe("accountColorVars", () => {
  it("gives the dark theme a lifted copy so a dark brand colour stays visible", () => {
    const vars = accountColorVars("#0B4A9B")
    expect(vars["--acct-rail-light"]).toBe("#0B4A9B")
    expect(relativeLuminance(vars["--acct-rail-dark"])).toBeGreaterThan(relativeLuminance("#0B4A9B"))
  })
})

describe("boldSurface", () => {
  it("darkens toward the bottom-right and picks readable text", () => {
    const gold = boldSurface("#D4AF37")
    expect(gold.text).toBe("dark")
    expect(relativeLuminance(gold.to)).toBeLessThan(relativeLuminance(gold.from))
    expect(boldSurface("#2563EB").text).toBe("light")
    expect(boldSurface("#2563EB").style.backgroundImage).toContain("linear-gradient")
  })
})

describe("accountAppearance", () => {
  it("carries the gradient only in bold", () => {
    const subtle = accountAppearance({ id: "a", type: "bank", color: "#2563EB", color_style: "subtle" })
    expect(subtle.bold).toBe(false)
    expect(subtle.vars.backgroundImage).toBeUndefined()

    const bold = accountAppearance({ id: "a", type: "bank", color: "#2563EB", color_style: "bold" })
    expect(bold.bold).toBe(true)
    expect(bold.vars.backgroundImage).toContain("#2563EB")
    expect(bold.text).toBe("light")
  })
})

describe("parseAccountColor", () => {
  it("accepts a hex, with or without the hash, and upper-cases it", () => {
    expect(parseAccountColor("#2563eb")).toEqual({ ok: true, value: "#2563EB" })
    expect(parseAccountColor("2563eb")).toEqual({ ok: true, value: "#2563EB" })
  })

  it("treats empty, null and \"auto\" as a reset to AUTO", () => {
    expect(parseAccountColor("")).toEqual({ ok: true, value: "" })
    expect(parseAccountColor("  ")).toEqual({ ok: true, value: "" })
    expect(parseAccountColor("auto")).toEqual({ ok: true, value: "" })
    expect(parseAccountColor(null)).toEqual({ ok: true, value: "" })
    expect(parseAccountColor(undefined)).toEqual({ ok: true, value: "" })
  })

  it("rejects anything the DB CHECK would reject", () => {
    expect(parseAccountColor("red")).toEqual({ ok: false })
    expect(parseAccountColor("#12345")).toEqual({ ok: false })
    expect(parseAccountColor("rgb(1,2,3)")).toEqual({ ok: false })
    expect(parseAccountColor(42)).toEqual({ ok: false })
  })
})

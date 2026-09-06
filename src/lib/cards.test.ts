import { describe, expect, it } from "vitest"
import {
  autopayAmount,
  autopayDue,
  autopayEligible,
  autopayPlan,
  autopayPreview,
  cardDisplayName,
  cardExpiresSoon,
  curatedBankColor,
  darken,
  expiryEndIso,
  expiryLabel,
  guessNetworkFromName,
  isCardExpired,
  isValidLast4,
  maskedNumber,
  maskedTail,
  parseExpiry,
  primaryBrandColor,
  readableTextOn,
  relativeLuminance,
  resolveCardPalette,
  sanitizeCardDesign,
} from "./cards"

describe("identity", () => {
  it("masks the number line", () => {
    expect(maskedNumber("1234")).toBe("•••• •••• •••• 1234")
    expect(maskedNumber("")).toBe("•••• •••• •••• ••••")
    expect(maskedTail(" 9876 ")).toBe("•••• 9876")
  })

  it("validates the tail", () => {
    expect(isValidLast4("")).toBe(true)
    expect(isValidLast4("1234")).toBe(true)
    expect(isValidLast4("123")).toBe(false)
    expect(isValidLast4("12345")).toBe(false)
    expect(isValidLast4("12a4")).toBe(false)
  })

  it("derives a display name from the bank and network when there is no nickname", () => {
    expect(cardDisplayName({ name: "Travel card", network: "visa", kind: "debit", account_bank_name: "Federal" })).toBe("Travel card")
    expect(cardDisplayName({ name: "", network: "visa", kind: "debit", account_bank_name: "Federal" })).toBe("Federal Visa")
    expect(cardDisplayName({ name: "", network: "other", kind: "credit", account_bank_name: "Intesa" })).toBe("Intesa Credit card")
    expect(cardDisplayName({ name: "", network: "mastercard", kind: "credit" })).toBe("Mastercard")
  })

  it("guesses the network from free text", () => {
    expect(guessNetworkFromName("HDFC Visa Platinum")).toBe("visa")
    expect(guessNetworkFromName("ICICI MasterCard")).toBe("mastercard")
    expect(guessNetworkFromName("Amex Gold")).toBe("amex")
    expect(guessNetworkFromName("SBI RuPay")).toBe("rupay")
    expect(guessNetworkFromName("Visa Gold")).toBe("visa")
    expect(guessNetworkFromName("Federal")).toBe("other")
    expect(guessNetworkFromName(null)).toBe("other")
  })
})

describe("expiry", () => {
  it("formats MM/YY", () => {
    expect(expiryLabel(3, 2028)).toBe("03/28")
    expect(expiryLabel(12, 2030)).toBe("12/30")
    expect(expiryLabel(null, 2028)).toBe("")
  })

  it("is valid through the last day of the month (leap years included)", () => {
    expect(expiryEndIso(2, 2028)).toBe("2028-02-29")
    expect(expiryEndIso(2, 2027)).toBe("2027-02-28")
    expect(expiryEndIso(12, 2026)).toBe("2026-12-31")
    expect(isCardExpired(2, 2028, "2028-02-29")).toBe(false)
    expect(isCardExpired(2, 2028, "2028-03-01")).toBe(true)
    expect(isCardExpired(null, null, "2028-03-01")).toBe(false)
  })

  it("flags cards expiring within 30 days, never expired ones", () => {
    expect(cardExpiresSoon(9, 2026, "2026-09-05")).toBe(true) // ends 2026-09-30 → 25 days
    expect(cardExpiresSoon(10, 2026, "2026-09-05")).toBe(false) // ends 2026-10-31 → 56 days
    expect(cardExpiresSoon(10, 2026, "2026-10-01", 30)).toBe(true) // 30 days exactly
    expect(cardExpiresSoon(8, 2026, "2026-09-05")).toBe(false) // already expired
  })

  it("parses typed expiry", () => {
    expect(parseExpiry("03/28")).toEqual({ month: 3, year: 2028 })
    expect(parseExpiry("3 / 2028")).toEqual({ month: 3, year: 2028 })
    expect(parseExpiry("13/28")).toBeNull()
    expect(parseExpiry("0328")).toBeNull()
    expect(parseExpiry("")).toBeNull()
  })
})

describe("colour", () => {
  it("computes luminance and readable text", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5)
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5)
    expect(readableTextOn("#004B8B")).toBe("light")
    expect(readableTextOn("#FFCC00")).toBe("dark")
    expect(readableTextOn("#E6E8EC")).toBe("dark")
  })

  it("darkens toward black", () => {
    expect(darken("#FFFFFF", 0.5)).toBe("#808080")
    expect(darken("#004B8B", 0)).toBe("#004B8B")
  })

  it("picks a usable brand colour: brand > accent > dark, skipping near-white", () => {
    expect(primaryBrandColor([
      { hex: "#FFFFFF", type: "light" },
      { hex: "#E71319", type: "accent" },
      { hex: "#004B8B", type: "brand" },
    ])).toBe("#004B8B")
    expect(primaryBrandColor([{ hex: "#FFFFFF", type: "brand" }, { hex: "#E71319", type: "accent" }])).toBe("#E71319")
    expect(primaryBrandColor([{ hex: "#FFFFFF", type: "brand" }])).toBeNull()
    expect(primaryBrandColor(null)).toBeNull()
    expect(primaryBrandColor([{ hex: "not-a-colour", type: "brand" }])).toBeNull()
  })

  it("finds curated bank colours by domain suffix", () => {
    expect(curatedBankColor("hdfcbank.com")).toBe("#004B8B")
    expect(curatedBankColor("https://www.hdfcbank.com/personal")).toBe("#004B8B")
    expect(curatedBankColor("intesasanpaolo.com")).toBe("#1C7B5A")
    expect(curatedBankColor("unknown-bank.example")).toBeNull()
    expect(curatedBankColor("")).toBeNull()
  })
})

describe("resolveCardPalette", () => {
  it("standard wears the brand colour, darkened toward the bottom", () => {
    const p = resolveCardPalette({ tier: "standard", brand_colors: [{ hex: "#004B8B", type: "brand" }] })
    expect(p.from).toBe("#004B8B")
    expect(p.to).toBe(darken("#004B8B", 0.5))
    expect(p.text).toBe("light")
    expect(p.source).toBe("brand")
  })

  it("falls back to the curated table, then a neutral default", () => {
    expect(resolveCardPalette({ tier: "standard", brand_domain: "kotak.com" })).toMatchObject({ from: "#ED1C24", source: "curated" })
    expect(resolveCardPalette({ tier: "standard" })).toMatchObject({ source: "default", text: "light" })
  })

  it("metallic tiers ignore brand colours", () => {
    expect(resolveCardPalette({ tier: "gold", brand_colors: [{ hex: "#004B8B", type: "brand" }] })).toMatchObject({ texture: "metallic", text: "dark", source: "tier" })
    expect(resolveCardPalette({ tier: "black" })).toMatchObject({ texture: "matte", text: "light", accent: "#D4AF37" })
    expect(resolveCardPalette({ tier: "metal" })).toMatchObject({ texture: "brushed", text: "light" })
    expect(resolveCardPalette({ tier: "platinum" })).toMatchObject({ text: "dark" })
  })

  it("custom uses the user's colours and infers text/pattern when missing", () => {
    expect(resolveCardPalette({ tier: "custom", design: { from: "#ff0088", to: "#330022", text: "light", pattern: "waves" } })).toMatchObject({
      from: "#FF0088", to: "#330022", text: "light", pattern: "waves", source: "custom",
    })
    expect(resolveCardPalette({ tier: "custom", design: { from: "#FFFFFF" } })).toMatchObject({ text: "dark", pattern: "none" })
    // A custom tier without a usable colour behaves like standard.
    expect(resolveCardPalette({ tier: "custom", design: { from: "nope" } }).source).toBe("default")
  })

  it("sanitizes custom designs", () => {
    expect(sanitizeCardDesign({ from: "#abcdef", to: "zzz", text: "purple", pattern: "stars" })).toEqual({ from: "#ABCDEF", to: darken("#ABCDEF", 0.45), text: "dark", pattern: "none" })
    expect(sanitizeCardDesign({ from: "#000000", to: "#111111", text: "light", pattern: "dots" })).toEqual({ from: "#000000", to: "#111111", text: "light", pattern: "dots" })
    expect(sanitizeCardDesign(null)).toBeNull()
    expect(sanitizeCardDesign({ to: "#000000" })).toBeNull()
  })
})

describe("autopay", () => {
  const card = { autopay: true, autopay_since: "2026-09-01", funding_account_id: "bank", status: "active" }
  const stmt = { id: "s1", due_date: "2026-09-15", remaining: 500, autopay_status: null }

  it("pays only eligible statements", () => {
    expect(autopayEligible(card, stmt)).toBe(true)
    expect(autopayEligible({ ...card, autopay: false }, stmt)).toBe(false)
    expect(autopayEligible({ ...card, funding_account_id: null }, stmt)).toBe(false)
    // Freezing blocks purchases, not paying what is owed; closing stops everything.
    expect(autopayEligible({ ...card, status: "frozen" }, stmt)).toBe(true)
    expect(autopayEligible({ ...card, status: "closed" }, stmt)).toBe(false)
    expect(autopayEligible(card, { ...stmt, remaining: 0 })).toBe(false)
    expect(autopayEligible(card, { ...stmt, autopay_status: "paid" })).toBe(false)
    expect(autopayEligible(card, { ...stmt, autopay_status: "processing" })).toBe(false)
    // A statement due ON or before the day autopay was switched on is the user's to settle.
    expect(autopayEligible(card, { ...stmt, due_date: "2026-08-15" })).toBe(false)
    expect(autopayEligible(card, { ...stmt, due_date: "2026-09-01" })).toBe(false)
    expect(autopayEligible(card, { ...stmt, due_date: "2026-09-02" })).toBe(true)
    expect(autopayEligible({ ...card, autopay_since: null }, { ...stmt, due_date: "2026-08-15" })).toBe(true)
  })

  it("is due on the due date, not before", () => {
    expect(autopayDue(stmt, "2026-09-14")).toBe(false)
    expect(autopayDue(stmt, "2026-09-15")).toBe(true)
    expect(autopayDue(stmt, "2026-10-01")).toBe(true)
  })

  it("pays ONLY the newest due statement when several are due at once (catch-up never double-pays)", () => {
    // Closes on the 25th, due on the 10th; the app was not opened for three months.
    const jun = { id: "jun", due_date: "2026-07-10", remaining: 500, autopay_status: null }
    const jul = { id: "jul", due_date: "2026-08-10", remaining: 700, autopay_status: null } // includes June's 500
    const aug = { id: "aug", due_date: "2026-09-10", remaining: 900, autopay_status: null } // includes July's 700
    const sep = { id: "sep", due_date: "2026-10-10", remaining: 950, autopay_status: null } // not due yet
    const c = { ...card, autopay_since: "2026-06-01" }
    const plan = autopayPlan(c, [sep, aug, jun, jul], "2026-09-12")
    expect(plan.pay?.id).toBe("aug")
    expect(plan.supersede.map((s) => s.id)).toEqual(["jun", "jul"])
    // Nothing due → nothing to pay, nothing superseded.
    expect(autopayPlan(c, [sep], "2026-09-12")).toEqual({ pay: null, supersede: [] })
    // A single due statement is simply paid.
    expect(autopayPlan(c, [jun], "2026-07-10").pay?.id).toBe("jun")
  })

  it("never pays more than the card owes right now", () => {
    expect(autopayAmount(800, 500)).toBe(500) // user already paid 300 before adding the card
    expect(autopayAmount(500, 800)).toBe(500)
    expect(autopayAmount(500, 0)).toBe(0)
    expect(autopayAmount(120.456, 1000)).toBe(120.46)
  })

  it("previews the soonest eligible statement, clamped to the debt", () => {
    const later = { id: "s2", due_date: "2026-10-15", remaining: 120.456, autopay_status: null }
    expect(autopayPreview(card, [later, stmt])).toEqual({ date: "2026-09-15", amount: 500, statement_id: "s1" })
    expect(autopayPreview(card, [later, stmt], 300)).toEqual({ date: "2026-09-15", amount: 300, statement_id: "s1" })
    expect(autopayPreview(card, [{ ...stmt, autopay_status: "paid" }, later])).toEqual({ date: "2026-10-15", amount: 120.46, statement_id: "s2" })
    expect(autopayPreview({ ...card, autopay: false }, [stmt])).toBeNull()
  })
})

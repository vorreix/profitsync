import { describe, expect, it } from "vitest"
import type { Card, WealthAccount } from "./types"
import {
  cardCreatePayload,
  cardEditPayload,
  cardPreviewProps,
  cardWizardDirty,
  cardWizardFieldForServerError,
  cardWizardFormFromCard,
  cardWizardStepForField,
  cardWizardSteps,
  customTextUnreadable,
  defaultHolderName,
  duplicateLast4,
  effectiveDesign,
  emptyCardWizardForm,
  formatExpiryInput,
  isExpiryPast,
  nicknamePlaceholder,
  parseCardApiError,
  sanitizeLast4,
  tierSwatch,
  validateCardWizard,
  validateCardWizardStep,
  type CardWizardForm,
} from "./card-wizard"

const TODAY = "2026-09-05"

const bank = (over: Partial<WealthAccount> = {}): WealthAccount => ({
  id: "bank-1",
  organization_id: "org",
  type: "bank",
  bank_name: "Federal Bank",
  nickname: "",
  opening_balance: 0,
  current_balance: 2651,
  icon: "bank",
  brand_domain: "federalbank.co.in",
  logo_src: "data:image/png;base64,abc",
  archived_at: null,
  created_at: "",
  updated_at: "",
  ...over,
})

const card = (over: Partial<Card> = {}): Card => ({
  id: "card-1",
  organization_id: "org",
  kind: "credit",
  account_id: "liab-1",
  funding_account_id: "bank-1",
  name: "Visa Gold",
  holder_name: "Ada Lovelace",
  network: "visa",
  last4: "1234",
  expiry_month: 9,
  expiry_year: 2027,
  tier: "gold",
  design: null,
  brand_colors: [{ hex: "#0B4A9B", type: "brand" }],
  brand_logo_url: "https://cdn/logo.svg",
  autopay: true,
  autopay_since: "2026-09-01",
  status: "active",
  position: 0,
  created_at: "",
  updated_at: "",
  account_type: "credit_card",
  account_bank_name: "HDFC Bank",
  account_nickname: "Visa Gold",
  account_credit_limit: "2000",
  account_statement_closing_day: 1,
  account_payment_due_day: 15,
  account_brand_domain: "hdfcbank.com",
  account_logo_url: "https://cdn/hdfc.png",
  account_logo_src: null,
  ...over,
})

const debitForm = (over: Partial<CardWizardForm> = {}): CardWizardForm => ({
  ...emptyCardWizardForm({ kind: "debit", account_id: "bank-1", holder_name: "Ada" }),
  network: "mastercard",
  last4: "4321",
  expiry: "09/27",
  ...over,
})

const creditForm = (over: Partial<CardWizardForm> = {}): CardWizardForm => {
  const f = emptyCardWizardForm({ kind: "credit", funding_account_id: "bank-1", holder_name: "Ada" })
  return {
    ...f,
    issuer_name: "HDFC Bank",
    issuer_domain: "hdfcbank.com",
    issuer_logo_url: "https://cdn/hdfc.png",
    last4: "1234",
    expiry: "09/27",
    credit: { ...f.credit, credit_limit: "2000", current_debt: "150", statement_closing_day: "1", payment_due_day: "15" },
    ...over,
  }
}

describe("seeding", () => {
  it("starts as a standard debit card with the presets applied", () => {
    const f = emptyCardWizardForm({ kind: "credit", funding_account_id: "b", holder_name: "Ada" })
    expect(f.kind).toBe("credit")
    expect(f.funding_account_id).toBe("b")
    expect(f.holder_name).toBe("Ada")
    expect(f.tier).toBe("standard")
    expect(f.autopay).toBe(false)
    expect(f.design_text_auto).toBe(true)
  })

  it("holder name falls back from Clerk to the profile to blank", () => {
    expect(defaultHolderName(" Ada ", "Profile")).toBe("Ada")
    expect(defaultHolderName("", "Profile")).toBe("Profile")
    expect(defaultHolderName(null, undefined)).toBe("")
  })

  it("seeds the edit form from a saved credit card", () => {
    const f = cardWizardFormFromCard(card())
    expect(f.kind).toBe("credit")
    expect(f.account_id).toBe("")
    expect(f.issuer_name).toBe("HDFC Bank")
    expect(f.expiry).toBe("09/27")
    expect(f.tier).toBe("gold")
    expect(f.credit.credit_limit).toBe("2000")
    expect(f.credit.statement_closing_day).toBe("1")
    expect(f.credit.payment_due_day).toBe("15")
    expect(f.funding_account_id).toBe("bank-1")
    expect(f.autopay).toBe(true)
  })

  it("seeds a debit card's bank and keeps a custom design's explicit text", () => {
    const f = cardWizardFormFromCard(card({ kind: "debit", account_id: "bank-9", tier: "custom", design: { from: "#FF0000", to: "#000000", text: "dark", pattern: "dots" }, funding_account_id: null, autopay: false }))
    expect(f.account_id).toBe("bank-9")
    expect(f.design).toEqual({ from: "#FF0000", to: "#000000", text: "dark", pattern: "dots" })
    expect(f.design_text_auto).toBe(false)
  })
})

describe("steps", () => {
  it("debit takes two steps, credit three", () => {
    expect(cardWizardSteps("debit")).toEqual(["card", "look"])
    expect(cardWizardSteps("credit")).toEqual(["card", "look", "credit"])
  })

  it("maps every field to the step it lives on", () => {
    expect(cardWizardStepForField("account_id")).toBe("card")
    expect(cardWizardStepForField("last4")).toBe("card")
    expect(cardWizardStepForField("design")).toBe("look")
    expect(cardWizardStepForField("credit_limit")).toBe("credit")
    expect(cardWizardStepForField("funding_account_id")).toBe("credit")
  })
})

describe("validation", () => {
  it("a debit card needs a bank on create, not on edit", () => {
    expect(validateCardWizardStep(debitForm({ account_id: "" }), "card", "create", TODAY)).toEqual({ code: "bank_required", field: "account_id" })
    expect(validateCardWizardStep(debitForm({ account_id: "" }), "card", "edit", TODAY)).toBeNull()
  })

  it("a credit card needs an issuer", () => {
    expect(validateCardWizardStep(creditForm({ issuer_name: " " }), "card", "create", TODAY)).toEqual({ code: "issuer_required", field: "issuer_name" })
  })

  it("last4 is four digits or blank; expiry must parse when present", () => {
    expect(validateCardWizardStep(debitForm({ last4: "12" }), "card", "create", TODAY)?.code).toBe("last4_invalid")
    expect(validateCardWizardStep(debitForm({ last4: "" }), "card", "create", TODAY)).toBeNull()
    expect(validateCardWizardStep(debitForm({ expiry: "13/27" }), "card", "create", TODAY)?.code).toBe("expiry_invalid")
    expect(validateCardWizardStep(debitForm({ expiry: "" }), "card", "create", TODAY)).toBeNull()
  })

  it("a custom look needs valid colours", () => {
    expect(validateCardWizardStep(debitForm({ tier: "custom", design: { from: "nope", to: "#000000", text: "light", pattern: "none" } }), "look", "create", TODAY)?.code).toBe("design_invalid")
    expect(validateCardWizardStep(debitForm({ tier: "gold" }), "look", "create", TODAY)).toBeNull()
  })

  it("the credit step reuses the onboarding codes and points at the same field", () => {
    const f = creditForm()
    expect(validateCardWizardStep(f, "credit", "create", TODAY)).toBeNull()
    expect(validateCardWizardStep(creditForm({ credit: { ...f.credit, credit_limit: "" } }), "credit", "create", TODAY)).toEqual({ code: "limit_invalid", field: "credit_limit" })
    expect(validateCardWizardStep(creditForm({ credit: { ...f.credit, current_debt: "-5" } }), "credit", "create", TODAY)?.field).toBe("current_debt")
    expect(validateCardWizardStep(creditForm({ credit: { ...f.credit, payment_due_day: "1" } }), "credit", "create", TODAY)).toEqual({ code: "same_day", field: "payment_due_day" })
    expect(validateCardWizardStep(creditForm({ credit: { ...f.credit, know_statement: true, statement_closing_date: "2099-01-01" } }), "credit", "create", TODAY)?.code).toBe("statement_in_future")
  })

  it("editing ignores the onboarding-only fields", () => {
    const f = creditForm({ credit: { ...creditForm().credit, current_debt: "-1", know_statement: true, statement_closing_date: "2099-01-01" } })
    expect(validateCardWizardStep(f, "credit", "edit", TODAY)).toBeNull()
  })

  it("autopay without a paying bank is an error", () => {
    expect(validateCardWizardStep(creditForm({ autopay: true, funding_account_id: "" }), "credit", "create", TODAY)).toEqual({ code: "funding_required", field: "funding_account_id" })
  })

  it("the credit step is a no-op for a debit card, and the whole form validates in step order", () => {
    expect(validateCardWizardStep(debitForm(), "credit", "create", TODAY)).toBeNull()
    expect(validateCardWizard(creditForm({ issuer_name: "", credit: { ...creditForm().credit, credit_limit: "" } }), "create", TODAY)?.code).toBe("issuer_required")
    expect(validateCardWizard(creditForm(), "create", TODAY)).toBeNull()
  })

  it("flags an expiry already in the past as a warning input", () => {
    expect(isExpiryPast("08/26", TODAY)).toBe(true)
    expect(isExpiryPast("09/26", TODAY)).toBe(false)
    expect(isExpiryPast("", TODAY)).toBe(false)
    expect(isExpiryPast("xx", TODAY)).toBe(false)
  })
})

describe("server errors", () => {
  it("parses our JSON error bodies and ignores the rest", () => {
    expect(parseCardApiError(new Error('{"error":"x","code":"same_day","step":"credit"}'))).toEqual({ error: "x", code: "same_day", step: "credit" })
    expect(parseCardApiError(new Error("HTTP 500"))).toBeNull()
    expect(parseCardApiError("nope")).toBeNull()
  })

  it("maps a credit-block code to its field", () => {
    expect(cardWizardFieldForServerError({ error: "Invalid credit card: same_day", code: "same_day", step: "credit" })).toBe("payment_due_day")
    expect(cardWizardFieldForServerError({ error: "…", code: "statement_in_future" })).toBe("statement_closing_date")
  })

  it("maps the identity messages the route writes", () => {
    expect(cardWizardFieldForServerError({ error: "last4 must be exactly four digits" })).toBe("last4")
    expect(cardWizardFieldForServerError({ error: "expiry needs both a month and a year" })).toBe("expiry")
    expect(cardWizardFieldForServerError({ error: "A custom design needs a valid colour" })).toBe("design")
    expect(cardWizardFieldForServerError({ error: "credit_limit must be greater than 0" })).toBe("credit_limit")
    expect(cardWizardFieldForServerError({ error: "Closing day and due day must differ" })).toBe("payment_due_day")
    expect(cardWizardFieldForServerError({ error: "statement_closing_day must be 1..31" })).toBe("statement_closing_day")
    expect(cardWizardFieldForServerError({ error: "The paying account must be an active bank or cash account" })).toBe("funding_account_id")
    expect(cardWizardFieldForServerError({ error: "Choose the bank that issued this card" })).toBe("issuer_name")
    expect(cardWizardFieldForServerError({ error: "A debit card needs a bank account" })).toBe("account_id")
    expect(cardWizardFieldForServerError({ error: "Forbidden" })).toBeNull()
    expect(cardWizardFieldForServerError(null)).toBeNull()
  })
})

describe("payloads", () => {
  it("builds the debit POST body", () => {
    expect(cardCreatePayload(debitForm({ name: " My card ", holder_name: "Ada " }))).toEqual({
      kind: "debit",
      account_id: "bank-1",
      name: "My card",
      holder_name: "Ada",
      network: "mastercard",
      last4: "4321",
      expiry_month: 9,
      expiry_year: 2027,
      tier: "standard",
      design: null,
    })
  })

  it("builds the credit POST body with the issuer, funding bank, opt-in autopay and the credit block", () => {
    const body = cardCreatePayload(creditForm({ autopay: true, expiry: "" }))
    expect(body).toMatchObject({
      kind: "credit",
      issuer: { bank_name: "HDFC Bank", brand_domain: "hdfcbank.com", logo_url: "https://cdn/hdfc.png" },
      funding_account_id: "bank-1",
      autopay: true,
      expiry_month: null,
      expiry_year: null,
      credit: { credit_limit: 2000, current_debt: 150, statement_closing_day: 1, payment_due_day: 15, statement: null },
    })
  })

  it("never sends autopay without a paying bank, and includes a known statement", () => {
    const f = creditForm({ autopay: true, funding_account_id: "", credit: { ...creditForm().credit, know_statement: true, statement_balance: "900", statement_closing_date: "2026-09-01", statement_due_date: "2026-09-15" } })
    const body = cardCreatePayload(f) as { autopay: boolean; funding_account_id?: string; credit: { statement: unknown } }
    expect(body.autopay).toBe(false)
    expect("funding_account_id" in body).toBe(false)
    expect(body.credit.statement).toEqual({ balance: 900, closing_date: "2026-09-01", due_date: "2026-09-15" })
  })

  it("sends a custom design only for the custom tier, with auto text resolved", () => {
    const f = debitForm({ tier: "custom", design: { from: "#ffffff", to: "#dddddd", text: "light", pattern: "waves" }, design_text_auto: true })
    expect(cardCreatePayload(f).design).toEqual({ from: "#FFFFFF", to: "#DDDDDD", text: "dark", pattern: "waves" })
    expect(cardCreatePayload(debitForm({ tier: "gold" })).design).toBeNull()
  })

  it("builds the PATCH body — identity only for debit; credit adds limit/cycle, funding and autopay", () => {
    expect(cardEditPayload(debitForm())).not.toHaveProperty("credit")
    expect(cardEditPayload(debitForm())).not.toHaveProperty("account_id")
    const body = cardEditPayload(creditForm({ autopay: true }))
    expect(body).toMatchObject({
      credit: { credit_limit: 2000, statement_closing_day: 1, payment_due_day: 15 },
      funding_account_id: "bank-1",
      autopay: true,
    })
    expect((body as { credit: Record<string, unknown> }).credit).not.toHaveProperty("current_debt")
    expect(cardEditPayload(creditForm({ funding_account_id: "", autopay: true }))).toMatchObject({ funding_account_id: null, autopay: false })
  })
})

describe("preview", () => {
  it("previews a debit card with the bank's logo, name and domain", () => {
    const p = cardPreviewProps(debitForm({ name: "", holder_name: "" }), bank())
    expect(p).toMatchObject({ kind: "debit", network: "mastercard", tier: "standard", design: null, brand_domain: "federalbank.co.in", bank_logo_src: "data:image/png;base64,abc", bank_name: "Federal Bank", name: null, holder_name: null, last4: "4321", expiry_month: 9, expiry_year: 2027, status: "active" })
  })

  it("previews a credit card from the issuer pick, and keeps a saved card's brand colours when editing", () => {
    const p = cardPreviewProps(creditForm(), null, card())
    expect(p.brand_domain).toBe("hdfcbank.com")
    expect(p.bank_logo_src).toBe("https://cdn/hdfc.png")
    expect(p.brand_colors).toEqual([{ hex: "#0B4A9B", type: "brand" }])
    expect(p.bank_name).toBe("HDFC Bank")
  })

  it("the nickname placeholder is bank + network, or the network alone", () => {
    expect(nicknamePlaceholder(debitForm(), bank())).toBe("Federal Bank Mastercard")
    expect(nicknamePlaceholder(debitForm({ network: "other" }), null)).toBe("Debit card")
    expect(nicknamePlaceholder(creditForm(), null)).toBe("HDFC Bank Visa")
  })

  it("tier swatches: Standard wears the bank colour, gold is gold, custom is the user's", () => {
    expect(tierSwatch("standard", debitForm(), bank()).from).toBe("#0B4A9B")
    expect(tierSwatch("gold", debitForm(), bank()).from).toBe("#D4AF37")
    expect(tierSwatch("custom", debitForm({ design: { from: "#123456", to: "#654321", text: "light", pattern: "none" } }), bank())).toEqual({ from: "#123456", to: "#654321" })
  })

  it("warns only when the user forces a text colour the surface can't carry", () => {
    const base = debitForm({ tier: "custom", design: { from: "#FFFFFF", to: "#EEEEEE", text: "light", pattern: "none" } })
    expect(customTextUnreadable({ ...base, design_text_auto: true })).toBe(false)
    expect(customTextUnreadable({ ...base, design_text_auto: false })).toBe(true)
    expect(customTextUnreadable({ ...base, design_text_auto: false, design: { ...base.design, text: "dark" } })).toBe(false)
    expect(customTextUnreadable({ ...base, tier: "gold", design_text_auto: false })).toBe(false)
  })

  it("effectiveDesign repairs a missing second colour", () => {
    const d = effectiveDesign(debitForm({ tier: "custom", design: { from: "#336699", to: "zzz", text: "light", pattern: "mesh" }, design_text_auto: true }))
    expect(d.from).toBe("#336699")
    expect(d.to).not.toBe("zzz")
    expect(d.text).toBe("light")
    expect(d.pattern).toBe("mesh")
  })
})

describe("inputs", () => {
  it("masks the expiry as it is typed", () => {
    expect(formatExpiryInput("0", "")).toBe("0")
    expect(formatExpiryInput("09", "0")).toBe("09/")
    expect(formatExpiryInput("09/2", "09/")).toBe("09/2")
    expect(formatExpiryInput("09/27", "09/2")).toBe("09/27")
    expect(formatExpiryInput("09/271", "09/27")).toBe("09/27")
    expect(formatExpiryInput("0927", "")).toBe("09/27")
    expect(formatExpiryInput("ab", "")).toBe("")
  })

  it("a lone 2–9 becomes a zero-padded month", () => {
    expect(formatExpiryInput("9", "")).toBe("09/")
    expect(formatExpiryInput("1", "")).toBe("1")
  })

  it("deleting past the slash also drops the month's last digit", () => {
    expect(formatExpiryInput("09", "09/")).toBe("09")
    expect(formatExpiryInput("0", "09")).toBe("0")
    expect(formatExpiryInput("", "0")).toBe("")
  })

  it("last4 keeps only four digits", () => {
    expect(sanitizeLast4("12ab34-5")).toBe("1234")
    expect(sanitizeLast4("")).toBe("")
  })
})

describe("duplicates", () => {
  const cards: Card[] = [
    card({ id: "d1", kind: "debit", account_id: "bank-1", last4: "4321", name: "Federal Mastercard" }),
    card({ id: "d2", kind: "debit", account_id: "bank-2", last4: "4321" }),
    card({ id: "c1", kind: "credit", account_bank_name: "HDFC Bank", last4: "1234" }),
    card({ id: "closed", kind: "debit", account_id: "bank-1", last4: "9999", status: "closed" }),
  ]

  it("finds an open debit card with the same tail on the same bank only", () => {
    expect(duplicateLast4(cards, debitForm())?.id).toBe("d1")
    expect(duplicateLast4(cards, debitForm({ account_id: "bank-3" }))).toBeNull()
    expect(duplicateLast4(cards, debitForm({ last4: "9999" }))).toBeNull()
    expect(duplicateLast4(cards, debitForm({ last4: "43" }))).toBeNull()
  })

  it("matches credit cards by issuer, case-insensitively, and never the card being edited", () => {
    expect(duplicateLast4(cards, creditForm({ issuer_name: "hdfc bank" }))?.id).toBe("c1")
    expect(duplicateLast4(cards, creditForm({ issuer_name: "hdfc bank" }), "c1")).toBeNull()
    expect(duplicateLast4(cards, creditForm({ issuer_name: "ICICI" }))).toBeNull()
  })
})

describe("dirty", () => {
  it("compares against the seeded form", () => {
    const a = debitForm()
    expect(cardWizardDirty(a, { ...a })).toBe(false)
    expect(cardWizardDirty({ ...a, name: "x" }, a)).toBe(true)
  })
})

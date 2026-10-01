import { describe, expect, it } from "vitest"
import { jaroWinkler, normalizeName, resolveAccountName, resolveCategory, resolveClientName, settleStatedCurrency, type AiAccount } from "./ai-match"

const clients = [
  { id: "1", name: "Acme Corp" },
  { id: "2", name: "Acme GmbH" },
  { id: "3", name: "Blue Ocean Studio" },
  { id: "4", name: "Café Müller" },
  { id: "5", name: "ابن سينا للتجارة" },
]

describe("normalizeName", () => {
  it("lowercases, strips diacritics and punctuation, collapses whitespace", () => {
    expect(normalizeName("  Café   Müller & Co.! ")).toBe("cafe muller co")
  })
  it("keeps non-Latin scripts intact", () => {
    expect(normalizeName("ابن سينا")).toBe("ابن سينا")
    expect(normalizeName("അക്മെ")).toBe("അക്മെ")
  })
})

describe("jaroWinkler", () => {
  it("is 1 for identical and 0 for empty", () => {
    expect(jaroWinkler("acme", "acme")).toBe(1)
    expect(jaroWinkler("", "acme")).toBe(0)
  })
  it("scores close strings higher than distant ones", () => {
    expect(jaroWinkler("acme corp", "acme crop")).toBeGreaterThan(jaroWinkler("acme corp", "zebra inc"))
  })
})

describe("resolveClientName", () => {
  it("abstains on null/empty/no-match", () => {
    expect(resolveClientName(null, clients).kind).toBe("none")
    expect(resolveClientName("  ", clients).kind).toBe("none")
    expect(resolveClientName("Completely Unrelated LLC", clients).kind).toBe("none")
  })

  it("exact match wins regardless of case/diacritics", () => {
    const r = resolveClientName("cafe muller", clients)
    expect(r).toEqual({ kind: "match", id: "4" })
  })

  it("prefix query with multiple close hits is ambiguous with candidates", () => {
    const r = resolveClientName("Acme", clients)
    expect(r.kind).toBe("ambiguous")
    if (r.kind === "ambiguous") {
      expect(r.candidates.map((c) => c.id).sort()).toEqual(["1", "2"])
    }
  })

  it("distinctive partial resolves to a single match", () => {
    expect(resolveClientName("Blue Ocean", clients)).toEqual({ kind: "match", id: "3" })
  })

  it("small typo still matches", () => {
    expect(resolveClientName("Blue Ocaen Studio", clients)).toEqual({ kind: "match", id: "3" })
  })

  it("matches non-Latin names", () => {
    expect(resolveClientName("ابن سينا للتجارة", clients)).toEqual({ kind: "match", id: "5" })
  })
})

describe("resolveCategory", () => {
  const cats = ["Food & Dining", "Travel", "Software"]
  it("case-insensitive exact match only", () => {
    expect(resolveCategory("food & dining", cats)).toBe("Food & Dining")
    expect(resolveCategory("Foods", cats)).toBeNull()
    expect(resolveCategory(null, cats)).toBeNull()
  })
})

describe("accounts and the stated currency", () => {
  const accounts: AiAccount[] = [
    { id: "cash", name: "Cash", type: "cash", currency: "EUR" },
    { id: "idfc", name: "IDFC NRO", type: "bank", currency: "INR" },
    { id: "rev-eur", name: "Revolut", type: "bank", currency: "EUR" },
    { id: "rev-usd", name: "Revolut", type: "bank", currency: "USD" },
    { id: "visa", name: "Visa Gold", type: "credit_card", currency: "GBP" },
  ]
  const settle = (p: Partial<Parameters<typeof settleStatedCurrency>[0]>) =>
    settleStatedCurrency({ currency: null, kind: "standard", accountId: null, toAccountId: null, accounts, ...p })

  it("settles a same-name tie by currency, and abstains without one", () => {
    expect(resolveAccountName("Revolut", accounts, "USD")).toBe("rev-usd")
    expect(resolveAccountName("Revolut", accounts, null)).toBeNull()
    expect(resolveAccountName("IDFC NRO", accounts, "USD")).toBe("idfc")
  })

  it("changes nothing when no currency was stated", () => {
    expect(settle({})).toEqual({ accountId: null, pin: false, doubt: false })
  })

  it("puts an unnamed amount in an account holding the stated currency", () => {
    expect(settle({ currency: "INR" })).toEqual({ accountId: "idfc", pin: true, doubt: false })
    expect(settle({ currency: "EUR" })).toEqual({ accountId: "cash", pin: true, doubt: false })
  })

  it("never picks a credit card silently, and doubts a currency no account can take", () => {
    expect(settle({ currency: "GBP" })).toEqual({ accountId: null, pin: false, doubt: true })
    expect(settle({ currency: "JPY" })).toEqual({ accountId: null, pin: false, doubt: true })
  })

  it("doubts a named account in another currency, pins a matching one", () => {
    expect(settle({ currency: "USD", accountId: "idfc" }).doubt).toBe(true)
    // Pinned so the form's fill line never swaps in a EUR default wallet.
    expect(settle({ currency: "INR", accountId: "idfc", named: true })).toEqual({ accountId: "idfc", pin: true, doubt: false })
  })

  it("never substitutes an account when the named one did not resolve", () => {
    const withUsdCash: AiAccount[] = [
      { id: "cash-usd", name: "Cash", type: "cash", currency: "USD" },
      { id: "rev-eur", name: "Revolut", type: "bank", currency: "EUR" },
      { id: "rev-gbp", name: "Revolut", type: "bank", currency: "GBP" },
    ]
    // "paid 20 dollars from Revolut": the tie stays ambiguous (neither is USD).
    const id = resolveAccountName("Revolut", withUsdCash, "USD")
    expect(id).toBeNull()
    expect(settleStatedCurrency({ currency: "USD", kind: "standard", accountId: id, toAccountId: null, accounts: withUsdCash, named: true }))
      .toEqual({ accountId: null, pin: false, doubt: true })
    // Nothing named: the USD wallet is the honest pick.
    expect(settleStatedCurrency({ currency: "USD", kind: "standard", accountId: null, toAccountId: null, accounts: withUsdCash }))
      .toEqual({ accountId: "cash-usd", pin: true, doubt: false })
  })

  it("leaves a single-currency workspace exactly as before", () => {
    const one = accounts.filter((a) => a.currency === "EUR")
    expect(settleStatedCurrency({ currency: "EUR", kind: "standard", accountId: null, toAccountId: null, accounts: one }))
      .toEqual({ accountId: null, pin: false, doubt: false })
    expect(settleStatedCurrency({ currency: "EUR", kind: "standard", accountId: "cash", toAccountId: null, accounts: one, named: true }))
      .toEqual({ accountId: "cash", pin: false, doubt: false })
    expect(settleStatedCurrency({ currency: "EUR", kind: "standard", accountId: null, toAccountId: null, accounts: one, named: true }))
      .toEqual({ accountId: null, pin: false, doubt: false })
  })

  it("lets either side of a transfer carry the amount", () => {
    expect(settle({ kind: "transfer", currency: "GBP", accountId: "idfc", toAccountId: "visa" }).doubt).toBe(false)
    expect(settle({ kind: "transfer", currency: "INR", accountId: "idfc", toAccountId: "visa" }).doubt).toBe(false)
    expect(settle({ kind: "transfer", currency: "USD", accountId: "idfc", toAccountId: "visa" }).doubt).toBe(true)
    expect(settle({ kind: "transfer", currency: "USD", accountId: null, toAccountId: "visa" }).doubt).toBe(false)
    expect(settle({ kind: "transfer", currency: "JPY", accountId: null, toAccountId: null }).doubt).toBe(true)
  })
})

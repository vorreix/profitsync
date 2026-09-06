import { describe, expect, it } from "vitest"
import { relatedBankCards } from "@/components/cards/bank-cards"
import type { Card } from "@/lib/types"

const BANK = "bank-1"
const OTHER = "bank-2"

function card(over: Partial<Card>): Card {
  return {
    id: "c",
    organization_id: "org",
    kind: "credit",
    account_id: "liab",
    funding_account_id: null,
    issuer_account_id: null,
    name: "",
    holder_name: "",
    network: "visa",
    last4: "1234",
    expiry_month: 9,
    expiry_year: 2030,
    tier: "standard",
    design: null,
    brand_colors: null,
    brand_logo_url: "",
    autopay: false,
    autopay_since: null,
    status: "active",
    position: 0,
    created_at: "",
    updated_at: "",
    ...over,
  } as Card
}

describe("relatedBankCards", () => {
  it("keeps a debit card ON the account apart from a credit card the account PAYS", () => {
    // The bug this function exists for: a bank page used to list both in one
    // flat grid, claiming a card whose debt is not in its balance at all.
    const debit = card({ id: "d", kind: "debit", account_id: BANK })
    const paid = card({ id: "p", funding_account_id: BANK })
    const g = relatedBankCards([debit, paid], BANK)
    expect(g.on.map((c) => c.id)).toEqual(["d"])
    expect(g.pays.map((c) => c.id)).toEqual(["p"])
    expect(g.issued).toEqual([])
  })

  it("lists a card this bank ISSUED but does not pay", () => {
    const elsewhere = card({ id: "i", issuer_account_id: BANK, funding_account_id: OTHER })
    const g = relatedBankCards([elsewhere], BANK)
    expect(g.issued.map((c) => c.id)).toEqual(["i"])
    expect(g.pays).toEqual([])
  })

  it("lists a card only once when the same bank issued AND pays it", () => {
    // The common case. Paying is the relationship that moves money, so it wins.
    const both = card({ id: "b", issuer_account_id: BANK, funding_account_id: BANK })
    const g = relatedBankCards([both], BANK)
    expect(g.pays.map((c) => c.id)).toEqual(["b"])
    expect(g.issued).toEqual([])
  })

  it("shows nothing on a bank that merely shares a name with the card's branding", () => {
    // Branding is a string; only a recorded account puts a card on a bank page.
    const branded = card({ id: "x", account_bank_name: "Intesa Sanpaolo", funding_account_id: OTHER })
    const g = relatedBankCards([branded], BANK)
    expect([...g.on, ...g.pays, ...g.issued]).toEqual([])
  })

  it("sorts closed cards last in every group", () => {
    const open = card({ id: "open", funding_account_id: BANK })
    const closed = card({ id: "closed", funding_account_id: BANK, status: "closed" })
    expect(relatedBankCards([closed, open], BANK).pays.map((c) => c.id)).toEqual(["open", "closed"])
  })
})

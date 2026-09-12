import { describe, expect, it } from "vitest"
import { cardDropAction, moveBefore } from "@/components/cards/card-drag"
import type { Card } from "@/lib/types"

function card(over: Partial<Card>): Card {
  return {
    id: "c",
    organization_id: "org",
    kind: "debit",
    account_id: "bank-1",
    funding_account_id: null,
    issuer_account_id: null,
    funding_card_id: null,
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

const all = (...ids: string[]) => new Set(ids)

describe("moveBefore", () => {
  it("moves an item forward and backward", () => {
    expect(moveBefore(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"])
    expect(moveBefore(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
  })

  it("is a no-op when the item lands where it already is", () => {
    expect(moveBefore(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"])
    expect(moveBefore(["a", "b", "c"], 1, 2)).toEqual(["a", "b", "c"])
  })
})

describe("cardDropAction", () => {
  const debit = card({ id: "d1", kind: "debit", account_id: "bank-1" })
  const otherDebit = card({ id: "d2", kind: "debit", account_id: "bank-2" })
  const credit = card({ id: "c1", kind: "credit", account_id: "liab-1" })

  it("pays the card you drop onto when it is a credit card", () => {
    expect(cardDropAction(debit, credit, all("d1"))).toEqual({ kind: "pay" })
  })

  it("transfers when the target is a debit card on another bank", () => {
    expect(cardDropAction(debit, otherDebit, all("d1"))).toEqual({ kind: "transfer" })
  })

  it("refuses two debit cards that share one bank", () => {
    // The schema allows it — only cards_credit_account_unique is 1:1 — and the
    // transfer would be bank-to-itself, which createTransfer rejects. Offering
    // it opens a dialog whose confirm can never enable.
    const sibling = card({ id: "d3", kind: "debit", account_id: "bank-1" })
    expect(cardDropAction(debit, sibling, all("d1", "d3"))).toBeNull()
  })

  it("refuses a card dropped on itself", () => {
    expect(cardDropAction(debit, debit, all("d1"))).toBeNull()
  })

  it("refuses a source the transfer route would reject", () => {
    // Frozen, or on an archived account: resolveCardForLeg runs without
    // allowFrozen, so this would fail only after the user typed an amount.
    expect(cardDropAction(debit, credit, all())).toBeNull()
  })

  it("still lets you pay a card that is frozen", () => {
    const frozen = card({ id: "c2", kind: "credit", account_id: "liab-2", status: "frozen" })
    expect(cardDropAction(debit, frozen, all("d1"))).toEqual({ kind: "pay" })
  })

  it("refuses a destination whose account is archived", () => {
    const gone = card({ id: "c3", kind: "credit", account_id: "liab-3", account_archived_at: "2026-01-01" })
    expect(cardDropAction(debit, gone, all("d1"))).toBeNull()
  })

  it("allows a credit card as the source — a balance transfer or a cash advance", () => {
    expect(cardDropAction(credit, otherDebit, all("c1"))).toEqual({ kind: "transfer" })
    const otherCredit = card({ id: "c4", kind: "credit", account_id: "liab-4" })
    expect(cardDropAction(credit, otherCredit, all("c1"))).toEqual({ kind: "pay" })
  })
})

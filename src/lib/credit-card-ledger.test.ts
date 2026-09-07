import { describe, expect, it } from "vitest"

import { applicationsByAccount, balanceDelta, reversalsByAccount, reverseDelta } from "./wealth-ledger"
import { availableCredit, cardCredit, cardDebt, isLiabilityType, signedBalanceFromDebt } from "./credit-card"
import { budgetSpend, pnlTotals, type ClassifiableLeg } from "./tx-classify"

// End-to-end ACCOUNTING scenarios for credit cards, run against an in-memory
// ledger that applies exactly the helpers the API routes use:
//   • create      → balance += balanceDelta(type, amount)   (transactions.ts / group.ts / transfer.ts)
//   • edit        → balance −= old delta, += new delta         (transactions/[id].ts PATCH)
//   • trash       → balance += reversalsByAccount(legs)        (DELETE / bulk-delete)
//   • restore     → balance += applicationsByAccount(legs)     (trash/restore.ts)
//   • purge       → no balance change                          (trash/purge.ts)
//   • reporting   → pnlTotals / budgetSpend over live legs     (tx-sql.ts twins)
// The routes are thin wrappers over these functions; if a scenario here holds,
// the money math behind the endpoints holds. (Route plumbing is covered by the
// throwaway DB script described in docs/credit-cards/CREDIT_CARDS.md.)

type Leg = ClassifiableLeg & { id: string; accountId: string; deleted: boolean }

class Ledger {
  balances = new Map<string, number>()
  types = new Map<string, string>()
  legs: Leg[] = []
  private seq = 0

  addAccount(id: string, type: string, opening = 0) {
    this.types.set(id, type)
    // Mirrors POST /api/wealth/accounts: the balance is set to the opening value
    // AND a system row explains it (outgoing for an opening DEBT).
    this.balances.set(id, opening)
    if (opening !== 0) {
      this.legs.push({
        id: `sys-${++this.seq}`, accountId: id, type: opening > 0 ? "incoming" : "outgoing",
        kind: "standard", amount: Math.abs(opening), isSystem: true, deleted: false,
      })
    }
  }

  post(accountId: string, type: string, amount: number, kind = "standard"): Leg {
    const leg: Leg = { id: `tx-${++this.seq}`, accountId, type, kind, amount, isSystem: false, deleted: false }
    this.legs.push(leg)
    this.bump(accountId, balanceDelta(type, amount))
    return leg
  }

  /** Two legs sharing a group, like POST /api/wealth/transfer. */
  transfer(from: string, to: string, amount: number): [Leg, Leg] {
    return [this.post(from, "outgoing", amount, "transfer"), this.post(to, "incoming", amount, "transfer")]
  }

  edit(leg: Leg, patch: { amount?: number; type?: string }) {
    // PATCH: reverse the old effect, apply the new one.
    this.bump(leg.accountId, reverseDelta(leg.type, leg.amount))
    if (patch.amount !== undefined) leg.amount = patch.amount
    if (patch.type !== undefined) leg.type = patch.type
    this.bump(leg.accountId, balanceDelta(leg.type, leg.amount))
  }

  trash(...legs: Leg[]) {
    for (const [acct, shift] of reversalsByAccount(legs.map((l) => ({ wealthAccountId: l.accountId, ...l })))) this.bump(acct, shift)
    for (const l of legs) l.deleted = true
  }

  restore(...legs: Leg[]) {
    for (const [acct, shift] of applicationsByAccount(legs.map((l) => ({ wealthAccountId: l.accountId, ...l })))) this.bump(acct, shift)
    for (const l of legs) l.deleted = false
  }

  purge(...legs: Leg[]) {
    // Already reversed at trash time — purging touches no balance.
    this.legs = this.legs.filter((l) => !legs.includes(l))
  }

  balance(id: string) { return Math.round(this.balances.get(id)! * 100) / 100 }
  live() { return this.legs.filter((l) => !l.deleted) }
  pnl() { return pnlTotals(this.live()) }
  budget() { return budgetSpend(this.live()) }
  netWorth() {
    let total = 0
    for (const [, b] of this.balances) total += b
    return Math.round(total * 100) / 100
  }
  assets() {
    let total = 0
    for (const [id, b] of this.balances) if (!isLiabilityType(this.types.get(id))) total += b
    return total
  }
  liabilities() {
    let total = 0
    for (const [id, b] of this.balances) if (isLiabilityType(this.types.get(id))) total += cardDebt(b)
    return total
  }

  private bump(id: string, delta: number) {
    this.balances.set(id, (this.balances.get(id) ?? 0) + delta)
  }
}

const LIMIT = 2000

function fresh() {
  const l = new Ledger()
  l.addAccount("intesa", "bank", 4000)
  l.addAccount("cash", "cash", 300)
  l.addAccount("visa", "credit_card", 0)
  return l
}

describe("credit-card ledger scenarios", () => {
  it("purchase: card starts €0, buy €100 → debt 100, available = limit − 100, expense +100, net worth −100", () => {
    const l = fresh()
    const before = l.netWorth()
    l.post("visa", "outgoing", 100)
    expect(cardDebt(l.balance("visa"))).toBe(100)
    expect(availableCredit(LIMIT, l.balance("visa"))).toBe(1900)
    expect(l.pnl().expense).toBe(100)
    expect(l.pnl().income).toBe(0)
    expect(l.netWorth()).toBe(before - 100)
    // Bank cash did not move yet.
    expect(l.balance("intesa")).toBe(4000)
  })

  it("card payment: debt €800, transfer €500 bank → card → bank −500, debt 300, expense unchanged, net worth unchanged", () => {
    const l = fresh()
    l.post("visa", "outgoing", 800)
    const expenseBefore = l.pnl().expense
    const nwBefore = l.netWorth()
    l.transfer("intesa", "visa", 500)
    expect(l.balance("intesa")).toBe(3500)
    expect(cardDebt(l.balance("visa"))).toBe(300)
    expect(l.pnl().expense).toBe(expenseBefore)
    expect(l.pnl().income).toBe(0)
    expect(l.netWorth()).toBe(nwBefore)
  })

  it("refund: purchase €100 then refund €100 → debt back to 0, expense reversed, no income", () => {
    const l = fresh()
    l.post("visa", "outgoing", 100)
    l.post("visa", "incoming", 100, "refund")
    expect(cardDebt(l.balance("visa"))).toBe(0)
    expect(availableCredit(LIMIT, l.balance("visa"))).toBe(LIMIT)
    expect(l.pnl()).toEqual({ income: 0, expense: 0, net: 0 })
  })

  it("fee: €10 card fee → debt +10 and expense +10", () => {
    const l = fresh()
    l.post("visa", "outgoing", 10)
    expect(cardDebt(l.balance("visa"))).toBe(10)
    expect(l.pnl().expense).toBe(10)
  })

  it("overpayment: debt €100, pay €150 → €50 card credit, no expense created", () => {
    const l = fresh()
    l.post("visa", "outgoing", 100)
    l.transfer("intesa", "visa", 150)
    expect(cardDebt(l.balance("visa"))).toBe(0)
    expect(cardCredit(l.balance("visa"))).toBe(50)
    expect(l.pnl().expense).toBe(100) // still just the purchase
    expect(availableCredit(LIMIT, l.balance("visa"))).toBe(LIMIT + 50)
  })

  it("delete a card purchase reverses exactly it; restore re-applies it exactly once; purge changes nothing", () => {
    const l = fresh()
    const purchase = l.post("visa", "outgoing", 100)
    l.post("visa", "outgoing", 40) // an unrelated purchase stays
    l.trash(purchase)
    expect(cardDebt(l.balance("visa"))).toBe(40)
    expect(l.pnl().expense).toBe(40)
    l.restore(purchase)
    expect(cardDebt(l.balance("visa"))).toBe(140)
    expect(l.pnl().expense).toBe(140)
    // Trash again, then purge — the balance was reversed at trash time only.
    l.trash(purchase)
    l.purge(purchase)
    expect(cardDebt(l.balance("visa"))).toBe(40)
    expect(l.balance("intesa")).toBe(4000) // never touched
    expect(l.balance("cash")).toBe(300)
  })

  it("delete a card payment reverses both legs; restore re-applies once; no unrelated account moves", () => {
    const l = fresh()
    l.post("visa", "outgoing", 800)
    const [out, inn] = l.transfer("intesa", "visa", 500)
    l.trash(out, inn)
    expect(l.balance("intesa")).toBe(4000)
    expect(cardDebt(l.balance("visa"))).toBe(800)
    expect(l.balance("cash")).toBe(300)
    l.restore(out, inn)
    expect(l.balance("intesa")).toBe(3500)
    expect(cardDebt(l.balance("visa"))).toBe(300)
    expect(l.balance("cash")).toBe(300)
    expect(l.pnl().expense).toBe(800)
  })

  it("edit a card expense €100 → €70 updates debt, available credit and expense by exactly €30", () => {
    const l = fresh()
    const p = l.post("visa", "outgoing", 100)
    l.edit(p, { amount: 70 })
    expect(cardDebt(l.balance("visa"))).toBe(70)
    expect(availableCredit(LIMIT, l.balance("visa"))).toBe(1930)
    expect(l.pnl().expense).toBe(70)
    expect(l.budget()).toBe(70)
  })

  it("budgets: a card purchase counts once, the card payment counts zero", () => {
    const l = fresh()
    l.post("visa", "outgoing", 75) // groceries on Visa
    expect(l.budget()).toBe(75)
    l.transfer("intesa", "visa", 75) // pay the card
    expect(l.budget()).toBe(75)
    expect(l.pnl().expense).toBe(75)
  })

  it("net worth: card debt reduces it; available credit does not increase it; a payment does not change it", () => {
    const l = fresh()
    expect(l.netWorth()).toBe(4300)
    l.post("visa", "outgoing", 1200)
    expect(l.assets()).toBe(4300)
    expect(l.liabilities()).toBe(1200)
    expect(l.netWorth()).toBe(3100)
    // Available credit (800) never enters the sum.
    expect(l.netWorth()).not.toBe(3100 + availableCredit(LIMIT, l.balance("visa"))!)
    l.transfer("intesa", "visa", 1200)
    expect(l.netWorth()).toBe(3100)
    expect(l.liabilities()).toBe(0)
  })

  it("onboarding an existing card: opening debt is a system row — not an expense, not budget spend", () => {
    const l = fresh()
    l.addAccount("amex", "credit_card", signedBalanceFromDebt(950))
    expect(cardDebt(l.balance("amex"))).toBe(950)
    expect(l.pnl().expense).toBe(0)
    expect(l.budget()).toBe(0)
    expect(l.netWorth()).toBe(4300 - 950)
    // Deleting the Opening Balance system row must NOT move money (existing
    // reset/azzeramento rule — reversesOnTrash).
    const opening = l.legs.find((x) => x.accountId === "amex" && x.isSystem)!
    l.trash(opening)
    expect(cardDebt(l.balance("amex"))).toBe(950)
  })

  it("mixed month: no transaction ever moves value between unrelated accounts", () => {
    const l = fresh()
    l.post("visa", "outgoing", 72)
    l.post("visa", "outgoing", 48)
    l.post("cash", "outgoing", 15)
    const [out, inn] = l.transfer("intesa", "visa", 100)
    l.post("visa", "incoming", 20, "refund")
    l.trash(out, inn)
    l.restore(out, inn)
    expect(l.balance("intesa")).toBe(3900)
    expect(l.balance("cash")).toBe(285)
    expect(cardDebt(l.balance("visa"))).toBe(0) // 72+48−100−20
    expect(l.pnl().expense).toBe(72 + 48 + 15 - 20)
    expect(l.pnl().income).toBe(0)
  })
})

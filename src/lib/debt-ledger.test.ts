import { describe, expect, it } from "vitest"
import { applicationsByAccount, balanceDelta, reversalsByAccount } from "./wealth-ledger"
import { pnlTotals, type ClassifiableLeg } from "./tx-classify"
import { fromCents, splitPayment, toCents } from "./debt-math"

// The ACCOUNTING of Debt & Loans, run against an in-memory ledger that applies
// exactly the helpers the routes use (api/_lib/debts.ts recordDebtPayment →
// balanceDelta per leg; DELETE → reversalsByAccount; restore → applicationsByAccount;
// reporting → pnlTotals). If these hold, the money behind the endpoints holds.

type Leg = ClassifiableLeg & { id: string; accountId: string; deleted: boolean }

class Ledger {
  balances = new Map<string, number>()
  legs: Leg[] = []
  private seq = 0
  add(id: string, opening = 0) { this.balances.set(id, opening); if (opening !== 0) this.legs.push({ id: `sys${++this.seq}`, accountId: id, type: opening > 0 ? "incoming" : "outgoing", kind: "standard", amount: Math.abs(opening), isSystem: true, deleted: false }) }
  post(accountId: string, type: string, amount: number, kind = "standard"): Leg {
    const leg: Leg = { id: `t${++this.seq}`, accountId, type, kind, amount, isSystem: false, deleted: false }
    this.legs.push(leg)
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0) + balanceDelta(type, amount))
    return leg
  }
  /** recordDebtPayment for an "I owe" debt: principal transfer + interest/fee expenses on the paying account. */
  payDebt(from: string, debt: string, principal: number, interest = 0, fees = 0): Leg[] {
    const legs: Leg[] = []
    if (principal > 0) { legs.push(this.post(from, "outgoing", principal, "transfer")); legs.push(this.post(debt, "incoming", principal, "transfer")) }
    if (interest > 0) legs.push(this.post(from, "outgoing", interest))
    if (fees > 0) legs.push(this.post(from, "outgoing", fees))
    return legs
  }
  /** Borrowing: a TRANSFER debt → bank. */
  borrow(debt: string, into: string, amount: number) { this.post(debt, "outgoing", amount, "transfer"); this.post(into, "incoming", amount, "transfer") }
  trash(legs: Leg[]) { for (const [a, s] of reversalsByAccount(legs.map((l) => ({ wealthAccountId: l.accountId, ...l })))) this.balances.set(a, this.balances.get(a)! + s); legs.forEach((l) => (l.deleted = true)) }
  restore(legs: Leg[]) { for (const [a, s] of applicationsByAccount(legs.map((l) => ({ wealthAccountId: l.accountId, ...l })))) this.balances.set(a, this.balances.get(a)! + s); legs.forEach((l) => (l.deleted = false)) }
  bal(id: string) { return Math.round(this.balances.get(id)! * 100) / 100 }
  owed(id: string) { return Math.max(0, -this.bal(id)) }
  pnl() { return pnlTotals(this.legs.filter((l) => !l.deleted)) }
  netWorth() { let s = 0; for (const v of this.balances.values()) s += v; return Math.round(s * 100) / 100 }
}

describe("debt ledger — borrowing and repaying", () => {
  it("borrowing €5,000: bank +5,000, debt +5,000, income unchanged, net worth unchanged", () => {
    const l = new Ledger(); l.add("bank", 1000); l.add("loan", 0)
    const before = l.pnl().income; const nw = l.netWorth()
    l.borrow("loan", "bank", 5000)
    expect(l.bal("bank")).toBe(6000)
    expect(l.owed("loan")).toBe(5000)
    expect(l.pnl().income).toBe(before)
    expect(l.netWorth()).toBe(nw)
  })

  it("a €500 payment = €420 principal + €70 interest + €10 fees: bank −500, debt −420, expense 80", () => {
    const l = new Ledger(); l.add("bank", 2000); l.add("loan", -5000)
    l.payDebt("bank", "loan", 420, 70, 10)
    expect(l.bal("bank")).toBe(1500)
    expect(l.owed("loan")).toBe(4580)
    expect(l.pnl().expense).toBe(80) // only interest + fees are spending
    expect(l.pnl().income).toBe(0)
    // Net worth falls by exactly the interest + fees (principal just moved between asset and liability).
    expect(l.netWorth()).toBe(-3000 - 80)
  })

  it("an informal interest-free debt: the whole payment is principal, no fake interest", () => {
    const s = splitPayment({ total: toCents(200), balance: toCents(700), annualRatePct: null, frequency: null })
    expect(s).toEqual({ principal: 20_000, interest: 0, source: "principal_only" })
    const l = new Ledger(); l.add("cash", 300); l.add("marco", -700)
    l.payDebt("cash", "marco", fromCents(s.principal), fromCents(s.interest))
    expect(l.owed("marco")).toBe(500)
    expect(l.pnl().expense).toBe(0)
  })

  it("deleting a payment reverses bank, principal, interest and fees together; restoring re-applies once", () => {
    const l = new Ledger(); l.add("bank", 2000); l.add("loan", -5000)
    const legs = l.payDebt("bank", "loan", 420, 70, 10)
    l.trash(legs)
    expect(l.bal("bank")).toBe(2000)
    expect(l.owed("loan")).toBe(5000)
    expect(l.pnl().expense).toBe(0)
    l.restore(legs)
    expect(l.bal("bank")).toBe(1500)
    expect(l.owed("loan")).toBe(4580)
    expect(l.pnl().expense).toBe(80)
  })

  it("paying a credit card and a loan in the same month never double counts", () => {
    const l = new Ledger(); l.add("bank", 5000); l.add("visa", 0); l.add("loan", -3000)
    l.post("visa", "outgoing", 100) // purchase → the only expense
    l.post("bank", "outgoing", 100, "transfer"); l.post("visa", "incoming", 100, "transfer") // card payment
    l.payDebt("bank", "loan", 300, 25) // loan payment
    expect(l.pnl().expense).toBe(125) // purchase + interest
    expect(l.owed("visa")).toBe(0)
    expect(l.owed("loan")).toBe(2700)
    expect(l.bal("bank")).toBe(4575)
  })

  it("receivable (owed to me): lending is a transfer, repayment comes back as a transfer, interest received is income", () => {
    const l = new Ledger(); l.add("cash", 1000); l.add("luca", 0)
    l.post("cash", "outgoing", 400, "transfer"); l.post("luca", "incoming", 400, "transfer") // lent €400
    expect(l.bal("cash")).toBe(600); expect(l.bal("luca")).toBe(400)
    expect(l.pnl().expense).toBe(0)
    l.post("luca", "outgoing", 100, "transfer"); l.post("cash", "incoming", 100, "transfer") // €100 back
    l.post("cash", "incoming", 5) // €5 interest received → income
    expect(l.bal("luca")).toBe(300); expect(l.bal("cash")).toBe(705)
    expect(l.pnl().income).toBe(5)
    expect(l.netWorth()).toBe(1005)
  })

  it("multi-currency: native amounts are never touched by a display currency", () => {
    // Each debt keeps its own currency; sums are per currency (debt-status.owedByCurrency), never converted.
    const eur = new Ledger(); eur.add("mortgage", -12_000)
    const inr = new Ledger(); inr.add("family", -900_000)
    expect(eur.owed("mortgage")).toBe(12_000)
    expect(inr.owed("family")).toBe(900_000)
  })
})

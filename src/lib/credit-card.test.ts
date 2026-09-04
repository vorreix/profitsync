import { describe, expect, it } from "vitest"

import {
  availableCredit,
  belongsToStatement,
  cardCredit,
  cardDebt,
  closingsDue,
  creditUsage,
  cycleActivity,
  dayInMonth,
  debtAtClose,
  dueDateFor,
  isLiabilityType,
  lastClosingOnOrBefore,
  nextClosingAfter,
  nextClosingOnOrAfter,
  openCycle,
  signedBalanceFromDebt,
  statementPaid,
  statementRemaining,
  statementView,
  suggestFeeCategory,
  validateCardOnboarding,
} from "./credit-card"

describe("credit-card — sign convention & headline figures", () => {
  it("a negative stored balance is debt; a positive one is card credit", () => {
    expect(cardDebt(-950)).toBe(950)
    expect(cardDebt("-950.00")).toBe(950)
    expect(cardDebt(0)).toBe(0)
    expect(cardDebt(50)).toBe(0) // overpaid: no debt
    expect(cardCredit(50)).toBe(50)
    expect(cardCredit(-950)).toBe(0)
  })

  it("signedBalanceFromDebt is the inverse of cardDebt", () => {
    for (const debt of [0, 1, 99.99, 950, 12345.67]) {
      expect(cardDebt(signedBalanceFromDebt(debt))).toBe(debt)
    }
    expect(signedBalanceFromDebt(950)).toBe(-950)
  })

  it("available credit = limit − debt; never negative; limit + credit when overpaid", () => {
    expect(availableCredit(2000, -950)).toBe(1050)
    expect(availableCredit(2000, 0)).toBe(2000)
    expect(availableCredit(2000, -2500)).toBe(0) // over limit
    expect(availableCredit(2000, 50)).toBe(2050) // card credit
    expect(availableCredit(null, -100)).toBeNull()
    expect(availableCredit(0, -100)).toBeNull()
  })

  it("creditUsage bundles the figures and flags over-limit", () => {
    expect(creditUsage(2000, -950)).toEqual({
      debt: 950, credit: 0, limit: 2000, available: 1050, utilization: 0.48, overLimit: false,
    })
    expect(creditUsage(2000, -2100).overLimit).toBe(true)
    expect(creditUsage(2000, -2100).available).toBe(0)
    expect(creditUsage(2000, -2100).utilization).toBe(1)
    expect(creditUsage(null, -100).available).toBeNull()
  })

  it("available credit is NOT an asset: only the signed balance enters net worth", () => {
    // Net worth = Σ signed balances. The card's balance (−950) reduces it; the
    // €1,050 available never appears in the sum.
    const balances = [4000, 300, 2000, -950]
    const netWorth = balances.reduce((a, b) => a + b, 0)
    expect(netWorth).toBe(5350)
    expect(netWorth).not.toBe(5350 + 1050)
  })

  it("only credit_card is a liability type", () => {
    expect(isLiabilityType("credit_card")).toBe(true)
    for (const t of ["bank", "cash", "space", "", null, undefined]) expect(isLiabilityType(t)).toBe(false)
  })
})

describe("credit-card — closing / due date math", () => {
  it("clamps the configured day to the month: 31 → Feb 28, Feb 29 in leap years, Apr 30", () => {
    expect(dayInMonth(2026, 2, 31)).toBe("2026-02-28")
    expect(dayInMonth(2028, 2, 31)).toBe("2028-02-29") // leap year
    expect(dayInMonth(2028, 2, 29)).toBe("2028-02-29")
    expect(dayInMonth(2026, 2, 29)).toBe("2026-02-28")
    expect(dayInMonth(2026, 2, 30)).toBe("2026-02-28")
    expect(dayInMonth(2026, 4, 31)).toBe("2026-04-30")
    expect(dayInMonth(2026, 1, 31)).toBe("2026-01-31")
    expect(dayInMonth(2100, 2, 29)).toBe("2100-02-28") // 2100 is NOT a leap year
    expect(dayInMonth(2000, 2, 29)).toBe("2000-02-29") // 2000 is
  })

  it("month-end closing never drifts: 31st stays anchored across Feb → Mar", () => {
    expect(nextClosingAfter("2026-01-31", 31)).toBe("2026-02-28")
    expect(nextClosingAfter("2026-02-28", 31)).toBe("2026-03-31") // NOT 03-28
    expect(nextClosingAfter("2026-03-31", 31)).toBe("2026-04-30")
  })

  it("lastClosingOnOrBefore / nextClosingAfter / nextClosingOnOrAfter around the closing day", () => {
    expect(lastClosingOnOrBefore("2026-09-04", 1)).toBe("2026-09-01")
    expect(lastClosingOnOrBefore("2026-09-01", 1)).toBe("2026-09-01") // on the day: that close counts
    expect(lastClosingOnOrBefore("2026-08-31", 1)).toBe("2026-08-01")
    expect(nextClosingAfter("2026-09-04", 1)).toBe("2026-10-01")
    expect(nextClosingAfter("2026-09-01", 1)).toBe("2026-10-01") // strictly after
    expect(nextClosingOnOrAfter("2026-09-01", 1)).toBe("2026-09-01") // closes today
    expect(nextClosingOnOrAfter("2026-09-02", 1)).toBe("2026-10-01")
  })

  it("year boundary: December → January", () => {
    expect(nextClosingAfter("2026-12-15", 1)).toBe("2027-01-01")
    expect(nextClosingAfter("2026-12-31", 31)).toBe("2027-01-31")
    expect(lastClosingOnOrBefore("2027-01-05", 20)).toBe("2026-12-20")
    expect(dueDateFor("2026-12-25", 10)).toBe("2027-01-10")
  })

  it("due date is the first matching day STRICTLY after the close", () => {
    expect(dueDateFor("2026-09-01", 15)).toBe("2026-09-15")
    expect(dueDateFor("2026-09-25", 10)).toBe("2026-10-10")
    // Closing day 31 lands on Sep 30; due day 30 must not collide with the close.
    expect(dueDateFor("2026-09-30", 30)).toBe("2026-10-30")
    // Due day 31 in a short month clamps.
    expect(dueDateFor("2026-01-20", 31)).toBe("2026-01-31")
    expect(dueDateFor("2026-02-10", 31)).toBe("2026-02-28")
  })

  it("openCycle: the cycle containing today (on the closing day it still closes today)", () => {
    expect(openCycle("2026-09-04", 1)).toEqual({ start: "2026-09-02", closesOn: "2026-10-01" })
    expect(openCycle("2026-09-01", 1)).toEqual({ start: "2026-08-02", closesOn: "2026-09-01" })
    expect(openCycle("2026-09-02", 1)).toEqual({ start: "2026-09-02", closesOn: "2026-10-01" })
    // 31st closing across Feb: cycle Mar 1 → Mar 31 after the Feb 28 close.
    expect(openCycle("2026-03-15", 31)).toEqual({ start: "2026-03-01", closesOn: "2026-03-31" })
    expect(openCycle("2026-02-10", 31)).toEqual({ start: "2026-02-01", closesOn: "2026-02-28" })
  })

  it("statement / new-cycle boundary: on the closing date → statement; the day after → new cycle", () => {
    expect(belongsToStatement("2026-09-01", "2026-09-01")).toBe(true)
    expect(belongsToStatement("2026-08-31", "2026-09-01")).toBe(true)
    expect(belongsToStatement("2026-09-02", "2026-09-01")).toBe(false)
  })

  it("closingsDue files every close strictly after the anchor and strictly before today, capped", () => {
    // Card added Jun 10, closing day 1, today Sep 4 → Jul 1, Aug 1, Sep 1 (Oct 1 is future).
    expect(closingsDue("2026-06-10", 1, "2026-09-04")).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"])
    // On the closing day itself nothing is filed yet (the cycle is still open).
    expect(closingsDue("2026-08-01", 1, "2026-09-01")).toEqual([])
    expect(closingsDue("2026-08-01", 1, "2026-09-02")).toEqual(["2026-09-01"])
    // Anchor ON a closing date: that one is already filed.
    expect(closingsDue("2026-09-01", 1, "2026-09-04")).toEqual([])
    expect(closingsDue("2020-01-01", 1, "2026-09-04", 3)).toHaveLength(3)
    // 31st across a leap Feb.
    expect(closingsDue("2028-01-31", 31, "2028-04-05")).toEqual(["2028-02-29", "2028-03-31"])
  })
})

describe("credit-card — statement snapshot", () => {
  it("debtAtClose reconstructs the amount owed at the close from the stored balance", () => {
    // Today the card shows −950. Since the close: purchases 150 (−150) → at close the balance was −800.
    expect(debtAtClose(-950, -150)).toBe(800)
    // Since the close: purchases 150 and a payment 500 (+500) → movement +350 → at close −1300.
    expect(debtAtClose(-950, 350)).toBe(1300)
    // Nothing since the close.
    expect(debtAtClose(-800, 0)).toBe(800)
    // Card was in credit at close.
    expect(debtAtClose(50, 0)).toBe(-50)
  })
})

describe("credit-card — statement payments (FIFO, derived, deterministic)", () => {
  const today = "2026-09-04"
  const dueDate = "2026-09-15"

  it("full statement payment: statement paid, new-cycle spending untouched, debt = new cycle", () => {
    // Statement €800; new-cycle purchases €150 → current debt €950. Pay €800.
    const v = statementView({ statementBalance: 800, paymentsSinceClose: 800, dueDate, today })
    expect(v.remaining).toBe(0)
    expect(v.paid).toBe(800)
    expect(v.status).toBe("paid")
    const debtAfter = cardDebt(-950 + 800)
    expect(debtAfter).toBe(150)
    // The purchases metric is a separate sum and is not "un-spent" by the payment.
    expect(cycleActivity([{ type: "outgoing", kind: "standard", amount: 150 }, { type: "incoming", kind: "transfer", amount: 800 }]))
      .toEqual({ spent: 150, refunds: 0, payments: 800 })
  })

  it("partial payment: paid / remaining / PARTIAL", () => {
    const v = statementView({ statementBalance: 800, paymentsSinceClose: 300, dueDate, today })
    expect(v).toMatchObject({ paid: 300, remaining: 500, status: "partial" })
  })

  it("multiple partial payments accumulate to PAID", () => {
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 300 + 200, dueDate, today }))
      .toMatchObject({ paid: 500, remaining: 300, status: "partial" })
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 300 + 200 + 300, dueDate, today }))
      .toMatchObject({ paid: 800, remaining: 0, status: "paid" })
  })

  it("payment exceeding the statement: statement PAID, excess reduces overall debt, purchases metric unchanged", () => {
    // Statement €800, new cycle €150 (debt €950). Pay €900.
    const v = statementView({ statementBalance: 800, paymentsSinceClose: 900, dueDate, today })
    expect(v).toMatchObject({ paid: 800, remaining: 0, status: "paid" })
    expect(cardDebt(-950 + 900)).toBe(50)
    expect(cycleActivity([{ type: "outgoing", kind: "standard", amount: 150 }]).spent).toBe(150)
  })

  it("overpayment: debt €100, pay €150 → €50 card credit, no debt, statement paid", () => {
    const balance = -100 + 150
    expect(cardDebt(balance)).toBe(0)
    expect(cardCredit(balance)).toBe(50)
    expect(statementRemaining(100, 150)).toBe(0)
    expect(statementPaid(100, 150)).toBe(100) // never reports more paid than was owed
  })

  it("nothing owed at close → paid, regardless of payments", () => {
    expect(statementView({ statementBalance: 0, paymentsSinceClose: 0, dueDate, today }).status).toBe("paid")
    expect(statementView({ statementBalance: -50, paymentsSinceClose: 0, dueDate, today }).status).toBe("paid")
  })

  it("unpaid before the due date, overdue after it (also when partly paid)", () => {
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 0, dueDate, today }).status).toBe("unpaid")
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 0, dueDate, today: "2026-09-16" }).status).toBe("overdue")
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 300, dueDate, today: "2026-09-16" }).status).toBe("overdue")
    // Due date itself is still on time.
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 0, dueDate, today: "2026-09-15" })).toMatchObject({ status: "unpaid", daysToDue: 0 })
    expect(statementView({ statementBalance: 800, paymentsSinceClose: 0, dueDate, today }).daysToDue).toBe(11)
  })

  it("a post-close refund is not a payment: it does not reduce the statement, it reduces the debt", () => {
    // Statement 800; after close: purchase 150 and a €100 refund. Debt = 800 + 150 − 100 = 850.
    const legs = [
      { type: "outgoing", kind: "standard", amount: 150 },
      { type: "incoming", kind: "refund", amount: 100 },
    ]
    const activity = cycleActivity(legs)
    expect(activity).toEqual({ spent: 150, refunds: 100, payments: 0 })
    expect(statementRemaining(800, activity.payments)).toBe(800)
    expect(cardDebt(-800 - 150 + 100)).toBe(850)
  })

  it("two unpaid statements: one payment settles the OLDEST first (FIFO emerges from the snapshots)", () => {
    // S1 closed with €800 unpaid. Month 2 charges €150 → S2 closes at €950 (includes S1's debt).
    // Month 3: pay €800 (dated after both closes).
    const s1 = statementView({ statementBalance: 800, paymentsSinceClose: 800, dueDate: "2026-08-15", today })
    const s2 = statementView({ statementBalance: 950, paymentsSinceClose: 800, dueDate: "2026-09-15", today })
    expect(s1.status).toBe("paid")
    expect(s2).toMatchObject({ paid: 800, remaining: 150, status: "partial" })
  })

  it("onboarded card: statement €800 entered by hand, opening debt €950 — paying 800 clears the statement, debt 150", () => {
    // The opening balance is a system row, not a payment, so it never counts
    // toward the statement; the manual statement only sees real payments.
    const legs = [
      { type: "outgoing", kind: "standard", amount: 950, isSystem: true }, // Opening Balance
      { type: "incoming", kind: "transfer", amount: 800 }, // payment
    ]
    const activity = cycleActivity(legs)
    expect(activity).toEqual({ spent: 0, refunds: 0, payments: 800 })
    expect(statementRemaining(800, activity.payments)).toBe(0)
    expect(cardDebt(-950 + 800)).toBe(150)
  })

  it("string amounts from the DB behave like numbers", () => {
    expect(statementRemaining("800.00", "300.00")).toBe(500)
    expect(cycleActivity([{ type: "outgoing", kind: "standard", amount: "12.34" }]).spent).toBe(12.34)
  })
})

describe("credit-card — onboarding validation", () => {
  const today = "2026-09-04"
  const good = { creditLimit: 2000, currentDebt: 950, statementClosingDay: 1, paymentDueDay: 15 }

  it("accepts a valid card with and without a known statement", () => {
    expect(validateCardOnboarding(good, today)).toBeNull()
    expect(validateCardOnboarding({ ...good, statement: { balance: 800, closingDate: "2026-09-01" } }, today)).toBeNull()
    expect(validateCardOnboarding({ ...good, currentDebt: 0 }, today)).toBeNull()
  })

  it("rejects bad limits, debts and days", () => {
    expect(validateCardOnboarding({ ...good, creditLimit: 0 }, today)).toBe("limit_invalid")
    expect(validateCardOnboarding({ ...good, creditLimit: NaN }, today)).toBe("limit_invalid")
    expect(validateCardOnboarding({ ...good, currentDebt: -5 }, today)).toBe("debt_invalid")
    expect(validateCardOnboarding({ ...good, statementClosingDay: 0 }, today)).toBe("closing_day_invalid")
    expect(validateCardOnboarding({ ...good, statementClosingDay: 32 }, today)).toBe("closing_day_invalid")
    expect(validateCardOnboarding({ ...good, paymentDueDay: 1.5 }, today)).toBe("due_day_invalid")
    expect(validateCardOnboarding({ ...good, paymentDueDay: 1 }, today)).toBe("same_day")
  })

  it("rejects a malformed or future statement", () => {
    expect(validateCardOnboarding({ ...good, statement: { balance: -1, closingDate: "2026-09-01" } }, today)).toBe("statement_balance_invalid")
    expect(validateCardOnboarding({ ...good, statement: { balance: 800, closingDate: "1/9/2026" } }, today)).toBe("statement_date_invalid")
    expect(validateCardOnboarding({ ...good, statement: { balance: 800, closingDate: "2026-10-01" } }, today)).toBe("statement_in_future")
  })
})

describe("credit-card — fee category suggestion", () => {
  it("prefers an existing fee/interest/bank category and never invents one", () => {
    expect(suggestFeeCategory(["Rent", "Bank & Card Fees", "Travel"])).toBe("Bank & Card Fees")
    expect(suggestFeeCategory(["Rent", "Interest", "Travel"])).toBe("Interest")
    expect(suggestFeeCategory(["Rent", "Travel"])).toBe("")
    expect(suggestFeeCategory([])).toBe("")
  })
})

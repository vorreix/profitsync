import { describe, expect, it } from "vitest"

import {
  budgetSpend,
  expenseContribution,
  incomeContribution,
  isExpenseLeg,
  isIncomeLeg,
  isTransactionKind,
  pnlTotals,
  refundShapeValid,
} from "./tx-classify"

describe("tx-classify — what counts as income / expense", () => {
  it("a standard outgoing is an expense, a standard incoming is income", () => {
    expect(isExpenseLeg({ type: "outgoing", kind: "standard", amount: 40 })).toBe(true)
    expect(isIncomeLeg({ type: "incoming", kind: "standard", amount: 40 })).toBe(true)
    // kind defaults to standard for legacy rows
    expect(isExpenseLeg({ type: "outgoing", amount: 40 })).toBe(true)
  })

  it("transfers are neither income nor expense (a card payment is never a second expense)", () => {
    const out = { type: "outgoing", kind: "transfer", amount: 500 }
    const inn = { type: "incoming", kind: "transfer", amount: 500 }
    expect(isExpenseLeg(out)).toBe(false)
    expect(isIncomeLeg(inn)).toBe(false)
    expect(expenseContribution(out)).toBe(0)
    expect(incomeContribution(inn)).toBe(0)
  })

  it("system balance-defining rows never count", () => {
    expect(isExpenseLeg({ type: "outgoing", kind: "standard", amount: 950, isSystem: true })).toBe(false)
    expect(isIncomeLeg({ type: "incoming", kind: "standard", amount: 950, isSystem: true })).toBe(false)
    expect(expenseContribution({ type: "incoming", kind: "refund", amount: 10, isSystem: true })).toBe(0)
  })

  it("a refund is a NEGATIVE expense, never income", () => {
    const refund = { type: "incoming", kind: "refund", amount: 100 }
    expect(isIncomeLeg(refund)).toBe(false)
    expect(incomeContribution(refund)).toBe(0)
    expect(expenseContribution(refund)).toBe(-100)
  })

  it("pnlTotals: purchase + refund of the same item nets to zero expense and zero income", () => {
    const totals = pnlTotals([
      { type: "outgoing", kind: "standard", amount: "100" }, // shoes on the card
      { type: "incoming", kind: "refund", amount: "100" }, // returned
    ])
    expect(totals).toEqual({ income: 0, expense: 0, net: 0 })
  })

  it("pnlTotals: the canonical card month — purchase counted once, payment zero, fee is a real expense", () => {
    const totals = pnlTotals([
      { type: "outgoing", kind: "standard", amount: 100 }, // groceries on Visa
      { type: "outgoing", kind: "transfer", amount: 100 }, // Intesa leg of the payment
      { type: "incoming", kind: "transfer", amount: 100 }, // Visa leg of the payment
      { type: "outgoing", kind: "standard", amount: 10 }, // annual fee on Visa
      { type: "incoming", kind: "standard", amount: 2000 }, // salary into Intesa
    ])
    expect(totals.expense).toBe(110)
    expect(totals.income).toBe(2000)
    expect(totals.net).toBe(1890)
  })

  it("budgetSpend counts purchases once and card payments zero", () => {
    expect(budgetSpend([{ type: "outgoing", kind: "standard", amount: 75 }])).toBe(75)
    expect(
      budgetSpend([
        { type: "outgoing", kind: "standard", amount: 75 },
        { type: "outgoing", kind: "transfer", amount: 75 },
        { type: "incoming", kind: "transfer", amount: 75 },
      ]),
    ).toBe(75)
  })

  it("refunds must be incoming", () => {
    expect(refundShapeValid("incoming", "refund")).toBe(true)
    expect(refundShapeValid("outgoing", "refund")).toBe(false)
    expect(refundShapeValid("outgoing", "standard")).toBe(true)
    expect(refundShapeValid("outgoing", undefined)).toBe(true)
  })

  it("isTransactionKind accepts only the three kinds", () => {
    expect(isTransactionKind("standard")).toBe(true)
    expect(isTransactionKind("transfer")).toBe(true)
    expect(isTransactionKind("refund")).toBe(true)
    expect(isTransactionKind("payment")).toBe(false)
    expect(isTransactionKind(null)).toBe(false)
  })
})

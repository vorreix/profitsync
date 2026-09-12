import { describe, expect, it } from "vitest"
import {
  addPeriods,
  amortize,
  fromCents,
  interestForPeriod,
  monthlyEquivalent,
  nextDueAfter,
  paymentForLoan,
  periodicRate,
  periodsPerYear,
  splitPayment,
  toCents,
} from "./debt-math"

describe("debt-math — cents and rates", () => {
  it("converts to/from integer cents without float noise", () => {
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents("1234.56")).toBe(123456)
    expect(fromCents(123456)).toBe(1234.56)
    expect(toCents(null)).toBe(0)
  })

  it("periodic rate is nominal annual / periods per year; unknown or zero rate → 0", () => {
    expect(periodicRate(12, 12)).toBeCloseTo(0.01, 12)
    expect(periodicRate(0, 12)).toBe(0)
    expect(periodsPerYear("biweekly")).toBe(26)
    expect(periodsPerYear("irregular")).toBeNull()
    expect(interestForPeriod(100_000, null, 12)).toBe(0)
    expect(interestForPeriod(100_000, 12, 12)).toBe(1_000) // €1,000 at 12 % → €10.00 / month
  })

  it("annuity payment matches the textbook value (€10,000, 5 %, 24 months → €438.71)", () => {
    expect(paymentForLoan(1_000_000, 5, 24)).toBe(43_871)
    // Zero-rate loans split evenly, rounded UP so nothing is left over.
    expect(paymentForLoan(90_000, 0, 3)).toBe(30_000)
    expect(paymentForLoan(100_000, null, 3)).toBe(33_334)
  })

  it("monthly equivalents for other frequencies", () => {
    expect(monthlyEquivalent(10_000, "monthly")).toBe(10_000)
    expect(monthlyEquivalent(10_000, "weekly")).toBe(43_333)
    expect(monthlyEquivalent(30_000, "quarterly")).toBe(10_000)
    expect(monthlyEquivalent(10_000, "irregular")).toBe(0)
  })
})

describe("debt-math — amortization", () => {
  it("a textbook loan ends at exactly zero with a corrected final payment (no €0.03 remainder)", () => {
    const r = amortize({ balance: 1_000_000, annualRatePct: 5, payment: 43_871 })
    expect(r.converges).toBe(true)
    expect(r.periods).toBe(24)
    expect(r.rows[r.rows.length - 1].balance).toBe(0)
    // Final payment absorbs rounding: it differs from the level payment by cents, not euros.
    expect(Math.abs(r.rows[23].payment - 43_871)).toBeLessThan(100)
    // Total interest ≈ €528 for this loan.
    expect(r.totalInterest).toBeGreaterThan(52_000)
    expect(r.totalInterest).toBeLessThan(53_500)
    expect(r.totalPaid).toBe(1_000_000 + r.totalInterest)
  })

  it("every row balances: opening − principal = closing, payment = interest + principal", () => {
    const r = amortize({ balance: 250_000, annualRatePct: 9.2, payment: 12_000 })
    let opening = 250_000
    for (const row of r.rows) {
      expect(row.payment).toBe(row.interest + row.principal)
      expect(opening - row.principal).toBe(row.balance)
      opening = row.balance
    }
    expect(opening).toBe(0)
  })

  it("extra principal each period shortens the schedule and reduces interest", () => {
    const base = amortize({ balance: 1_200_000, annualRatePct: 7, payment: 25_000 })
    const extra = amortize({ balance: 1_200_000, annualRatePct: 7, payment: 25_000, extraPerPeriod: 10_000 })
    expect(extra.periods).toBeLessThan(base.periods)
    expect(extra.totalInterest).toBeLessThan(base.totalInterest)
    expect(extra.converges && base.converges).toBe(true)
  })

  it("an interest-free debt has zero interest in every row", () => {
    const r = amortize({ balance: 70_000, annualRatePct: null, payment: 10_000 })
    expect(r.periods).toBe(7)
    expect(r.totalInterest).toBe(0)
    expect(r.rows.every((row) => row.interest === 0)).toBe(true)
  })

  it("a payment that does not cover the interest never converges — no invented payoff", () => {
    const r = amortize({ balance: 1_000_000, annualRatePct: 24, payment: 15_000 }) // interest €200/mo > €150 payment
    expect(r.converges).toBe(false)
    expect(r.periods).toBe(0)
  })

  it("is capped: a 50-year horizon stops rather than looping", () => {
    const r = amortize({ balance: 100_000_000, annualRatePct: 3, payment: 250_100, keepRows: false })
    expect(r.periods).toBeLessThanOrEqual(600)
    expect(r.rows).toEqual([])
  })

  it("a 30-year mortgage lands on exactly zero (long-schedule rounding)", () => {
    const payment = paymentForLoan(30_000_000, 3.5, 360)
    const r = amortize({ balance: 30_000_000, annualRatePct: 3.5, payment })
    expect(r.converges).toBe(true)
    expect(r.periods).toBeGreaterThanOrEqual(359)
    expect(r.periods).toBeLessThanOrEqual(361)
    expect(r.rows[r.rows.length - 1].balance).toBe(0)
  })
})

describe("debt-math — splitting one payment", () => {
  it("with a known rate: one period of interest on the balance, the rest principal", () => {
    // €10,000 at 8.4 % monthly → €70 interest; €500 payment → €430 principal
    expect(splitPayment({ total: 50_000, balance: 1_000_000, annualRatePct: 8.4, frequency: "monthly" }))
      .toEqual({ principal: 43_000, interest: 7_000, source: "calculated" })
  })

  it("without a rate (informal debt): all principal, no fake interest", () => {
    expect(splitPayment({ total: 20_000, balance: 70_000, annualRatePct: null, frequency: null }))
      .toEqual({ principal: 20_000, interest: 0, source: "principal_only" })
  })

  it("never allocates more principal than is owed; a tiny payment is all interest", () => {
    expect(splitPayment({ total: 200_000, balance: 100_000, annualRatePct: 12, frequency: "monthly" }).principal).toBe(100_000)
    expect(splitPayment({ total: 500, balance: 1_000_000, annualRatePct: 12, frequency: "monthly" })).toEqual({ principal: 0, interest: 500, source: "calculated" })
  })
})

describe("debt-math — schedule dates", () => {
  it("month-based frequencies clamp the day and never drift", () => {
    expect(addPeriods("2026-01-31", "monthly", 1)).toBe("2026-02-28")
    expect(addPeriods("2026-01-31", "monthly", 2)).toBe("2026-03-31")
    expect(addPeriods("2026-11-15", "quarterly", 1)).toBe("2027-02-15")
    expect(addPeriods("2024-02-29", "yearly", 1)).toBe("2025-02-28")
  })

  it("day-based frequencies step by days", () => {
    expect(addPeriods("2026-09-01", "weekly", 1)).toBe("2026-09-08")
    expect(addPeriods("2026-12-25", "biweekly", 1)).toBe("2027-01-08")
  })

  it("nextDueAfter walks forward from the anchor", () => {
    expect(nextDueAfter("2026-01-15", "monthly", "2026-09-04")).toBe("2026-09-15")
    expect(nextDueAfter("2026-01-15", "monthly", "2026-09-15")).toBe("2026-10-15")
    expect(nextDueAfter("2026-10-01", "monthly", "2026-09-04")).toBe("2026-10-01")
  })
})

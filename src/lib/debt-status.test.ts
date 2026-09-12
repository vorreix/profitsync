import { describe, expect, it } from "vitest"
import {
  debtFreeEstimate,
  debtInsights,
  derivedStatus,
  isOpenDebt,
  monthObligations,
  nextPayment,
  normalizeSplit,
  overallDebtFreeDate,
  owedByCurrency,
  progressPct,
  requiredMonthly,
  upcomingSchedule,
  type DebtLike,
} from "./debt-status"

const today = "2026-09-04"
const mortgage: DebtLike = { id: "m", name: "Mortgage", lifecycle: "active", owed: 12_000_000, original: 18_000_000, annualRatePct: 3.1, paymentAmount: 54_500, frequency: "monthly", nextDueDate: "2026-09-01", currency: "EUR" }
const bnpl: DebtLike = { id: "b", name: "Laptop", lifecycle: "active", owed: 60_000, original: 90_000, annualRatePct: 0, paymentAmount: 30_000, frequency: "monthly", nextDueDate: "2026-09-10", currency: "EUR" }
const marco: DebtLike = { id: "marco", name: "Marco", lifecycle: "active", owed: 70_000, original: 70_000, annualRatePct: null, paymentAmount: null, frequency: "irregular", nextDueDate: null, currency: "EUR" }
const family: DebtLike = { id: "f", name: "Family", lifecycle: "active", owed: 90_000_000, original: 90_000_000, annualRatePct: null, paymentAmount: 5_000_000, frequency: "monthly", nextDueDate: "2026-09-21", currency: "INR" }

describe("debt-status — derived status", () => {
  it("lifecycle wins; zero balance is paid off; dates decide overdue / due soon / active", () => {
    expect(derivedStatus({ lifecycle: "refinanced", owed: 0, nextDueDate: null }, today)).toBe("refinanced")
    expect(derivedStatus({ lifecycle: "paused", owed: 100, nextDueDate: "2020-01-01" }, today)).toBe("paused")
    expect(derivedStatus({ lifecycle: "active", owed: 0, nextDueDate: "2020-01-01" }, today)).toBe("paid_off")
    expect(derivedStatus({ lifecycle: "active", owed: 100, nextDueDate: "2026-09-01" }, today)).toBe("overdue")
    expect(derivedStatus({ lifecycle: "active", owed: 100, nextDueDate: "2026-09-10" }, today)).toBe("due_soon")
    expect(derivedStatus({ lifecycle: "active", owed: 100, nextDueDate: "2026-09-11" }, today)).toBe("due_soon")
    expect(derivedStatus({ lifecycle: "active", owed: 100, nextDueDate: "2026-09-12" }, today)).toBe("active")
    expect(derivedStatus({ lifecycle: "active", owed: 100, nextDueDate: null }, today)).toBe("active")
  })
  it("open debts count; paid off / refinanced do not", () => {
    expect(isOpenDebt(marco)).toBe(true)
    expect(isOpenDebt({ lifecycle: "active", owed: 0 })).toBe(false)
    expect(isOpenDebt({ lifecycle: "refinanced", owed: 500 })).toBe(false)
  })
  it("progress is repaid share of the original", () => {
    expect(progressPct(18_000_000, 12_000_000)).toBe(33.3)
    expect(progressPct(null, 100)).toBeNull()
    expect(progressPct(100, 150)).toBe(0) // owes more than original (interest capitalised) → 0, not negative
    expect(progressPct(100, 0)).toBe(100)
  })
})

describe("debt-status — schedule and obligations", () => {
  it("upcoming schedule walks each debt's frequency; irregular debts have no rows; paid months are marked", () => {
    const paid = new Map([["m:2026-09", 54_500]])
    const rows = upcomingSchedule([mortgage, bnpl, marco], today, 2, paid)
    expect(rows.map((r) => `${r.debtId}:${r.date}:${r.paid ? "✓" : "·"}`)).toEqual([
      "m:2026-09-01:✓", "b:2026-09-10:·", "m:2026-10-01:·", "b:2026-10-10:·",
    ])
  })

  it("this month's obligations: required, paid, remaining, overdue", () => {
    const paid = new Map([["m", 54_500]])
    const o = monthObligations([mortgage, bnpl, marco], today, paid)
    expect(o.required).toBe(84_500) // mortgage 545 + laptop 300
    expect(o.paid).toBe(54_500)
    expect(o.remaining).toBe(30_000)
    expect(o.overdue).toBe(54_500) // mortgage was due Sep 1 (paid amount is a separate figure; the date already passed)
  })

  it("an unpaid instalment from an earlier month is carried into required + overdue", () => {
    const late: DebtLike = { ...bnpl, nextDueDate: "2026-08-10" }
    const o = monthObligations([late], today, new Map())
    expect(o.overdue).toBe(30_000) // only the August instalment is overdue; Sep 10 is still ahead
    expect(o.required).toBe(60_000) // August carried + September
  })

  it("next payment is the earliest scheduled date (an overdue one first)", () => {
    expect(nextPayment([mortgage, bnpl, marco], today)?.debt.id).toBe("m")
    expect(nextPayment([bnpl, family], today)?.debt.id).toBe("b")
    expect(nextPayment([marco], today)).toBeNull()
  })

  it("required monthly sums monthly equivalents of open debts", () => {
    expect(requiredMonthly([mortgage, bnpl, marco])).toBe(84_500)
  })

  it("owed by currency keeps native amounts apart — nothing is converted", () => {
    expect(owedByCurrency([mortgage, bnpl, marco, family])).toEqual([
      { currency: "INR", owed: 90_000_000 },
      { currency: "EUR", owed: 12_130_000 },
    ])
  })
})

describe("debt-status — debt-free estimate", () => {
  it("a scheduled loan gets a date, periods and remaining interest", () => {
    const e = debtFreeEstimate(bnpl, today)
    expect(e).toEqual({ kind: "date", date: "2026-10-10", periods: 2, remainingInterest: 0, assumedZeroRate: false })
  })
  it("an unknown rate is assumed 0 % and flagged", () => {
    const e = debtFreeEstimate(family, today)
    expect(e.kind).toBe("date")
    if (e.kind === "date") { expect(e.assumedZeroRate).toBe(true); expect(e.periods).toBe(18) }
  })
  it("no schedule → unknown, never an invented date", () => {
    expect(debtFreeEstimate(marco, today)).toEqual({ kind: "unknown", reason: "no_schedule" })
  })
  it("payment below the interest → unknown", () => {
    expect(debtFreeEstimate({ ...mortgage, paymentAmount: 10_000 }, today)).toEqual({ kind: "unknown", reason: "payment_too_small" })
  })
  it("overall date is the latest estimate, or null if any open debt is unknown", () => {
    const est = new Map([["m", debtFreeEstimate(mortgage, today)], ["b", debtFreeEstimate(bnpl, today)]])
    expect(overallDebtFreeDate(est, [mortgage, bnpl])).toBe((debtFreeEstimate(mortgage, today) as { date: string }).date)
    est.set("marco", debtFreeEstimate(marco, today))
    expect(overallDebtFreeDate(est, [mortgage, bnpl, marco])).toBeNull()
  })
})

describe("debt-status — insights and splits", () => {
  it("produces plain-language, deterministic insights", () => {
    const debts = [mortgage, bnpl, marco]
    const estimates = new Map(debts.map((d) => [d.id, debtFreeEstimate(d, today)]))
    const out = debtInsights({ debts, today, interestPaidThisMonth: 8_700, currency: "EUR", estimates })
    const keys = out.map((i) => i.key)
    expect(keys).toContain("interest_this_month")
    expect(keys).toContain("few_payments_left") // laptop: 2 left
    expect(keys).toContain("smallest_clearable") // laptop €600
    expect(keys).toContain("frees_monthly")
    expect(out.find((i) => i.key === "interest_this_month")!.params).toEqual({ amount: 87, currency: "EUR" })
    expect(debtInsights({ debts: [], today, interestPaidThisMonth: 0, currency: "EUR", estimates })).toEqual([])
  })

  it("normalizeSplit makes the parts add up to the total in cents, or rejects", () => {
    expect(normalizeSplit({ total: 500, interest: 70, fees: 10 })).toEqual({ total: 50_000, principal: 42_000, interest: 7_000, fees: 1_000, other: 0 })
    expect(normalizeSplit({ total: 500, principal: 420, interest: 70, fees: 10 })!.principal).toBe(42_000)
    expect(normalizeSplit({ total: 500, principal: 400, interest: 70, fees: 10 })).toBeNull() // doesn't add up
    expect(normalizeSplit({ total: 0 })).toBeNull()
    expect(normalizeSplit({ total: 100, interest: 120 })).toBeNull() // negative principal
  })
})

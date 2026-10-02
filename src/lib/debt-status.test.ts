import { describe, expect, it } from "vitest"
import { amortize } from "./debt-math"
import {
  debtFreeEstimate,
  debtInsights,
  derivedStatus,
  isOpenDebt,
  monthObligations,
  nextPayment,
  normalizeSplit,
  OPEN_LIFECYCLES,
  overallDebtFreeDate,
  owedByCurrency,
  periodsBefore,
  progressPct,
  requiredMonthly,
  sumByCurrency,
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
    // The same list net worth filters on in SQL (api/_lib/wealth-summary.ts).
    expect(OPEN_LIFECYCLES).toEqual(["active", "paused"])
    expect(isOpenDebt({ lifecycle: "written_off", owed: 400_000 })).toBe(false)
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

  it("one €100 payment on a weekly debt settles ONE week, not the whole month (MC-094)", () => {
    const weekly: DebtLike = { ...bnpl, id: "w", owed: 1_000_000, paymentAmount: 10_000, frequency: "weekly", nextDueDate: "2026-09-07" }
    const rows = upcomingSchedule([weekly], "2026-09-01", 1, new Map([["w:2026-09", 10_000]]))
    expect(rows.map((r) => `${r.date}:${r.paidAmount}:${r.paid ? "✓" : "·"}`)).toEqual([
      "2026-09-07:10000:✓", "2026-09-14:0:·", "2026-09-21:0:·", "2026-09-28:0:·",
    ])
    // €150 covers the first week and half of the second — which is not yet paid.
    const more = upcomingSchedule([weekly], "2026-09-01", 1, new Map([["w:2026-09", 15_000]]))
    expect(more.map((r) => [r.paidAmount, r.paid])).toEqual([[10_000, true], [5_000, false], [0, false], [0, false]])
    expect(more.reduce((s, r) => s + r.paidAmount, 0)).toBe(15_000) // never more than was paid
  })

  it("a payment that already ADVANCED next_due_date settles the instalment it paid, not the next one (MC-094)", () => {
    // What recordDebtPayment leaves behind: €100 paid on Sep 7 → next due Sep 14.
    const weekly: DebtLike = { ...bnpl, id: "w", owed: 1_000_000, paymentAmount: 10_000, frequency: "weekly", nextDueDate: "2026-09-14" }
    const paid = new Map([["w:2026-09", 10_000]])
    const rows = upcomingSchedule([weekly], "2026-09-08", 1, paid)
    expect(rows.map((r) => `${r.date}:${r.paidAmount}:${r.paid ? "✓" : "·"}`)).toEqual(["2026-09-14:0:·", "2026-09-21:0:·", "2026-09-28:0:·"])
    // The month still owed 4 × €100, €100 of it is paid: €300 to go, not €200.
    const [o] = monthObligations([weekly], "2026-09-08", new Map([["w", 10_000]]))
    expect(o).toEqual({ currency: "EUR", required: 40_000, paid: 10_000, remaining: 30_000, overdue: 0 })
    // A debt that only STARTED mid-month (nothing paid yet) is not handed the weeks before it.
    const [fresh] = monthObligations([weekly], "2026-09-08", new Map())
    expect(fresh.required).toBe(30_000)
    // Paying more than the rolled-past instalment spreads the rest from the next due date on.
    const extra = upcomingSchedule([weekly], "2026-09-08", 1, new Map([["w:2026-09", 20_000]]))
    expect(extra.map((r) => r.paid)).toEqual([true, false, false])
  })

  it("the schedule stops at payoff: a weekly $100 debt with $300 left has three rows, not one every week (MC-DB04)", () => {
    // The rule posted Oct 1 ($400 → $300) and its cursor moved to Oct 8.
    const weekly: DebtLike = { ...bnpl, id: "w", currency: "USD", owed: 30_000, paymentAmount: 10_000, frequency: "weekly", nextDueDate: "2026-10-08" }
    const paid = new Map([["w:2026-10", 10_000]])
    const rows = upcomingSchedule([weekly], "2026-10-01", 3, paid)
    expect(rows.map((r) => `${r.date}:${r.amount}:${r.paid ? "✓" : "·"}`)).toEqual(["2026-10-08:10000:·", "2026-10-15:10000:·", "2026-10-22:10000:·"])
    // October: the settled Oct 1 + the three still due — never five instalments on a $400 debt.
    expect(monthObligations([weekly], "2026-10-01", new Map([["w", 10_000]]))).toEqual([{ currency: "USD", required: 40_000, paid: 10_000, remaining: 30_000, overdue: 0 }])
    // The last row is the payoff figure; a residue under the tolerance folds into it (as payoffCappedAmount does).
    expect(upcomingSchedule([{ ...weekly, owed: 25_000 }], "2026-10-01", 3).map((r) => r.amount)).toEqual([10_000, 10_000, 5_000])
    expect(upcomingSchedule([{ ...weekly, owed: 30_150 }], "2026-10-01", 3).map((r) => r.amount)).toEqual([10_000, 10_000, 10_150])
    // Several missed instalments: EVERY one carried in is overdue, and together they are the payoff — not just the first.
    const missed = upcomingSchedule([{ ...weekly, nextDueDate: "2026-09-15" }], "2026-10-01", 3)
    expect(missed.map((r) => r.date)).toEqual(["2026-09-15", "2026-09-22", "2026-09-29"])
    expect(monthObligations([{ ...weekly, nextDueDate: "2026-09-15" }], "2026-10-01", new Map())).toEqual([{ currency: "USD", required: 30_000, paid: 0, remaining: 30_000, overdue: 30_000 }])
    const monthly: DebtLike = { ...weekly, owed: 25_000, frequency: "monthly", nextDueDate: "2026-07-15" }
    expect(monthObligations([monthly], "2026-10-01", new Map())[0]).toMatchObject({ required: 25_000, overdue: 25_000, remaining: 25_000 })
    // Money already paid has left the balance: a row it covers draws nothing, so the unpaid rows still sum to what is owed.
    const ahead = upcomingSchedule([{ ...weekly, owed: 20_000 }], "2026-10-01", 3, new Map([["w:2026-10", 20_000]]))
    expect(ahead.map((r) => `${r.date}:${r.amount - r.paidAmount}`)).toEqual(["2026-10-08:0", "2026-10-15:10000", "2026-10-22:10000"])
  })

  it("an interest-bearing debt ends where amortize ends it; one whose payment never covers the interest stays uncapped (MC-DB04)", () => {
    const loan: DebtLike = { ...bnpl, id: "l", owed: 100_000, annualRatePct: 12, paymentAmount: 30_000, frequency: "monthly", nextDueDate: "2026-10-10" }
    const plan = amortize({ balance: 100_000, annualRatePct: 12, payment: 30_000, ppy: 12 })
    const rows = upcomingSchedule([loan], "2026-10-01", 6)
    expect(rows.map((r) => r.amount)).toEqual(plan.rows.map((r) => r.payment)) // 300, 300, 300, 122.48
    expect(rows.map((r) => r.amount)).toEqual([30_000, 30_000, 30_000, 12_248])
    // 2 %/month on €1,000 is €20; a €15 payment never clears it → the honest answer is the plain schedule.
    const stuck: DebtLike = { ...loan, annualRatePct: 24, paymentAmount: 1_500 }
    expect(upcomingSchedule([stuck], "2026-10-01", 3).map((r) => r.amount)).toEqual([1_500, 1_500, 1_500])
  })

  it("periodsBefore steps back across a year boundary (addPeriods wraps to month 00)", () => {
    expect(periodsBefore("2026-01-15", "monthly", 1)).toBe("2025-12-15")
    expect(periodsBefore("2026-02-01", "monthly", 3)).toBe("2025-11-01")
    expect(periodsBefore("2026-03-31", "monthly", 1)).toBe("2026-02-28")
    expect(periodsBefore("2026-02-15", "quarterly", 1)).toBe("2025-11-15")
    expect(periodsBefore("2024-02-29", "yearly", 1)).toBe("2023-02-28")
    expect(periodsBefore("2026-01-05", "weekly", 1)).toBe("2025-12-29")
    // A monthly debt paid on Dec 10 is now due Jan 10: December's payment settled December.
    const monthly: DebtLike = { ...bnpl, nextDueDate: "2026-01-10" }
    expect(monthObligations([monthly], "2025-12-20", new Map([["b", 30_000]]))[0]).toMatchObject({ required: 30_000, paid: 30_000, remaining: 0 })
  })

  it("this month's obligations: required, paid, remaining, overdue", () => {
    const paid = new Map([["m", 54_500]])
    const [o, ...rest] = monthObligations([mortgage, bnpl, marco], today, paid)
    expect(rest).toEqual([])
    expect(o.currency).toBe("EUR")
    expect(o.required).toBe(84_500) // mortgage 545 + laptop 300
    expect(o.paid).toBe(54_500)
    expect(o.remaining).toBe(30_000)
    expect(o.overdue).toBe(54_500) // mortgage was due Sep 1 (paid amount is a separate figure; the date already passed)
  })

  it("obligations are kept apart per debt currency — ₹5,000 + €200 is never 5,200 (MC-028)", () => {
    const inr: DebtLike = { ...family, paymentAmount: 500_000, nextDueDate: "2026-09-21" }
    const eur: DebtLike = { ...bnpl, paymentAmount: 20_000, nextDueDate: "2026-09-10" }
    const rows = monthObligations([inr, eur], today, new Map([["b", 20_000], ["f", 100_000]]))
    expect(rows).toEqual([
      { currency: "INR", required: 500_000, paid: 100_000, remaining: 400_000, overdue: 0 },
      { currency: "EUR", required: 20_000, paid: 20_000, remaining: 0, overdue: 0 },
    ])
    expect(requiredMonthly([inr, eur])).toEqual([{ currency: "INR", amount: 500_000 }, { currency: "EUR", amount: 20_000 }])
  })

  it("an unpaid instalment from an earlier month is carried into required + overdue", () => {
    const late: DebtLike = { ...bnpl, nextDueDate: "2026-08-10" }
    const [o] = monthObligations([late], today, new Map())
    expect(o.overdue).toBe(30_000) // only the August instalment is overdue; Sep 10 is still ahead
    expect(o.required).toBe(60_000) // August carried + September
  })

  it("next payment is the earliest scheduled date (an overdue one first)", () => {
    expect(nextPayment([mortgage, bnpl, marco], today)?.debt.id).toBe("m")
    expect(nextPayment([bnpl, family], today)?.debt.id).toBe("b")
    expect(nextPayment([marco], today)).toBeNull()
  })

  it("a same-day tie is broken by the CONVERTED payment, or not compared at all (MC-142)", () => {
    const yen: DebtLike = { ...bnpl, id: "y", currency: "JPY", paymentAmount: 2_000_000, nextDueDate: "2026-09-10" } // ¥20,000 ≈ $136
    const usd: DebtLike = { ...bnpl, id: "u", currency: "USD", paymentAmount: 30_000, nextDueDate: "2026-09-10" } // $300
    const rates = new Map([["USD", 1], ["JPY", 0.0068]])
    expect(nextPayment([yen, usd], today, rates)?.debt.id).toBe("u")
    // No rate: list order, not "2,000,000 > 30,000".
    expect(nextPayment([usd, yen], today)?.debt.id).toBe("u")
    expect(nextPayment([yen, usd], today)?.debt.id).toBe("y")
  })

  it("required monthly sums monthly equivalents of open debts", () => {
    expect(requiredMonthly([mortgage, bnpl, marco])).toEqual([{ currency: "EUR", amount: 84_500 }])
  })

  it("sums per currency, largest first", () => {
    expect(sumByCurrency([{ currency: "EUR", amount: 1 }, { currency: "USD", amount: 5 }, { currency: "EUR", amount: 2 }])).toEqual([
      { currency: "USD", amount: 5 },
      { currency: "EUR", amount: 3 },
    ])
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
    const out = debtInsights({ debts, today, interestPaidThisMonth: [{ currency: "EUR", amount: 8_700 }], estimates })
    const keys = out.map((i) => i.key)
    expect(keys).toContain("interest_this_month")
    expect(keys).toContain("few_payments_left") // laptop: 2 left
    expect(keys).toContain("smallest_clearable") // laptop €600
    expect(keys).toContain("frees_monthly")
    expect(out.find((i) => i.key === "interest_this_month")!.params).toEqual({ amount: 87, currency: "EUR" })
    expect(debtInsights({ debts: [], today, interestPaidThisMonth: [], estimates })).toEqual([])
  })

  it("interest is reported per debt currency — $100 + €25 is never €125 (MC-089)", () => {
    const debts = [mortgage, bnpl, marco]
    const estimates = new Map(debts.map((d) => [d.id, debtFreeEstimate(d, today)]))
    const parts = [{ currency: "USD", amount: 10_000 }, { currency: "EUR", amount: 2_500 }, { currency: "INR", amount: 900 }]
    const out = debtInsights({ debts, today, interestPaidThisMonth: parts, estimates })
    // ONE line (the hub joins every part from the summary list), labelled in its own
    // currency — so three currencies don't push the other insights out of the cap.
    expect(out.filter((i) => i.key === "interest_this_month").map((i) => i.params)).toEqual([{ amount: 100, currency: "USD" }])
    expect(out.map((i) => i.key)).toEqual(expect.arrayContaining(["few_payments_left", "smallest_clearable", "frees_monthly"]))
  })

  it("'smallest debt' compares across currencies only through a rate (MC-142)", () => {
    const yen: DebtLike = { ...bnpl, id: "y", name: "Yen", currency: "JPY", owed: 5_000_000 } // ¥50,000 ≈ $340
    const usd: DebtLike = { ...bnpl, id: "u", name: "Dollar", currency: "USD", owed: 60_000 } // $600
    const debts = [yen, usd]
    const estimates = new Map(debts.map((d) => [d.id, debtFreeEstimate(d, today)]))
    const smallest = (rates?: Map<string, number>) => debtInsights({ debts, today, interestPaidThisMonth: [], estimates, rates }).find((i) => i.key === "smallest_clearable")
    expect(smallest(new Map([["USD", 1], ["JPY", 0.0068]]))?.params).toEqual({ name: "Yen", amount: 50_000, currency: "JPY" })
    // Without a rate for every currency the claim is not made at all.
    expect(smallest()).toBeUndefined()
    expect(smallest(new Map([["USD", 1]]))).toBeUndefined()
  })

  it("normalizeSplit makes the parts add up to the total in cents, or rejects", () => {
    expect(normalizeSplit({ total: 500, interest: 70, fees: 10 })).toEqual({ total: 50_000, principal: 42_000, interest: 7_000, fees: 1_000, other: 0 })
    expect(normalizeSplit({ total: 500, principal: 420, interest: 70, fees: 10 })!.principal).toBe(42_000)
    expect(normalizeSplit({ total: 500, principal: 400, interest: 70, fees: 10 })).toBeNull() // doesn't add up
    expect(normalizeSplit({ total: 0 })).toBeNull()
    expect(normalizeSplit({ total: 100, interest: 120 })).toBeNull() // negative principal
  })
})

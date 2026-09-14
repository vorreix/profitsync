import { describe, expect, it } from "vitest"
import { fromCents, toCents } from "./debt-math"
import { previewDebt, type DebtPreview } from "./debt-preview"

const schedule = (p: DebtPreview) => {
  if (p.kind !== "schedule") throw new Error(`expected a schedule, got ${p.kind}`)
  return p
}

const base = {
  owed: toCents(1000),
  original: toCents(1000),
  annualRatePct: 12,
  repayment: { amount: toCents(300), frequency: "monthly" as const, firstPayment: "2026-01-05" },
}

describe("previewDebt", () => {
  it("says nothing until there is an amount", () => {
    expect(previewDebt({ ...base, owed: 0 })).toEqual({ kind: "empty" })
    expect(previewDebt({ ...base, owed: toCents(-5) })).toEqual({ kind: "empty" })
  })

  it("without a repayment it can only report what is owed — never a payoff date", () => {
    const p = previewDebt({ ...base, repayment: null })
    expect(p).toEqual({ kind: "manual", owed: toCents(1000), repaidPct: 0 })
  })

  it("reports progress against the original amount when there is one", () => {
    const p = previewDebt({ ...base, owed: toCents(400), original: toCents(1000), repayment: null })
    expect(p).toEqual({ kind: "manual", owed: toCents(400), repaidPct: 60 })
  })

  it("has no progress to report without an original amount", () => {
    const p = previewDebt({ ...base, original: null, repayment: null })
    expect(p).toMatchObject({ kind: "manual", repaidPct: null })
  })

  it("treats a zero instalment as no schedule at all", () => {
    const p = previewDebt({ ...base, repayment: { ...base.repayment, amount: 0 } })
    expect(p.kind).toBe("manual")
  })

  it("works out the whole schedule: 1,000 at 12 % paying 300 a month", () => {
    const p = schedule(previewDebt(base))
    // 10.00 + 7.10 + 4.17 + 1.21 of interest across four instalments, the last
    // one capped at what is left — exactly what the engine posts.
    expect(p.payments).toBe(4)
    expect(fromCents(p.totalInterest)).toBe(22.48)
    expect(fromCents(p.totalPaid)).toBe(1022.48)
    expect(fromCents(p.finalPayment)).toBe(122.48)
    expect(p.payoffDate).toBe("2026-04-05")
    expect(p.assumedZeroRate).toBe(false)
  })

  it("the final instalment is smaller than the rest, and everything adds up", () => {
    const p = schedule(previewDebt(base))
    expect(p.finalPayment).toBeLessThan(p.perPayment)
    expect(p.totalPaid).toBe(p.owed + p.totalInterest)
  })

  it("flags an assumed 0 % when no rate was entered", () => {
    const p = schedule(previewDebt({ ...base, annualRatePct: null }))
    expect(p.assumedZeroRate).toBe(true)
    expect(p.totalInterest).toBe(0)
    expect(p.payments).toBe(4) // 300 + 300 + 300 + 100
    expect(fromCents(p.finalPayment)).toBe(100)
  })

  it("does NOT flag a rate the user deliberately entered as 0", () => {
    expect(schedule(previewDebt({ ...base, annualRatePct: 0 })).assumedZeroRate).toBe(false)
  })

  it("a single instalment that clears everything ends on the first payment date", () => {
    const p = schedule(previewDebt({ ...base, repayment: { ...base.repayment, amount: toCents(5000) } }))
    expect(p.payments).toBe(1)
    expect(p.payoffDate).toBe("2026-01-05")
    expect(fromCents(p.finalPayment)).toBe(1010) // 1,000 + one month's interest
  })

  it("refuses to invent a date when the instalment cannot cover the interest", () => {
    // 1,000 at 24 % accrues 20.00 a month; paying 20 never touches the principal.
    const p = previewDebt({ ...base, annualRatePct: 24, repayment: { ...base.repayment, amount: toCents(20) } })
    expect(p).toEqual({ kind: "never", owed: toCents(1000), perPayment: toCents(20), minimumPayment: toCents(20) + 1 })
  })

  it("one cent over the interest is enough to converge", () => {
    const p = previewDebt({ ...base, annualRatePct: 24, repayment: { ...base.repayment, amount: toCents(20) + 1 } })
    expect(p.kind).toBe("schedule")
  })

  it("says 'longer than the horizon' rather than 'never' when it does pay off eventually", () => {
    // 20.50 a month against 1,000 at 24 % DOES converge — in 188 months. Past a
    // horizon of 12 it is still a real payoff, just not one worth drawing, and
    // calling it "never" would be wrong.
    const long = previewDebt({ ...base, annualRatePct: 24, repayment: { ...base.repayment, amount: toCents(20.5) } })
    expect(long.kind).toBe("schedule")
    const p = previewDebt({ ...base, annualRatePct: 24, repayment: { ...base.repayment, amount: toCents(20.5) }, maxPeriods: 12 })
    expect(p).toEqual({ kind: "too_long", owed: toCents(1000), perPayment: toCents(20.5), years: 1 })
  })

  it("measures the horizon in the rule's own rhythm", () => {
    const weekly = previewDebt({
      ...base, annualRatePct: 24,
      repayment: { amount: toCents(4.7), frequency: "weekly", firstPayment: "2026-01-05" },
      maxPeriods: 520,
    })
    expect(weekly).toMatchObject({ kind: "too_long", years: 10 })
  })

  it("dates the payoff by the rhythm, not by months", () => {
    const weekly = schedule(previewDebt({ ...base, repayment: { amount: toCents(300), frequency: "weekly", firstPayment: "2026-01-05" } }))
    expect(weekly.payments).toBe(4)
    expect(weekly.payoffDate).toBe("2026-01-26") // three weeks after the first
    const yearly = schedule(previewDebt({ ...base, repayment: { amount: toCents(300), frequency: "yearly", firstPayment: "2026-01-05" } }))
    expect(yearly.payoffDate.slice(0, 4) > "2026").toBe(true)
  })

  it("a weekly rhythm accrues less interest per period than a monthly one", () => {
    const monthly = schedule(previewDebt(base))
    const weekly = schedule(previewDebt({ ...base, repayment: { ...base.repayment, frequency: "weekly" } }))
    expect(weekly.totalInterest).toBeLessThan(monthly.totalInterest)
  })

  it("survives a month-end anchor without drifting", () => {
    const p = schedule(previewDebt({ ...base, repayment: { ...base.repayment, firstPayment: "2026-01-31" } }))
    expect(p.payoffDate).toBe("2026-04-30")
  })
})

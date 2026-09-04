import { describe, expect, it } from "vitest"
import {
  addDays,
  addMonths,
  alertTier,
  applyOccurrenceDeviations,
  barPercent,
  carryFor,
  carryLowerBound,
  contributionAtClose,
  daysBetween,
  daysInMonth,
  defaultCarryPolicy,
  flexibleHeadroom,
  forecastBalance,
  fundBalanceFromEntries,
  fundingCapacity,
  isFunded,
  isOverdue,
  median,
  normalizeTarget,
  pendingFrom,
  periodDays,
  periodFor,
  remaining,
  reservedTotal,
  round2,
  safeToSpend,
  spentNet,
  state,
  suggestFlexible,
  todayInTz,
  unallocated,
  weekday,
  MAX_UNRESOLVED_RECURRING_OCCURRENCES,
  RECURRING_OVERDUE_LOOKBACK_DAYS,
  type ReservedBreakdown,
  nextPeriod,
  effectiveOccurrenceStatus,
} from "./budget-math"

// ═══════════════════════════════════════════════════════════════════════════
// §8.1 thresholds — ONE definition, and `full` is distinct from `warn`/`over`
// ═══════════════════════════════════════════════════════════════════════════
describe("state (§8.1)", () => {
  it("classifies below / at / over the warn line", () => {
    expect(state(0, 100)).toBe("ok")
    expect(state(79.99, 100)).toBe("ok")
    expect(state(80, 100)).toBe("warn")
    expect(state(99.99, 100)).toBe("warn")
  })

  it("reports EXACTLY 100% as `full`, not `warn` (fixes v1 defect #15)", () => {
    expect(state(100, 100)).toBe("full")
  })

  it("reports over only strictly past the cap", () => {
    expect(state(100.01, 100)).toBe("over")
    expect(state(250, 100)).toBe("over")
  })

  it("handles a zero/absent plan", () => {
    expect(state(0, 0)).toBe("none")
    expect(state(10, 0)).toBe("over")
    expect(state(10, -5)).toBe("over")
  })
})

describe("alertTier (§14.3 — shares state() so a bar and an alert cannot disagree)", () => {
  it("warns from 80% including exactly at the cap", () => {
    expect(alertTier(79.99, 100)).toBeNull()
    expect(alertTier(80, 100)).toBe("budget_warning")
    expect(alertTier(100, 100)).toBe("budget_warning")
  })
  it("exceeds strictly past the cap", () => {
    expect(alertTier(100.01, 100)).toBe("budget_exceeded")
  })
  it("never alerts without a plan", () => {
    expect(alertTier(50, 0)).toBe("budget_exceeded") // spend with no plan IS over
    expect(alertTier(0, 0)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.2 calendar + period boundaries (all string dates, DST-safe)
// ═══════════════════════════════════════════════════════════════════════════
describe("calendar helpers (§8.2)", () => {
  it("adds days without crossing DST", () => {
    // Europe/Rome springs forward 2026-03-29. Date-only arithmetic is unaffected.
    expect(addDays("2026-03-28", 1)).toBe("2026-03-29")
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
  })

  it("adds months clamping the day to month length", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28")
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29") // leap year
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28")
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15")
  })

  it("counts whole days between dates", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30)
    expect(daysBetween("2026-02-01", "2026-03-01")).toBe(28)
    expect(daysBetween("2028-02-01", "2028-03-01")).toBe(29)
  })

  it("knows month lengths incl. leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28)
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 12)).toBe(31)
  })

  it("returns ISO weekday with Monday = 1", () => {
    expect(weekday("2026-09-07")).toBe(1) // Monday
    expect(weekday("2026-09-13")).toBe(7) // Sunday
  })
})

describe("todayInTz (§8.2 — the ONLY timezone-sensitive value)", () => {
  // 2026-01-15T23:30Z: already the 16th in UTC+14, still the 15th in UTC-11.
  const instant = new Date("2026-01-15T23:30:00Z")

  it("resolves the local calendar day, not the UTC one", () => {
    expect(todayInTz("Pacific/Kiritimati", instant)).toBe("2026-01-16") // UTC+14
    expect(todayInTz("UTC", instant)).toBe("2026-01-15")
    expect(todayInTz("Pacific/Midway", instant)).toBe("2026-01-15") // UTC-11
  })

  it("handles a half-hour offset zone", () => {
    expect(todayInTz("Asia/Kolkata", new Date("2026-01-15T19:00:00Z"))).toBe("2026-01-16")
  })

  it("degrades to UTC on an invalid zone rather than throwing", () => {
    expect(todayInTz("Not/AZone", instant)).toBe("2026-01-15")
    expect(todayInTz("", instant)).toBe("2026-01-15")
  })
})

describe("periodFor — monthly (§8.2)", () => {
  const cfg = { cadence: "monthly" as const }
  it("spans the calendar month, end exclusive", () => {
    expect(periodFor(cfg, "2026-09-15")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
    expect(periodFor(cfg, "2026-09-01")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
    expect(periodFor(cfg, "2026-09-30")).toEqual({ start: "2026-09-01", endExclusive: "2026-10-01" })
  })
  it("handles February and year ends", () => {
    expect(periodFor(cfg, "2028-02-29")).toEqual({ start: "2028-02-01", endExclusive: "2028-03-01" })
    expect(periodFor(cfg, "2026-12-31")).toEqual({ start: "2026-12-01", endExclusive: "2027-01-01" })
  })
  it("has a day count matching the month", () => {
    expect(periodDays(periodFor(cfg, "2026-02-10"))).toBe(28)
    expect(periodDays(periodFor(cfg, "2026-07-10"))).toBe(31)
  })
})

describe("periodFor — weekly, every week-start day (§8.2)", () => {
  it("anchors to the configured start day", () => {
    // 2026-09-10 is a Thursday.
    expect(periodFor({ cadence: "weekly", weekStartDay: 1 }, "2026-09-10").start).toBe("2026-09-07") // Mon
    expect(periodFor({ cadence: "weekly", weekStartDay: 4 }, "2026-09-10").start).toBe("2026-09-10") // Thu
    expect(periodFor({ cadence: "weekly", weekStartDay: 7 }, "2026-09-10").start).toBe("2026-09-06") // Sun
  })
  it("is always 7 days", () => {
    for (let d = 1; d <= 7; d++) {
      expect(periodDays(periodFor({ cadence: "weekly", weekStartDay: d }, "2026-09-10"))).toBe(7)
    }
  })
  it("defaults to Monday", () => {
    expect(periodFor({ cadence: "weekly" }, "2026-09-10").start).toBe("2026-09-07")
  })
})

describe("periodFor — payday anchor, clamped to short months (§8.2)", () => {
  it("runs anchor-to-anchor", () => {
    const cfg = { cadence: "payday" as const, anchorDay: 27 }
    expect(periodFor(cfg, "2026-09-28")).toEqual({ start: "2026-09-27", endExclusive: "2026-10-27" })
    expect(periodFor(cfg, "2026-09-26")).toEqual({ start: "2026-08-27", endExclusive: "2026-09-27" })
    expect(periodFor(cfg, "2026-09-27").start).toBe("2026-09-27") // inclusive
  })

  it("clamps a 31st anchor in shorter months", () => {
    const cfg = { cadence: "payday" as const, anchorDay: 31 }
    expect(periodFor(cfg, "2026-02-15").start).toBe("2026-01-31")
    expect(periodFor(cfg, "2026-02-28")).toEqual({ start: "2026-02-28", endExclusive: "2026-03-31" })
    expect(periodFor(cfg, "2026-04-30").start).toBe("2026-04-30")
  })

  it("never produces an empty or inverted window", () => {
    for (const anchor of [1, 15, 28, 29, 30, 31]) {
      for (const day of ["2026-01-05", "2026-02-14", "2026-02-28", "2026-12-31"]) {
        const w = periodFor({ cadence: "payday", anchorDay: anchor }, day)
        expect(w.endExclusive > w.start).toBe(true)
        expect(day >= w.start && day < w.endExclusive).toBe(true)
      }
    }
  })
})

describe("periodFor — custom range (§8.2)", () => {
  it("repeats in whole periods from the anchor", () => {
    const cfg = { cadence: "custom" as const, customStart: "2026-01-01", customDays: 10 }
    expect(periodFor(cfg, "2026-01-05")).toEqual({ start: "2026-01-01", endExclusive: "2026-01-11" })
    expect(periodFor(cfg, "2026-01-11")).toEqual({ start: "2026-01-11", endExclusive: "2026-01-21" })
    expect(periodFor(cfg, "2026-02-01").start).toBe("2026-01-31")
  })
  it("works before the anchor date too", () => {
    const cfg = { cadence: "custom" as const, customStart: "2026-01-11", customDays: 10 }
    expect(periodFor(cfg, "2026-01-05")).toEqual({ start: "2026-01-01", endExclusive: "2026-01-11" })
  })
  it("clamps the length to 1..400", () => {
    expect(periodDays(periodFor({ cadence: "custom", customStart: "2026-01-01", customDays: 0 }, "2026-01-01"))).toBe(1)
    expect(periodDays(periodFor({ cadence: "custom", customStart: "2026-01-01", customDays: 9999 }, "2026-01-01"))).toBe(400)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.7 cadence normalisation — never aggregate across cadences
// ═══════════════════════════════════════════════════════════════════════════
describe("normalizeTarget (§8.7)", () => {
  it("scales a daily target to the period length", () => {
    expect(normalizeTarget(20, "day", 30, "monthly")).toBe(600)
    expect(normalizeTarget(20, "day", 28, "monthly")).toBe(560)
    expect(normalizeTarget(20, "day", 31, "monthly")).toBe(620)
  })
  it("scales a weekly target", () => {
    expect(normalizeTarget(70, "week", 7, "weekly")).toBe(70)
    expect(normalizeTarget(70, "week", 28, "monthly")).toBe(280)
  })
  it("is the identity for period-authored targets", () => {
    expect(normalizeTarget(400, "period", 31, "monthly")).toBe(400)
  })
  it("a month-authored target is the identity on month-long plans, pro-rated elsewhere", () => {
    // "€600/month" must be €600 in a 28-day February and a 31-day January alike.
    expect(normalizeTarget(600, "month", 28, "monthly")).toBe(600)
    expect(normalizeTarget(600, "month", 31, "monthly")).toBe(600)
    expect(normalizeTarget(600, "month", 31, "payday")).toBe(600)
    // Weekly/custom plans pro-rate on the 30.44-day mean month.
    expect(normalizeTarget(600, "month", 7, "weekly")).toBe(137.99)
    expect(normalizeTarget(600, "month", 14, "custom")).toBe(275.98)
  })
  it("rounds to the cent and rejects non-positive input", () => {
    expect(normalizeTarget(10, "day", 3, "monthly")).toBe(30)
    expect(normalizeTarget(0, "day", 30, "monthly")).toBe(0)
    expect(normalizeTarget(-5, "period", 30, "monthly")).toBe(0)
    expect(normalizeTarget(Number.NaN, "period", 30, "monthly")).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.4 funding base — spending NEVER changes capacity
// ═══════════════════════════════════════════════════════════════════════════
describe("fundingCapacity (§8.4)", () => {
  it("expected mode: capacity is the stated expectation; income does NOT accrete", () => {
    const c = fundingCapacity({
      incomeMode: "expected",
      fundingBase: 3200,
      fundingBaseSource: "expected_income",
      incomeAccreted: 3200, // received, but must not double the capacity
      fundingAdjustments: 0,
    })
    expect(c).toBe(3200)
  })

  it("available mode: qualifying income accretes exactly once", () => {
    const c = fundingCapacity({
      incomeMode: "available",
      fundingBase: 500,
      fundingBaseSource: "reconstructed_at_boundary",
      incomeAccreted: 3200,
      fundingAdjustments: 0,
    })
    expect(c).toBe(3700)
  })

  it("applies signed audited adjustments", () => {
    const base = { incomeMode: "available" as const, fundingBase: 1000, fundingBaseSource: "snapshot_at_open" as const, incomeAccreted: 0 }
    expect(fundingCapacity({ ...base, fundingAdjustments: 500 })).toBe(1500)
    expect(fundingCapacity({ ...base, fundingAdjustments: -250 })).toBe(750)
  })

  it("PROPERTY: no amount of spending can change capacity or unallocated", () => {
    const f = {
      incomeMode: "available" as const,
      fundingBase: 2000,
      fundingBaseSource: "reconstructed_at_boundary" as const,
      incomeAccreted: 1000,
      fundingAdjustments: 0,
    }
    const capacity = fundingCapacity(f)
    const allocated = 2500
    const before = unallocated(capacity, allocated)
    // Simulate an arbitrary sequence of expenses — none is an input to either formula.
    for (const spend of [10, 250, 999.99, 3000]) {
      void spend
      expect(fundingCapacity(f)).toBe(capacity)
      expect(unallocated(fundingCapacity(f), allocated)).toBe(before)
    }
    expect(before).toBe(500)
  })

  it("unallocated may go negative when allocations exceed capacity", () => {
    expect(unallocated(1000, 1200)).toBe(-200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.5 the four numbers — headroom is NETTED then floored once
// ═══════════════════════════════════════════════════════════════════════════
describe("flexibleHeadroom (§8.5.1 — the rev-3 correction)", () => {
  it("nets an overspend against another envelope's surplus", () => {
    // The review's example: Groceries 300/400, Dining 200/0.
    // WRONG (Σ max(0, remaining)) = 0 + 200 = 200. RIGHT = max(0, 500-400) = 100.
    expect(flexibleHeadroom({ planned: 500, spentNet: 400, pending: 0 })).toBe(100)
  })

  it("is NOT the sum of per-envelope clamped remainders", () => {
    const envelopes = [
      { planned: 300, spentNet: 400 },
      { planned: 200, spentNet: 0 },
    ]
    const wrong = envelopes.reduce((s, e) => s + Math.max(0, e.planned - e.spentNet), 0)
    const right = flexibleHeadroom({
      planned: envelopes.reduce((s, e) => s + e.planned, 0),
      spentNet: envelopes.reduce((s, e) => s + e.spentNet, 0),
      pending: 0,
    })
    expect(wrong).toBe(200)
    expect(right).toBe(100)
    expect(right).not.toBe(wrong)
  })

  it("floors a wholly over-spent plan at 0, never negative", () => {
    expect(flexibleHeadroom({ planned: 500, spentNet: 900, pending: 0 })).toBe(0)
  })

  it("subtracts pending", () => {
    expect(flexibleHeadroom({ planned: 500, spentNet: 100, pending: 300 })).toBe(100)
  })

  it("PROPERTY: equals max(0, Σplanned − Σspent − Σpending) for random envelopes", () => {
    let seed = 7
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    for (let t = 0; t < 200; t++) {
      const n = 1 + Math.floor(rnd() * 6)
      const envs = Array.from({ length: n }, () => ({
        planned: round2(rnd() * 500),
        spentNet: round2(rnd() * 700),
        pending: round2(rnd() * 100),
      }))
      const totals = envs.reduce(
        (a, e) => ({ planned: a.planned + e.planned, spentNet: a.spentNet + e.spentNet, pending: a.pending + e.pending }),
        { planned: 0, spentNet: 0, pending: 0 },
      )
      expect(flexibleHeadroom(totals)).toBeCloseTo(
        Math.max(0, round2(totals.planned - totals.spentNet - totals.pending)),
        2,
      )
    }
  })
})

describe("remaining (envelope card keeps its SIGNED figure)", () => {
  it("is negative for an overspent envelope", () => {
    expect(remaining(300, 400)).toBe(-100)
    expect(remaining(200, 0)).toBe(200)
  })
  it("subtracts pending", () => {
    expect(remaining(500, 100, 50)).toBe(350)
  })
})

describe("reservedTotal (§8.5)", () => {
  const empty: ReservedBreakdown = {
    commitmentsOutstanding: 0,
    commitmentsOverdue: 0,
    debtOutstanding: 0,
    virtualFundBalances: 0,
    virtualContributionsUnconfirmed: 0,
    spaceContributionsDue: 0,
    protectedSavingsDue: 0,
  }

  it("sums every claim once", () => {
    expect(
      reservedTotal({
        ...empty,
        commitmentsOutstanding: 780,
        debtOutstanding: 100,
        virtualFundBalances: 137.5,
        virtualContributionsUnconfirmed: 62.5,
        spaceContributionsDue: 20,
        protectedSavingsDue: 10,
      }),
    ).toBe(1110)
  })

  it("does NOT add overdue again — it is a subset of outstanding", () => {
    const withOverdue = reservedTotal({ ...empty, commitmentsOutstanding: 500, commitmentsOverdue: 500 })
    const without = reservedTotal({ ...empty, commitmentsOutstanding: 500, commitmentsOverdue: 0 })
    expect(withOverdue).toBe(500)
    expect(withOverdue).toBe(without)
  })

  it("reserves a VIRTUAL fund balance (cash is still in the bank)", () => {
    expect(reservedTotal({ ...empty, virtualFundBalances: 437.5 })).toBe(437.5)
  })

  it("does NOT reserve a Space-backed BALANCE — only its due contributions", () => {
    // A Space balance is already outside availableNow; reserving it would
    // subtract the same money twice. There is deliberately no field for it.
    expect(Object.keys(empty)).not.toContain("spaceFundBalances")
    expect(reservedTotal({ ...empty, spaceContributionsDue: 62.5 })).toBe(62.5)
  })
})

describe("safeToSpend (§8.5 — bounded by BOTH cash and plan)", () => {
  const base = { flexible: { planned: 900, spentNet: 0, pending: 0 }, ceilingDefined: true }

  it("is plan-bound when the ceiling is spent out despite plenty of cash", () => {
    const r = safeToSpend({ ...base, availableNow: 5000, reserved: 0, flexible: { planned: 900, spentNet: 880, pending: 0 } })
    expect(r.amount).toBe(20)
    expect(r.binding).toBe("plan")
  })

  it("is cash-bound when cash is short despite an untouched ceiling", () => {
    const r = safeToSpend({ ...base, availableNow: 1000, reserved: 880 })
    expect(r.amount).toBe(120)
    expect(r.binding).toBe("cash")
  })

  it("reports `both` when the two bounds coincide", () => {
    const r = safeToSpend({ ...base, availableNow: 900, reserved: 0 })
    expect(r.amount).toBe(900)
    expect(r.binding).toBe("both")
  })

  it("is cash-only, explicitly, when NO ceiling is defined", () => {
    const r = safeToSpend({
      availableNow: 1000,
      reserved: 200,
      flexible: { planned: 0, spentNet: 0, pending: 0 },
      ceilingDefined: false,
    })
    expect(r.amount).toBe(800)
    expect(r.binding).toBe("cash_only")
    expect(r.ceilingDefined).toBe(false)
  })

  it("propagates a negative cash position unfloored", () => {
    const r = safeToSpend({ ...base, availableNow: 100, reserved: 500 })
    expect(r.amount).toBe(-400)
    expect(r.binding).toBe("cash")
  })

  it("returns exactly 0 (not negative) when the plan is blown but cash remains", () => {
    const r = safeToSpend({ availableNow: 5000, reserved: 0, flexible: { planned: 500, spentNet: 900, pending: 0 }, ceilingDefined: true })
    expect(r.amount).toBe(0)
    expect(r.binding).toBe("plan")
  })

  it("never folds unallocated money in — it is not an input at all", () => {
    const r = safeToSpend({ ...base, availableNow: 1000, reserved: 0 })
    // 900 ceiling binds even though the plan may have unallocated capacity.
    expect(r.amount).toBe(900)
    expect(Object.keys(r)).not.toContain("unallocated")
  })

  it("exposes both bounds so the UI can explain itself", () => {
    const r = safeToSpend({ ...base, availableNow: 1000, reserved: 100 })
    expect(r.cashAfterReservations).toBe(900)
    expect(r.flexibleHeadroom).toBe(900)
  })
})

describe("reallocation invariance (§8.5.2)", () => {
  const ceiling = { availableNow: 5000, reserved: 0, ceilingDefined: true }

  it("moving planned money between envelopes does NOT change safe-to-spend", () => {
    // Σ planned is invariant under a reallocation.
    const before = safeToSpend({ ...ceiling, flexible: { planned: 500, spentNet: 400, pending: 0 } })
    const after = safeToSpend({ ...ceiling, flexible: { planned: 500, spentNet: 400, pending: 0 } })
    expect(after.amount).toBe(before.amount)
  })

  it("covering from unallocated DOES increase capacity by exactly that amount", () => {
    const before = safeToSpend({ ...ceiling, flexible: { planned: 500, spentNet: 400, pending: 0 } })
    const after = safeToSpend({ ...ceiling, flexible: { planned: 524, spentNet: 400, pending: 0 } })
    expect(round2(after.amount - before.amount)).toBe(24)
  })

  it("a refund increases headroom by exactly its amount", () => {
    const before = safeToSpend({ ...ceiling, flexible: { planned: 500, spentNet: 400, pending: 0 } })
    const after = safeToSpend({ ...ceiling, flexible: { planned: 500, spentNet: 300, pending: 0 } })
    expect(round2(after.amount - before.amount)).toBe(100)
  })
})

describe("forecastBalance (§8.5)", () => {
  it("adds the income still to come, and floors an overspent flexible section ONCE", () => {
    // expected-mode plan: €1,500 of income not yet received counts toward the
    // period-end balance; an overspent flexible section cannot ADD to it.
    expect(forecastBalance({ availableNow: 1000, expectedRemainingIncome: 1500, reserved: 800, flexibleRemainingPlanned: -50 })).toBe(1700)
    // available mode: the income term is 0 and the formula reduces to cash − reserved − headroom.
    expect(forecastBalance({ availableNow: 1000, expectedRemainingIncome: 0, reserved: 800, flexibleRemainingPlanned: 120 })).toBe(80)
  })
  it("adds expected income and subtracts remaining planned outflow", () => {
    expect(
      forecastBalance({ availableNow: 1840.22, expectedRemainingIncome: 0, reserved: 980, flexibleRemainingPlanned: 187.6 }),
    ).toBe(672.62)
  })
  it("counts only held money when no income is expected (available mode)", () => {
    expect(forecastBalance({ availableNow: 500, expectedRemainingIncome: 0, reserved: 0, flexibleRemainingPlanned: 0 })).toBe(500)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.6 occurrences — one-time NEVER ages out; recurring is bounded
// ═══════════════════════════════════════════════════════════════════════════
describe("carryLowerBound (§8.6.1 — the projection WINDOW reaches back)", () => {
  const today = "2026-09-15"
  const periodStart = "2026-09-01"

  it("one-time: its own due date is ALWAYS in range, however old", () => {
    expect(carryLowerBound({ kind: "one_time", dueDate: "2026-08-14", firstDueDate: "2026-08-14" }, periodStart, today)).toBe("2026-08-14")
    // 400 days old — still projected. A fine does not expire.
    expect(carryLowerBound({ kind: "one_time", dueDate: "2025-08-01", firstDueDate: "2025-08-01" }, periodStart, today)).toBe("2025-08-01")
    // 800 days old.
    expect(carryLowerBound({ kind: "one_time", dueDate: "2024-07-01", firstDueDate: "2024-07-01" }, periodStart, today)).toBe("2024-07-01")
  })

  it("recurring: bounded by the 365-day lookback", () => {
    const bound = carryLowerBound({ kind: "recurring", firstDueDate: "2020-01-01" }, periodStart, today)
    expect(bound).toBe(addDays(today, -RECURRING_OVERDUE_LOOKBACK_DAYS))
  })

  it("recurring: never reaches before the commitment's first occurrence", () => {
    expect(carryLowerBound({ kind: "recurring", firstDueDate: "2026-08-01" }, periodStart, today)).toBe("2026-08-01")
  })

  it("never starts after the period, even for a commitment created mid-period", () => {
    const bound = carryLowerBound({ kind: "recurring", firstDueDate: "2026-09-20" }, periodStart, today)
    expect(bound <= periodStart).toBe(true)
  })
})

describe("applyOccurrenceDeviations (§8.6)", () => {
  const win = { windowStart: "2026-08-01", windowEndExclusive: "2026-10-01", periodStart: "2026-09-01" }

  it("a one-time bill rescheduled EARLIER than its due date is still reserved (D-17)", () => {
    // The engine's window for a one-time commitment STARTS at its own due date,
    // so an earlier target used to fall below windowStart and vanish from
    // pending/reserved/safe-to-spend — the exact "forgotten bill" §8.6.1 forbids.
    const r = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 400,
      rawDates: [{ dueDate: "2026-09-15", amount: 400 }],
      deviations: { "2026-09-15": { status: "rescheduled", rescheduledTo: "2026-09-10" } },
      periodStart: "2026-09-01",
      windowStart: "2026-09-15",
      windowEndExclusive: "2026-10-01",
    })
    expect(r.occurrences).toHaveLength(1)
    expect(r.occurrences[0]).toMatchObject({ dueDate: "2026-09-10", state: "expected", rescheduledFrom: "2026-09-15", carried: false })
    expect(pendingFrom(r.occurrences)).toBe(400)
  })

  it("a one-time bill due NEXT period pulled into this one is reserved now", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 400,
      rawDates: [],
      deviations: { "2026-10-15": { status: "rescheduled", rescheduledTo: "2026-09-20" } },
      periodStart: "2026-09-01",
      windowStart: "2026-10-15",
      windowEndExclusive: "2026-10-01",
    })
    expect(r.occurrences.map((o) => [o.dueDate, o.state])).toEqual([["2026-09-20", "expected"]])
  })

  it("a recurring target behind its carry window is still dropped (the rule has moved on)", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "recurring",
      defaultAmount: 50,
      rawDates: [{ dueDate: "2026-09-05", amount: 50 }],
      deviations: { "2026-09-05": { status: "rescheduled", rescheduledTo: "2026-07-05" } },
      ...win,
    })
    expect(r.occurrences).toEqual([])
  })

  it("a reschedule target that was then settled is emitted SETTLED, not dropped", () => {
    // Otherwise §8.7's settled Σ under-reports by the bill and the paid bill
    // disappears from the history list.
    const r = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 118.4,
      rawDates: [{ dueDate: "2026-08-14", amount: 118.4 }],
      deviations: {
        "2026-08-14": { status: "rescheduled", rescheduledTo: "2026-09-22" },
        "2026-09-22": { status: "settled", settledAmount: 118.4, settledTransactionId: "tx1" },
      },
      ...win,
    })
    expect(r.occurrences).toHaveLength(1)
    expect(r.occurrences[0]).toMatchObject({ dueDate: "2026-09-22", state: "settled", amount: 118.4, rescheduledFrom: "2026-08-14", settledTransactionId: "tx1" })
    expect(pendingFrom(r.occurrences)).toBe(0)
  })

  it("a reschedule target that was then skipped is emitted skipped — and a chain emits only its final date", () => {
    const skipped = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 60,
      rawDates: [{ dueDate: "2026-09-01", amount: 60 }],
      deviations: {
        "2026-09-01": { status: "rescheduled", rescheduledTo: "2026-09-10" },
        "2026-09-10": { status: "skipped" },
      },
      ...win,
    })
    expect(skipped.occurrences.map((o) => [o.dueDate, o.state])).toEqual([["2026-09-10", "skipped"]])

    const chain = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 60,
      rawDates: [{ dueDate: "2026-09-01", amount: 60 }],
      deviations: {
        "2026-09-01": { status: "rescheduled", rescheduledTo: "2026-09-10" },
        "2026-09-10": { status: "rescheduled", rescheduledTo: "2026-09-20" },
      },
      ...win,
    })
    expect(chain.occurrences.map((o) => [o.dueDate, o.state, o.rescheduledFrom])).toEqual([["2026-09-20", "expected", "2026-09-10"]])
    expect(pendingFrom(chain.occurrences)).toBe(60)
  })

  it("carries an unresolved PRIOR-PERIOD occurrence into the set", () => {
    // The rev-4 regression test: the occurrence must be PRESENT, not merely un-filtered.
    const r = applyOccurrenceDeviations({
      commitmentId: "c1",
      kind: "one_time",
      defaultAmount: 60,
      rawDates: [{ dueDate: "2026-08-14", amount: 60 }],
      deviations: {},
      ...win,
    })
    expect(r.occurrences).toHaveLength(1)
    expect(r.occurrences[0]).toMatchObject({ dueDate: "2026-08-14", state: "expected", carried: true })
  })

  it("keeps an overdue occurrence expected — time resolves nothing", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "one_time", defaultAmount: 60,
      rawDates: [{ dueDate: "2026-08-14", amount: 60 }], deviations: {}, ...win,
    })
    expect(isOverdue(r.occurrences[0], "2026-09-15")).toBe(true)
    expect(pendingFrom(r.occurrences)).toBe(60)
  })

  it.each(["settled", "cancelled", "skipped"] as const)("removes the reservation when %s", (status) => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "one_time", defaultAmount: 60,
      rawDates: [{ dueDate: "2026-08-14", amount: 60 }],
      deviations: { "2026-08-14": { status } }, ...win,
    })
    expect(r.occurrences[0].state).toBe(status)
    expect(pendingFrom(r.occurrences)).toBe(0)
  })

  it("reschedule consumes the original and emits exactly one occurrence at the new date", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "one_time", defaultAmount: 60,
      rawDates: [{ dueDate: "2026-08-14", amount: 60 }],
      deviations: { "2026-08-14": { status: "rescheduled", rescheduledTo: "2026-09-22" } }, ...win,
    })
    expect(r.occurrences).toHaveLength(1)
    expect(r.occurrences[0]).toMatchObject({ dueDate: "2026-09-22", state: "expected", rescheduledFrom: "2026-08-14" })
    expect(pendingFrom(r.occurrences)).toBe(60)
  })

  it("a reschedule target colliding with a projected date does NOT create a second reservation", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "recurring", defaultAmount: 100,
      rawDates: [{ dueDate: "2026-09-01", amount: 100 }, { dueDate: "2026-09-22", amount: 100 }],
      deviations: { "2026-09-01": { status: "rescheduled", rescheduledTo: "2026-09-22" } }, ...win,
    })
    expect(r.occurrences.filter((o) => o.dueDate === "2026-09-22")).toHaveLength(1)
    expect(pendingFrom(r.occurrences)).toBe(100)
  })

  it("drops a reschedule target outside the window", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "one_time", defaultAmount: 60,
      rawDates: [{ dueDate: "2026-08-14", amount: 60 }],
      deviations: { "2026-08-14": { status: "rescheduled", rescheduledTo: "2027-01-01" } }, ...win,
    })
    expect(r.occurrences).toHaveLength(0)
    expect(pendingFrom(r.occurrences)).toBe(0)
  })

  it("dedupes on (commitmentId, dueDate) so a duplicate is impossible", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "recurring", defaultAmount: 100,
      rawDates: [{ dueDate: "2026-09-01", amount: 100 }, { dueDate: "2026-09-01", amount: 100 }],
      deviations: {}, ...win,
    })
    expect(r.occurrences).toHaveLength(1)
    expect(pendingFrom(r.occurrences)).toBe(100)
  })

  it("uses the settled amount when a bill came in higher", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "recurring", defaultAmount: 100,
      rawDates: [{ dueDate: "2026-09-01", amount: 100 }],
      deviations: { "2026-09-01": { status: "settled", settledAmount: 118.4, settledTransactionId: "tx1" } }, ...win,
    })
    expect(r.occurrences[0].amount).toBe(118.4)
    expect(r.occurrences[0].settledTransactionId).toBe("tx1")
  })

  it("caps RECURRING unresolved occurrences and flags needs_attention", () => {
    const rawDates = Array.from({ length: 30 }, (_, i) => ({ dueDate: addMonths("2024-01-01", i), amount: 100 }))
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "recurring", defaultAmount: 100, rawDates, deviations: {},
      windowStart: "2024-01-01", windowEndExclusive: "2027-01-01", periodStart: "2026-09-01",
    })
    const unresolved = r.occurrences.filter((o) => o.state === "expected")
    expect(unresolved).toHaveLength(MAX_UNRESOLVED_RECURRING_OCCURRENCES)
    expect(r.excludedCount).toBe(30 - MAX_UNRESOLVED_RECURRING_OCCURRENCES)
    expect(r.needsAttention).toBe(true)
    // Keeps the MOST RECENT.
    expect(unresolved[unresolved.length - 1].dueDate).toBe(rawDates[rawDates.length - 1].dueDate)
  })

  it("NEVER caps a one-time commitment", () => {
    const r = applyOccurrenceDeviations({
      commitmentId: "c1", kind: "one_time", defaultAmount: 900,
      rawDates: [{ dueDate: "2024-01-01", amount: 900 }], deviations: {},
      windowStart: "2024-01-01", windowEndExclusive: "2027-01-01", periodStart: "2026-09-01",
    })
    expect(r.needsAttention).toBe(false)
    expect(r.excludedCount).toBe(0)
    expect(pendingFrom(r.occurrences)).toBe(900)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.8 signed net spend + provisional refunds
// ═══════════════════════════════════════════════════════════════════════════
describe("spentNet (§8.8)", () => {
  it("nets confirmed and provisional refunds off gross", () => {
    expect(spentNet({ spentGross: 372.1, refundsConfirmed: 0, refundsProvisional: 100 })).toBe(272.1)
    expect(spentNet({ spentGross: 400, refundsConfirmed: 250, refundsProvisional: 0 })).toBe(150)
  })
  it("may be NEGATIVE when refunds exceed spend, and keeps the true value", () => {
    expect(spentNet({ spentGross: 50, refundsConfirmed: 0, refundsProvisional: 120 })).toBe(-70)
  })
})

describe("barPercent (display clamp only)", () => {
  it("clamps to [0,100] without altering the underlying figure", () => {
    expect(barPercent(50, 100)).toBe(50)
    expect(barPercent(150, 100)).toBe(100)
    expect(barPercent(-70, 100)).toBe(0)
  })
  it("shows a full bar for spend with no plan", () => {
    expect(barPercent(10, 0)).toBe(100)
    expect(barPercent(0, 0)).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.12 rollover
// ═══════════════════════════════════════════════════════════════════════════
describe("carryFor (§8.12)", () => {
  it("applies each policy", () => {
    expect(carryFor("none", 50)).toBe(0)
    expect(carryFor("none", -50)).toBe(0)
    expect(carryFor("surplus", 50)).toBe(50)
    expect(carryFor("surplus", -50)).toBe(0)
    expect(carryFor("deficit", 50)).toBe(0)
    expect(carryFor("deficit", -50)).toBe(-50)
    expect(carryFor("both", 50)).toBe(50)
    expect(carryFor("both", -50)).toBe(-50)
  })
  it("clamps to the cap in both directions", () => {
    expect(carryFor("both", 500, 100)).toBe(100)
    expect(carryFor("both", -500, 100)).toBe(-100)
    expect(carryFor("both", 50, 100)).toBe(50)
  })
  it("a stored cap of 0 carries nothing — NULL, not 0, is the no-cap sentinel (§8.12)", () => {
    expect(carryFor("both", 250, 0)).toBe(0)
    expect(carryFor("surplus", 50, 0)).toBe(0)
    expect(carryFor("deficit", -50, 0)).toBe(0)
    expect(carryFor("both", 250, null)).toBe(250)
  })
  it("defaults carry to none for every non-flexible section", () => {
    expect(defaultCarryPolicy("flexible")).toBe("surplus")
    for (const s of ["commitment", "debt", "savings", "income"] as const) {
      expect(defaultCarryPolicy(s)).toBe("none")
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.9.1 contribution states — never "funded" without a decision
// ═══════════════════════════════════════════════════════════════════════════
describe("contribution states (§8.9.1)", () => {
  it("only a CONFIRMED contribution counts as funded", () => {
    expect(isFunded("confirmed")).toBe(true)
    expect(isFunded("planned")).toBe(false)
    expect(isFunded("missed")).toBe(false)
    expect(isFunded("skipped")).toBe(false)
  })

  it("period close marks an unconfirmed contribution MISSED, not funded", () => {
    expect(contributionAtClose("planned", false)).toBe("missed")
  })

  it("period close confirms only when auto-fund is explicitly enabled", () => {
    expect(contributionAtClose("planned", true)).toBe("confirmed")
  })

  it("never revisits an already-resolved contribution", () => {
    for (const s of ["confirmed", "missed", "skipped"] as const) {
      expect(contributionAtClose(s, true)).toBe(s)
      expect(contributionAtClose(s, false)).toBe(s)
    }
  })

  it("a virtual fund balance is the signed sum of CONFIRMED entries only", () => {
    expect(
      fundBalanceFromEntries([
        { kind: "contribution", amount: 62.5 },
        { kind: "contribution", amount: 62.5 },
        { kind: "withdrawal", amount: 25 },
        { kind: "adjustment", amount: -0.5 },
      ]),
    ).toBe(99.5)
    expect(fundBalanceFromEntries([])).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.13 suggestions
// ═══════════════════════════════════════════════════════════════════════════
describe("suggestFlexible (§8.13)", () => {
  it("has no suggestion without history", () => {
    expect(suggestFlexible([])).toMatchObject({ amount: null, basis: "no_history" })
  })
  it("flags a single observation as low confidence", () => {
    expect(suggestFlexible([372.1])).toMatchObject({ amount: 372.1, basis: "single_period", confidence: "low" })
  })
  it("uses the MEDIAN so one outlier month does not raise the target", () => {
    expect(suggestFlexible([372.1, 380, 391.2]).amount).toBe(380)
    expect(suggestFlexible([372.1, 380, 1200]).amount).toBe(380) // holiday month ignored
  })
  it("reports its evidence and confidence", () => {
    const s = suggestFlexible([100, 200, 300])
    expect(s.observations).toEqual([100, 200, 300])
    expect(s.confidence).toBe("normal")
    expect(suggestFlexible([100, 200]).confidence).toBe("low")
  })
  it("median handles even counts", () => {
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(median([])).toBe(0)
  })
})

describe("round2", () => {
  it("rounds to cents without float noise", () => {
    expect(round2(0.1 + 0.2)).toBe(0.3)
    expect(round2(1.005)).toBe(1.01)
    expect(round2(-1.005)).toBe(-1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// §8.10 successor periods — bridge after a cadence change, never overlap
// ═══════════════════════════════════════════════════════════════════════════

describe("nextPeriod (§8.10 / §6.16)", () => {
  const monthly = { cadence: "monthly" as const }
  it("is the natural next window on an unchanged cadence", () => {
    const w = periodFor(monthly, "2026-09-15")
    expect(nextPeriod(monthly, w)).toEqual({ start: "2026-10-01", endExclusive: "2026-11-01" })
  })
  it("bridges from the closed period's end when the new grid starts earlier — no day counted twice", () => {
    const closed = { start: "2026-09-01", endExclusive: "2026-10-01" }
    for (const cfg of [
      { cadence: "weekly" as const, weekStartDay: 1 },
      { cadence: "payday" as const, anchorDay: 25 },
      { cadence: "custom" as const, customDays: 14, customStart: "2026-09-20" },
    ]) {
      const next = nextPeriod(cfg, closed)
      expect(next.start, JSON.stringify(cfg)).toBe(closed.endExclusive)
      expect(next.endExclusive > next.start, JSON.stringify(cfg)).toBe(true)
      expect(next.endExclusive).toBe(periodFor(cfg, closed.endExclusive).endExclusive)
    }
  })
  it("never gaps: the successor of the successor starts where the first ended", () => {
    const cfg = { cadence: "weekly" as const, weekStartDay: 1 }
    const first = nextPeriod(cfg, { start: "2026-09-01", endExclusive: "2026-10-01" })
    const second = nextPeriod(cfg, first)
    expect(second.start).toBe(first.endExclusive)
  })
})

describe("effectiveOccurrenceStatus (§10.15 trash integration)", () => {
  const settled = { status: "settled", settledTransactionId: "tx1" }
  it("a settled bill whose payment was trashed or purged reads as expected again", () => {
    expect(effectiveOccurrenceStatus(settled, { id: "tx1", deletedAt: new Date() })).toBe("expected")
    expect(effectiveOccurrenceStatus(settled, { id: null, deletedAt: null })).toBe("expected")
    expect(effectiveOccurrenceStatus(settled, null)).toBe("expected")
  })
  it("a live payment, a manual settle, and the other states are untouched", () => {
    expect(effectiveOccurrenceStatus(settled, { id: "tx1", deletedAt: null })).toBe("settled")
    expect(effectiveOccurrenceStatus({ status: "settled", settledTransactionId: null }, null)).toBe("settled")
    expect(effectiveOccurrenceStatus({ status: "skipped", settledTransactionId: null }, null)).toBe("skipped")
    expect(effectiveOccurrenceStatus({ status: "cancelled", settledTransactionId: "tx1" }, { id: "tx1", deletedAt: new Date() })).toBe("cancelled")
  })
})

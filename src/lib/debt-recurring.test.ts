import { describe, expect, it } from "vitest"
import { toCents } from "./debt-math"
import {
  advancesScheduleByDefault,
  DEBT_KIND_SUGGESTIONS,
  frequencyToRecurring,
  isSuggestedDebtKind,
  normalizeDebtKind,
  payoffCappedAmount,
  recurringToFrequency,
} from "./debt-recurring"

describe("normalizeDebtKind", () => {
  it("stores a suggestion as its key so it stays translated", () => {
    expect(normalizeDebtKind("Mortgage")).toBe("mortgage")
    expect(normalizeDebtKind("  CAR  ")).toBe("car")
  })

  it("keeps anything else exactly as typed", () => {
    expect(normalizeDebtKind("Chit fund")).toBe("Chit fund")
    expect(normalizeDebtKind("Shop credit")).toBe("Shop credit")
  })

  it("collapses whitespace and caps the length", () => {
    expect(normalizeDebtKind("shop    credit")).toBe("shop credit")
    expect(normalizeDebtKind("x".repeat(90))).toHaveLength(40)
  })

  it("falls back to other rather than rejecting — the kind is a label, never a gate", () => {
    expect(normalizeDebtKind("")).toBe("other")
    expect(normalizeDebtKind("   ")).toBe("other")
    expect(normalizeDebtKind(null)).toBe("other")
    expect(normalizeDebtKind(42)).toBe("other")
  })

  it("recognises every suggestion", () => {
    for (const k of DEBT_KIND_SUGGESTIONS) expect(isSuggestedDebtKind(k)).toBe(true)
    expect(isSuggestedDebtKind("chit fund")).toBe(false)
  })
})

describe("frequency conversion", () => {
  it("round-trips every named rhythm", () => {
    for (const f of ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const) {
      const freq = frequencyToRecurring(f)
      expect(freq).not.toBeNull()
      expect(recurringToFrequency(freq!.unit, freq!.interval)).toBe(f)
    }
  })

  it("has no rule for an irregular debt", () => {
    expect(frequencyToRecurring("irregular")).toBeNull()
    expect(frequencyToRecurring(null)).toBeNull()
  })

  it("maps biweekly to two weeks and quarterly to three months", () => {
    expect(frequencyToRecurring("biweekly")).toEqual({ unit: "week", interval: 2 })
    expect(frequencyToRecurring("quarterly")).toEqual({ unit: "month", interval: 3 })
  })

  it("returns null for a rhythm the debt vocabulary cannot name", () => {
    expect(recurringToFrequency("day", 10)).toBeNull()
    expect(recurringToFrequency("month", 5)).toBeNull()
  })
})

describe("payoffCappedAmount", () => {
  const monthly = { frequency: "monthly" as const, annualRatePct: 12 }

  it("pays the full instalment while plenty is owed", () => {
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: toCents(10_000), ...monthly })).toBe(toCents(500))
  })

  it("caps the last instalment at the payoff amount, not the scheduled one", () => {
    // 120 owed at 12 % → one month's interest is 1.20, so the loan closes at 121.20.
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: toCents(120), ...monthly })).toBe(toCents(121.2))
  })

  it("caps at the balance itself when no rate is known", () => {
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: toCents(120), annualRatePct: null, frequency: "monthly" }))
      .toBe(toCents(120))
  })

  it("returns 0 when nothing is owed, so the caller posts nothing", () => {
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: 0, ...monthly })).toBe(0)
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: toCents(-40), ...monthly })).toBe(0)
  })

  it("returns 0 for a rule with no amount", () => {
    expect(payoffCappedAmount({ scheduled: 0, outstanding: toCents(900), ...monthly })).toBe(0)
  })

  it("never exceeds the scheduled amount, even on a huge balance", () => {
    expect(payoffCappedAmount({ scheduled: toCents(500), outstanding: toCents(1_000_000), ...monthly })).toBe(toCents(500))
  })

  it("uses the rule's own rhythm for the final period's interest", () => {
    // 52 % annual on 1000: a weekly period accrues 1/52 of it (10.00), a monthly
    // period 1/12 (43.33). The payoff figure has to follow the rule's rhythm.
    const at = (frequency: "weekly" | "monthly") =>
      payoffCappedAmount({ scheduled: toCents(2000), outstanding: toCents(1000), annualRatePct: 52, frequency })
    expect(at("weekly")).toBe(toCents(1010))
    expect(at("monthly")).toBe(toCents(1043.33))
  })
})

describe("advancesScheduleByDefault", () => {
  it("a hand-recorded payment is EXTRA while a rule owns the schedule", () => {
    expect(advancesScheduleByDefault(true)).toBe(false)
  })

  it("without a rule the payment the user records IS the scheduled one", () => {
    expect(advancesScheduleByDefault(false)).toBe(true)
  })
})

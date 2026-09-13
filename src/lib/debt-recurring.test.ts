import { describe, expect, it } from "vitest"
import { amortize, fromCents, toCents } from "./debt-math"
import {
  advancesScheduleByDefault,
  repaymentCursor,
  linkRefusal,
  isLinkable,
  type LinkCandidateRule,
  type LinkTargetDebt,
  DEBT_KIND_SUGGESTIONS,
  frequencyToRecurring,
  isSuggestedDebtKind,
  normalizeDebtKind,
  payoffCappedAmount,
  periodsPerYearForRule,
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

describe("repaymentCursor", () => {
  const TODAY = "2026-09-13"
  const monthly = { unit: "month" as const, interval: 1 }
  const live = { startDate: "2026-01-15", frequencyUnit: "month" as const, frequencyInterval: 1, nextDueAt: "2026-01-15", active: true }

  it("leaves the cursor alone when only the amount or the payer changed", () => {
    expect(repaymentCursor({ current: live, startDate: "2026-01-15", freq: monthly, wantActive: true, today: TODAY }))
      .toBe("2026-01-15")
  })

  it("re-anchors forward when the schedule changed", () => {
    expect(repaymentCursor({ current: live, startDate: "2026-02-20", freq: monthly, wantActive: true, today: TODAY }))
      .toBe(TODAY)
    expect(repaymentCursor({ current: live, startDate: "2026-01-15", freq: { unit: "week", interval: 2 }, wantActive: true, today: TODAY }))
      .toBe(TODAY)
  })

  it("RESUMING re-anchors to today — a payment holiday must not back-post in one click", () => {
    const paused = { ...live, active: false }
    expect(repaymentCursor({ current: paused, startDate: "2026-01-15", freq: monthly, wantActive: true, today: TODAY }))
      .toBe(TODAY)
  })

  it("but pausing leaves the cursor where it is", () => {
    expect(repaymentCursor({ current: live, startDate: "2026-01-15", freq: monthly, wantActive: false, today: TODAY }))
      .toBe("2026-01-15")
  })

  it("an already-active rule is not 'resuming', so editing it never moves the cursor", () => {
    expect(repaymentCursor({ current: live, startDate: "2026-01-15", freq: monthly, wantActive: true, today: TODAY }))
      .toBe("2026-01-15")
  })

  it("a future first payment keeps its own date rather than snapping to today", () => {
    expect(repaymentCursor({ current: null, startDate: "2026-12-01", freq: monthly, wantActive: true, today: TODAY }))
      .toBe("2026-12-01")
  })

  it("a brand new rule starts at the later of its anchor and today", () => {
    expect(repaymentCursor({ current: null, startDate: "2020-01-01", freq: monthly, wantActive: true, today: TODAY }))
      .toBe(TODAY)
  })

  it("a rhythm the debt vocabulary cannot name is NOT a schedule change", () => {
    // "every 10 days" is reachable from /api/recurring/:id. Pause and Resume
    // must not quietly turn it into a monthly rule.
    const tenDaily = { ...live, frequencyUnit: "day" as const, frequencyInterval: 10, active: false }
    const cursor = repaymentCursor({ current: tenDaily, startDate: "2026-01-15", freq: { unit: "day", interval: 10 }, wantActive: true, today: TODAY })
    expect(cursor).toBe(TODAY) // re-anchored because it is RESUMING, not because the rhythm moved
    const editAmountOnly = repaymentCursor({ current: { ...tenDaily, active: true }, startDate: "2026-01-15", freq: { unit: "day", interval: 10 }, wantActive: true, today: TODAY })
    expect(editAmountOnly).toBe("2026-01-15")
  })
})

describe("periodsPerYearForRule", () => {
  it("agrees with the named rhythms", () => {
    expect(periodsPerYearForRule("week", 1)).toBe(52)
    expect(periodsPerYearForRule("week", 2)).toBe(26)
    expect(periodsPerYearForRule("month", 1)).toBe(12)
    expect(periodsPerYearForRule("month", 3)).toBe(4)
    expect(periodsPerYearForRule("year", 1)).toBe(1)
  })

  it("answers for the rhythms the debt vocabulary cannot name", () => {
    expect(periodsPerYearForRule("day", 10)).toBe(36.5)
    expect(periodsPerYearForRule("month", 6)).toBe(2)
    expect(periodsPerYearForRule("week", 3)).toBeCloseTo(17.333, 3)
    expect(periodsPerYearForRule("day", 1)).toBe(365)
  })

  it("never divides by zero", () => {
    expect(periodsPerYearForRule("month", 0)).toBe(12)
    expect(periodsPerYearForRule("month", -3)).toBe(12)
  })
})

describe("payoffCappedAmount with a rule's true rhythm", () => {
  it("charges ten days of interest for a ten-day rhythm, not a month", () => {
    // 10,000 at 12 %: a month accrues 100.00, ten days accrue 32.88.
    const tenDay = payoffCappedAmount({
      scheduled: toCents(50_000), outstanding: toCents(10_000), annualRatePct: 12,
      frequency: "irregular", periodsPerYear: periodsPerYearForRule("day", 10),
    })
    expect(fromCents(tenDay)).toBe(10_032.88)
    // Without the override the "irregular" fallback would charge a whole month.
    const guessed = payoffCappedAmount({
      scheduled: toCents(50_000), outstanding: toCents(10_000), annualRatePct: 12, frequency: "irregular",
    })
    expect(fromCents(guessed)).toBe(10_100)
  })

  it("the override wins over a named frequency too", () => {
    const halfYearly = payoffCappedAmount({
      scheduled: toCents(50_000), outstanding: toCents(10_000), annualRatePct: 12,
      frequency: "monthly", periodsPerYear: periodsPerYearForRule("month", 6),
    })
    expect(fromCents(halfYearly)).toBe(10_600) // six months of interest
  })
})

describe("linkRefusal", () => {
  const rule = (over: Partial<LinkCandidateRule> = {}): LinkCandidateRule => ({
    id: "r1", kind: "standard", type: "outgoing", cardId: null,
    accountId: "bank", accountType: "bank", accountArchived: false, debtAccountId: null, ...over,
  })
  const debt = (over: Partial<LinkTargetDebt> = {}): LinkTargetDebt => ({
    id: "d1", direction: "owed", archived: false, linkedRuleIds: [], ...over,
  })

  it("adopts an ordinary outgoing rule paid from a bank", () => {
    expect(linkRefusal(rule(), debt())).toBeNull()
    expect(isLinkable(rule(), debt())).toBe(true)
  })

  it("adopts a cash-funded rule too", () => {
    expect(linkRefusal(rule({ accountType: "cash" }), debt())).toBeNull()
  })

  it("refuses a Space auto-save — it belongs to the Space", () => {
    expect(linkRefusal(rule({ kind: "transfer" }), debt())).toBe("rule_is_autosave")
  })

  it("refuses a rule that pays with a card", () => {
    expect(linkRefusal(rule({ cardId: "c1" }), debt())).toBe("rule_pays_with_card")
  })

  it("refuses a rule with no account, or an archived one", () => {
    expect(linkRefusal(rule({ accountId: null }), debt())).toBe("rule_has_no_account")
    expect(linkRefusal(rule({ accountArchived: true }), debt())).toBe("account_archived")
  })

  it("refuses anything that is not bank or cash", () => {
    for (const t of ["credit_card", "space", "loan", "receivable", null]) {
      expect(linkRefusal(rule({ accountType: t }), debt())).toBe("account_not_cash")
    }
  })

  it("REFUSES a direction mismatch rather than flipping it", () => {
    // The whole point: silently flipping an incoming salary rule dropped on a
    // loan would start taking that money OUT of the account every month.
    expect(linkRefusal(rule({ type: "incoming" }), debt({ direction: "owed" }))).toBe("direction_mismatch")
    expect(linkRefusal(rule({ type: "outgoing" }), debt({ direction: "receivable" }))).toBe("direction_mismatch")
  })

  it("a receivable is COLLECTED, so it wants an incoming rule", () => {
    expect(linkRefusal(rule({ type: "incoming" }), debt({ direction: "receivable" }))).toBeNull()
  })

  it("refuses a closed debt", () => {
    expect(linkRefusal(rule(), debt({ archived: true }))).toBe("debt_closed")
  })

  it("allows only ONE repayment per debt — even a PAUSED one still counts", () => {
    // Counting only active siblings let a debt collect a second rule while the
    // first was paused; resuming then paid it twice a month.
    expect(linkRefusal(rule({ id: "r1" }), debt({ linkedRuleIds: ["r9"] }))).toBe("repayment_exists")
  })

  it("refuses a rule whose end date has passed — nothing would ever fire", () => {
    expect(linkRefusal(rule({ ended: true }), debt())).toBe("rule_ended")
  })

  it("refuses a rule with instalments still waiting to post", () => {
    // Linking moves the cursor forward, so those would be recorded in neither
    // shape: not as the expenses they were, not as the repayments they were not.
    expect(linkRefusal(rule({ hasPending: true }), debt())).toBe("rule_has_pending")
  })

  it("but re-linking the rule that is ALREADY the repayment is fine", () => {
    // Re-pointing a rule at the same debt (e.g. saving the form again) must not
    // trip the one-repayment guard against itself.
    expect(linkRefusal(rule({ id: "r1", kind: "debt", debtAccountId: "d1" }), debt({ linkedRuleIds: ["r1"] }))).toBeNull()
  })

  it("REFUSES a rule that is already servicing another debt", () => {
    // Moving it would leave the other debt with a payment amount, a due date and
    // a place in the planner describing a rule that had quietly walked away.
    expect(linkRefusal(rule({ id: "r1", kind: "debt", debtAccountId: "other" }), debt({ id: "d1", linkedRuleIds: [] })))
      .toBe("rule_linked_elsewhere")
  })

  it("checks the debt before the rule's own shape, so 'closed' is what you hear", () => {
    // A closed debt cannot take a repayment however good the rule is.
    expect(linkRefusal(rule({ cardId: "c1" }), debt({ archived: true }))).toBe("debt_closed")
  })
})

describe("payoffCappedAmount agrees with the schedule on the last instalment", () => {
  // The engine and the schedule table must end a debt on the SAME instalment.
  // Capping at the scheduled amount left the rounding residue outstanding and
  // billed one more instalment for it — a payment no preview ever promised.
  it("folds a residue within the tolerance into the final payment", () => {
    // €500 left, 0% — one more period of €500 would leave €4 behind, and €4 is
    // inside finalPaymentTolerance(€500) = €10.
    const amount = payoffCappedAmount({
      scheduled: toCents(500),
      outstanding: toCents(504),
      annualRatePct: null,
      frequency: "monthly",
    })
    expect(amount).toBe(toCents(504))
  })

  it("still pays only the scheduled amount when the residue is a real instalment", () => {
    const amount = payoffCappedAmount({
      scheduled: toCents(500),
      outstanding: toCents(700),
      annualRatePct: null,
      frequency: "monthly",
    })
    expect(amount).toBe(toCents(500))
  })

  it("matches the schedule's own final row", () => {
    const owed = toCents(1_000)
    const scheduled = toCents(104)
    const plan = amortize({ balance: owed, annualRatePct: 0, payment: scheduled })
    // Walk the engine's cap the way postDebtOccurrences does and count instalments.
    let balance = owed
    let engineCount = 0
    while (balance > 0 && engineCount < 50) {
      const pay = payoffCappedAmount({ scheduled, outstanding: balance, annualRatePct: 0, frequency: "monthly" })
      balance -= pay
      engineCount++
    }
    expect(engineCount).toBe(plan.periods)
  })
})

describe("a debt's lifecycle in the link predicate", () => {
  const rule = {
    id: "r1",
    kind: "standard" as const,
    type: "outgoing" as const,
    cardId: null,
    accountId: "bank",
    accountType: "bank",
    accountArchived: false,
    debtAccountId: null,
  }
  const debt = { id: "d1", direction: "owed" as const, archived: false, linkedRuleIds: [] }

  it("accepts an active debt", () => {
    expect(linkRefusal(rule, { ...debt, lifecycle: "active" })).toBeNull()
  })

  it("accepts a PAUSED debt — the rule follows it and is stored inactive", () => {
    // Refusing here would break the debt screen's own "link an existing
    // repayment", which deliberately offers paused debts.
    expect(linkRefusal(rule, { ...debt, lifecycle: "paused" })).toBeNull()
  })

  it.each(["paid_off", "refinanced", "written_off"] as const)("refuses a %s debt", (lifecycle) => {
    expect(linkRefusal(rule, { ...debt, lifecycle })).toBe("debt_settled")
  })

  it("is unchanged when the caller has no lifecycle to give", () => {
    expect(linkRefusal(rule, debt)).toBeNull()
  })

  it("still reports the closed debt first", () => {
    expect(linkRefusal(rule, { ...debt, archived: true, lifecycle: "written_off" })).toBe("debt_closed")
  })
})

import { describe, expect, it } from "vitest"
import {
  aggregateAllSections,
  aggregateSection,
  allowedOccurrenceActions,
  amountInPlanCurrency,
  canAddSettlement,
  categoryConflicts,
  categoryKey,
  checkReallocation,
  checkReschedule,
  daysOverdue,
  detectCurrencyMismatch,
  needsAttention,
  normalizeMatchKeys,
  overspendOptions,
  reallocationPreservesTotal,
  sameCategory,
  settlementRollup,
  type EnvelopeTotals,
} from "./budget-math"

// ─────────────────────────────────────────────────────────────────────────────
// Category matching (§8.3)
// ─────────────────────────────────────────────────────────────────────────────

describe("categoryKey", () => {
  it("is case-insensitive and whitespace-normalised", () => {
    expect(categoryKey("Groceries")).toBe("groceries")
    expect(categoryKey("  groceries  ")).toBe("groceries")
    expect(categoryKey("\tGROCERIES\n")).toBe("groceries")
    expect(categoryKey(" GrOcErIeS\r")).toBe("groceries")
  })

  it("treats null, undefined and empty as the same empty key", () => {
    expect(categoryKey(null)).toBe("")
    expect(categoryKey(undefined)).toBe("")
    expect(categoryKey("")).toBe("")
    expect(categoryKey("   ")).toBe("")
  })

  it("trims only the four characters btrim() does, so it cannot be WIDER than the SQL", () => {
    // U+00A0 NO-BREAK SPACE is whitespace to JS .trim() but NOT to Postgres
    // btrim(). Stripping it here would make an envelope match a row the SQL
    // index-backed query does not, i.e. two different answers for one number.
    expect(categoryKey(" groceries")).toBe(" groceries")
    expect(categoryKey("groceries ")).toBe("groceries ")
  })

  it("keeps interior whitespace, which is part of the name", () => {
    expect(categoryKey(" Eating  Out ")).toBe("eating  out")
  })

  it("sameCategory follows the key", () => {
    expect(sameCategory("Dining", "  dining ")).toBe(true)
    expect(sameCategory("Dining", "Dining out")).toBe(false)
  })
})

describe("normalizeMatchKeys", () => {
  it("normalises, de-duplicates and drops empties, preserving first-seen order", () => {
    expect(normalizeMatchKeys(["Groceries", " groceries ", "", null, "Dining", "GROCERIES"])).toEqual([
      "groceries",
      "dining",
    ])
  })
})

describe("categoryConflicts — one category, one envelope", () => {
  const existing = [
    { id: "e1", name: "Groceries", matchKeys: ["groceries", "supermarket"] },
    { id: "e2", name: "Dining", matchKeys: ["dining"] },
  ]

  it("detects a collision regardless of case or padding", () => {
    const c = categoryConflicts([" SUPERMARKET "], existing)
    expect(c).toEqual([{ key: "supermarket", envelopeId: "e1", envelopeName: "Groceries" }])
  })

  it("reports every colliding key so the error can name them", () => {
    expect(categoryConflicts(["groceries", "dining"], existing).map((c) => c.key)).toEqual(["groceries", "dining"])
  })

  it("allows a genuinely new category", () => {
    expect(categoryConflicts(["transport"], existing)).toEqual([])
  })

  it("ignores empty keys rather than colliding on them", () => {
    expect(categoryConflicts(["", "  "], [{ id: "x", name: "X", matchKeys: [""] }])).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Section aggregation — the netted-then-floored-ONCE invariant (§8.5.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("aggregateSection — headroom is netted before flooring", () => {
  it("THE named case: Groceries 300/400 + Dining 200/0 gives headroom 100, not 200", () => {
    const envelopes: EnvelopeTotals[] = [
      { section: "flexible", planned: 300, spentNet: 400, pending: 0 },
      { section: "flexible", planned: 200, spentNet: 0, pending: 0 },
    ]
    const s = aggregateSection("flexible", envelopes)

    expect(s.planned).toBe(500)
    expect(s.spentNet).toBe(400)
    // Netted: max(0, 500 - 400 - 0) = 100.
    expect(s.headroom).toBe(100)
    // Per-envelope flooring would have produced max(0,-100) + max(0,200) = 200.
    const perEnvelopeFloored = envelopes.reduce((a, e) => a + Math.max(0, e.planned - e.spentNet - e.pending), 0)
    expect(perEnvelopeFloored).toBe(200)
    expect(s.headroom).not.toBe(perEnvelopeFloored)
  })

  it("signed remaining stays negative when the whole section is over", () => {
    const s = aggregateSection("flexible", [
      { section: "flexible", planned: 100, spentNet: 250, pending: 0 },
      { section: "flexible", planned: 50, spentNet: 0, pending: 0 },
    ])
    expect(s.remaining).toBe(-100)
    expect(s.headroom).toBe(0)
    expect(s.utilisation).toBe("over")
  })

  it("counts overspent envelopes without letting them raise headroom", () => {
    const s = aggregateSection("flexible", [
      { section: "flexible", planned: 300, spentNet: 400, pending: 0 },
      { section: "flexible", planned: 200, spentNet: 0, pending: 0 },
    ])
    expect(s.overspentCount).toBe(1)
    expect(s.envelopeCount).toBe(2)
  })

  it("pending reduces headroom exactly like spend does", () => {
    const s = aggregateSection("commitment", [{ section: "commitment", planned: 500, spentNet: 100, pending: 300 }])
    expect(s.headroom).toBe(100)
    expect(s.remaining).toBe(100)
  })

  it("floors ONCE even across three envelopes with mixed overspend", () => {
    const s = aggregateSection("flexible", [
      { section: "flexible", planned: 100, spentNet: 180, pending: 0 },
      { section: "flexible", planned: 100, spentNet: 130, pending: 0 },
      { section: "flexible", planned: 300, spentNet: 0, pending: 0 },
    ])
    // 500 planned, 310 spent → 190.
    expect(s.headroom).toBe(190)
  })

  it("an empty section is all zeros and state none", () => {
    const s = aggregateSection("debt", [])
    expect(s).toMatchObject({ planned: 0, spentNet: 0, pending: 0, remaining: 0, headroom: 0, utilisation: "none" })
  })

  it("ignores envelopes belonging to other sections", () => {
    const s = aggregateSection("flexible", [
      { section: "flexible", planned: 100, spentNet: 10, pending: 0 },
      { section: "savings", planned: 900, spentNet: 0, pending: 0 },
    ])
    expect(s.planned).toBe(100)
  })

  it("rounds cents without float noise", () => {
    const s = aggregateSection("flexible", [
      { section: "flexible", planned: 0.1, spentNet: 0, pending: 0 },
      { section: "flexible", planned: 0.2, spentNet: 0, pending: 0 },
    ])
    expect(s.planned).toBe(0.3)
  })
})

describe("aggregateAllSections", () => {
  it("returns every section including the untouched ones", () => {
    const all = aggregateAllSections([{ section: "flexible", planned: 100, spentNet: 25, pending: 0 }])
    expect(Object.keys(all)).toEqual(["income", "commitment", "flexible", "savings", "debt"])
    expect(all.flexible.headroom).toBe(75)
    expect(all.savings.utilisation).toBe("none")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Reallocation (§8.5.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkReallocation", () => {
  const base = {
    fromId: "a",
    toId: "b",
    fromSection: "flexible" as const,
    toSection: "flexible" as const,
    fromAvailable: 100,
  }

  it("accepts a move within the source available room", () => {
    expect(checkReallocation({ ...base, amount: 60 })).toEqual({ ok: true, amount: 60 })
  })

  it("rejects a move larger than the source has, and says how much it has", () => {
    expect(checkReallocation({ ...base, amount: 140 })).toEqual({
      ok: false,
      reason: "insufficient_source",
      available: 100,
    })
  })

  it("rejects zero, negative and non-finite amounts", () => {
    expect(checkReallocation({ ...base, amount: 0 }).ok).toBe(false)
    expect(checkReallocation({ ...base, amount: -5 }).ok).toBe(false)
    expect(checkReallocation({ ...base, amount: Number.NaN }).ok).toBe(false)
  })

  it("rejects a move onto itself", () => {
    expect(checkReallocation({ ...base, toId: "a", amount: 10 })).toEqual({ ok: false, reason: "same_envelope" })
  })

  it("blocks a cross-section move by default because it changes what is reserved", () => {
    expect(checkReallocation({ ...base, toSection: "commitment", amount: 10 })).toEqual({
      ok: false,
      reason: "cross_section",
    })
  })

  it("allows a cross-section move only when explicitly opted into", () => {
    expect(
      checkReallocation({ ...base, toSection: "commitment", amount: 10, allowCrossSection: true }),
    ).toEqual({ ok: true, amount: 10 })
  })
})

describe("reallocationPreservesTotal", () => {
  it("holds for a real move", () => {
    expect(
      reallocationPreservesTotal({ fromPlanned: 300, toPlanned: 200 }, { fromPlanned: 250, toPlanned: 250 }),
    ).toBe(true)
  })

  it("fails when money is created or destroyed", () => {
    expect(
      reallocationPreservesTotal({ fromPlanned: 300, toPlanned: 200 }, { fromPlanned: 300, toPlanned: 250 }),
    ).toBe(false)
  })

  it("tolerates cent-level float noise", () => {
    expect(
      reallocationPreservesTotal({ fromPlanned: 0.1, toPlanned: 0.2 }, { fromPlanned: 0.15, toPlanned: 0.15 }),
    ).toBe(true)
  })
})

describe("overspendOptions", () => {
  it("orders the advice: siblings by size, then unallocated, then raise, then accept", () => {
    const opts = overspendOptions({
      overBy: 40,
      unallocated: 25,
      siblings: [
        { id: "s1", name: "Small", available: 10 },
        { id: "s2", name: "Big", available: 90 },
      ],
    })
    expect(opts.map((o) => o.kind)).toEqual([
      "move_from_envelope",
      "move_from_envelope",
      "cover_from_unallocated",
      "raise_target",
      "accept",
    ])
    expect(opts[0]).toMatchObject({ envelopeName: "Big", available: 90 })
  })

  it("omits siblings with nothing to give and unallocated when it is empty", () => {
    const opts = overspendOptions({
      overBy: 10,
      unallocated: 0,
      siblings: [{ id: "s1", name: "Spent", available: 0 }],
    })
    expect(opts.map((o) => o.kind)).toEqual(["raise_target", "accept"])
  })

  it("always offers accept, so an overspend is never a dead end", () => {
    const opts = overspendOptions({ overBy: 0, unallocated: 0, siblings: [] })
    expect(opts).toEqual([{ kind: "accept" }])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Settlements (§8.8.1)
// ─────────────────────────────────────────────────────────────────────────────

describe("settlementRollup", () => {
  it("reports unsettled with no settlements", () => {
    expect(settlementRollup(400, [])).toEqual({
      expenseAmount: 400,
      settled: 0,
      outstanding: 400,
      status: "unsettled",
    })
  })

  it("handles the partial cross-period case from the spec: 400 reimbursed 250 then 150", () => {
    expect(settlementRollup(400, [250])).toMatchObject({ settled: 250, outstanding: 150, status: "partially_settled" })
    expect(settlementRollup(400, [250, 150])).toMatchObject({
      settled: 400,
      outstanding: 0,
      status: "fully_settled",
    })
  })

  it("clamps rather than showing a negative outstanding", () => {
    expect(settlementRollup(400, [500])).toMatchObject({ settled: 400, outstanding: 0, status: "fully_settled" })
  })

  it("treats the expense sign as immaterial", () => {
    expect(settlementRollup(-400, [100]).outstanding).toBe(300)
  })
})

describe("canAddSettlement", () => {
  it("permits an amount within the remaining room", () => {
    expect(canAddSettlement({ expenseAmount: 400, alreadySettled: 250, amount: 150 })).toEqual({
      ok: true,
      amount: 150,
    })
  })

  it("refuses to exceed the expense and reports the room", () => {
    expect(canAddSettlement({ expenseAmount: 400, alreadySettled: 250, amount: 151 })).toEqual({
      ok: false,
      reason: "exceeds_expense",
      room: 150,
    })
  })

  it("refuses non-positive amounts", () => {
    expect(canAddSettlement({ expenseAmount: 400, alreadySettled: 0, amount: 0 }).ok).toBe(false)
    expect(canAddSettlement({ expenseAmount: 400, alreadySettled: 0, amount: -1 }).ok).toBe(false)
  })

  it("reports zero room on a fully settled expense", () => {
    const r = canAddSettlement({ expenseAmount: 400, alreadySettled: 400, amount: 1 })
    expect(r).toEqual({ ok: false, reason: "exceeds_expense", room: 0 })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Occurrence actions (§8.6)
// ─────────────────────────────────────────────────────────────────────────────

describe("checkReschedule", () => {
  it("accepts a free date", () => {
    expect(checkReschedule({ toDate: "2026-09-20", currentDate: "2026-09-15", taken: [] })).toEqual({
      ok: true,
      date: "2026-09-20",
    })
  })

  it("prevents the unique-constraint collision instead of letting the DB reject it", () => {
    expect(
      checkReschedule({ toDate: "2026-09-20", currentDate: "2026-09-15", taken: ["2026-09-20"] }),
    ).toEqual({ ok: false, reason: "collision" })
  })

  it("rejects a malformed date", () => {
    expect(checkReschedule({ toDate: "20/09/2026", currentDate: "2026-09-15", taken: [] })).toEqual({
      ok: false,
      reason: "invalid_date",
    })
  })

  it("rejects a no-op", () => {
    expect(checkReschedule({ toDate: "2026-09-15", currentDate: "2026-09-15", taken: [] })).toEqual({
      ok: false,
      reason: "unchanged",
    })
  })

  it("rejects a move behind the carry window", () => {
    expect(
      checkReschedule({
        toDate: "2024-01-01",
        currentDate: "2026-09-15",
        taken: [],
        lowerBound: "2025-09-02",
      }),
    ).toEqual({ ok: false, reason: "before_window" })
  })
})

describe("allowedOccurrenceActions", () => {
  it("offers everything on an expected occurrence", () => {
    expect(allowedOccurrenceActions("expected")).toEqual(["settle", "reschedule", "skip", "cancel"])
  })

  it("keeps a rescheduled occurrence fully actionable", () => {
    expect(allowedOccurrenceActions("rescheduled")).toEqual(["settle", "reschedule", "skip", "cancel"])
  })

  it("lets a skip be undone by settling or moving it", () => {
    expect(allowedOccurrenceActions("skipped")).toEqual(["settle", "reschedule"])
  })

  it("closes settled and cancelled occurrences", () => {
    expect(allowedOccurrenceActions("settled")).toEqual([])
    expect(allowedOccurrenceActions("cancelled")).toEqual([])
  })
})

describe("daysOverdue", () => {
  it("counts days past due and never goes negative", () => {
    expect(daysOverdue("2026-09-01", "2026-09-05")).toBe(4)
    expect(daysOverdue("2026-09-05", "2026-09-05")).toBe(0)
    expect(daysOverdue("2026-09-10", "2026-09-05")).toBe(0)
  })
})

describe("needsAttention", () => {
  it("never flags a one-time commitment, however late", () => {
    expect(needsAttention("one_time", 99)).toBe(false)
  })

  it("flags a recurring commitment only at the unresolved cap", () => {
    expect(needsAttention("recurring", 11)).toBe(false)
    expect(needsAttention("recurring", 12)).toBe(true)
    expect(needsAttention("recurring", 40)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Multicurrency boundary (§12.2)
// ─────────────────────────────────────────────────────────────────────────────

describe("amountInPlanCurrency", () => {
  it("is the identity, and stays the identity even when told about a mismatch", () => {
    expect(amountInPlanCurrency(123.45)).toBe(123.45)
    expect(amountInPlanCurrency(123.45, "EUR", "EUR")).toBe(123.45)
    // A pure function must not throw on data; the caller surfaces the
    // limitation via detectCurrencyMismatch instead of a guessed rate.
    expect(amountInPlanCurrency(123.45, "USD", "EUR")).toBe(123.45)
  })
})

describe("detectCurrencyMismatch", () => {
  it("is silent when the plan and org agree", () => {
    expect(detectCurrencyMismatch("EUR", "EUR")).toBeNull()
    expect(detectCurrencyMismatch("eur", " EUR ")).toBeNull()
  })

  it("reports a machine-readable limitation without converting anything", () => {
    expect(detectCurrencyMismatch("EUR", "USD")).toEqual({
      code: "currency_mismatch",
      plan_currency: "EUR",
      org_currency: "USD",
      converted: false,
    })
  })

  it("stays silent when either side is unknown rather than inventing a mismatch", () => {
    expect(detectCurrencyMismatch(null, "USD")).toBeNull()
    expect(detectCurrencyMismatch("EUR", "")).toBeNull()
    expect(detectCurrencyMismatch(undefined, undefined)).toBeNull()
  })
})

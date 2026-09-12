// The rules that join a debt to the recurring payment that repays it. Pure —
// shared by the API (materialization, create, edit) and the UI (the form, the
// detail screen), and unit-tested.
//
// `.js` extensions: this module is reachable from the api/ functions, which run
// as unbundled ESM on @vercel/node.
import { interestForPeriod, periodsPerYear, type Cents, type PaymentFrequency } from "./debt-math.js"
import type { Frequency, FrequencyUnit } from "./recurring.js"

/**
 * The nine suggested kinds. A debt's kind is FREE TEXT — people have
 * arrangements the list will never cover ("shop credit", "chit fund", a
 * flatmate) — so these are suggestions, not a closed set. Only a value in this
 * list has a translation; anything else is shown exactly as it was typed.
 */
export const DEBT_KIND_SUGGESTIONS = [
  "mortgage", "personal", "car", "student", "business", "bnpl", "overdraft", "informal", "other",
] as const
export type DebtKindSuggestion = (typeof DEBT_KIND_SUGGESTIONS)[number]

export const MAX_DEBT_KIND_LENGTH = 40

export const isSuggestedDebtKind = (kind: string): kind is DebtKindSuggestion =>
  (DEBT_KIND_SUGGESTIONS as readonly string[]).includes(kind)

/**
 * What gets stored. A suggestion is stored as its key (so it stays translated
 * when the user switches language); anything else is stored verbatim, trimmed
 * and length-capped. Empty falls back to "other" rather than being rejected —
 * the kind is a label, never a gate.
 */
export function normalizeDebtKind(raw: unknown): string {
  const text = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : ""
  if (!text) return "other"
  const lower = text.toLowerCase()
  if (isSuggestedDebtKind(lower)) return lower
  return text.slice(0, MAX_DEBT_KIND_LENGTH)
}

// ── Frequency: the debt vocabulary ⇄ the recurring-rule vocabulary ───────────
//
// A debt speaks in named rhythms (the planner and the amortization schedule
// need periods-per-year); a recurring rule speaks in (unit, interval). They
// describe the same thing, so ONE of them has to be derived from the other or
// the two schedules drift apart the first time either is edited. The rule is
// authoritative whenever one exists — see syncDebtScheduleFromRule on the
// server — and these two functions are the only conversion.

const TO_RECURRING: Record<Exclude<PaymentFrequency, "irregular">, Frequency> = {
  weekly: { unit: "week", interval: 1 },
  biweekly: { unit: "week", interval: 2 },
  monthly: { unit: "month", interval: 1 },
  quarterly: { unit: "month", interval: 3 },
  yearly: { unit: "year", interval: 1 },
}

/** The (unit, interval) a recurring rule needs. Null for "irregular" — an irregular debt has no schedule to run. */
export function frequencyToRecurring(frequency: PaymentFrequency | null | undefined): Frequency | null {
  if (!frequency || frequency === "irregular") return null
  return TO_RECURRING[frequency] ?? null
}

/**
 * The debt rhythm a rule describes, or null when it describes something the
 * debt vocabulary has no word for (every 10 days, every 5 months). Null is not
 * an error: the debt simply records no named frequency, which is exactly what
 * "irregular" means everywhere else in the feature.
 */
export function recurringToFrequency(unit: FrequencyUnit, interval: number): PaymentFrequency | null {
  for (const [frequency, freq] of Object.entries(TO_RECURRING) as [PaymentFrequency, Frequency][]) {
    if (freq.unit === unit && freq.interval === interval) return frequency
  }
  return null
}

// ── The last payment ─────────────────────────────────────────────────────────

/**
 * What one occurrence should actually move, given what is still owed.
 *
 * A rule that pays 500 a month against a 120 balance must pay 120 (plus the
 * period's interest), not 500. Uncapped, the extra 380 lands as principal, the
 * stored balance crosses zero into credit, and every screen shows "0 owed"
 * because the outstanding figure clamps there — the money is gone from view
 * without ever being spent. So the final instalment is capped at the payoff
 * amount, the way a lender closes a loan.
 *
 * Returns 0 when nothing is owed: the caller stops rather than posting a
 * zero-amount payment.
 */
export function payoffCappedAmount(input: {
  scheduled: Cents
  outstanding: Cents
  annualRatePct: number | null | undefined
  frequency: PaymentFrequency | null | undefined
}): Cents {
  const scheduled = Math.max(0, Math.round(input.scheduled))
  const outstanding = Math.max(0, Math.round(input.outstanding))
  if (outstanding <= 0 || scheduled <= 0) return 0
  const ppy = periodsPerYear(input.frequency) ?? 12
  const interest = interestForPeriod(outstanding, input.annualRatePct, ppy)
  return Math.min(scheduled, outstanding + interest)
}

/**
 * Whether recording this payment should move the debt's next due date.
 *
 * With a live recurring repayment the RULE owns the schedule, so a payment the
 * user records by hand is by definition an EXTRA one — advancing the due date
 * would silently cancel the next instalment they are still expecting to be
 * taken. Without a rule, a hand-recorded payment IS the scheduled one and the
 * date should move. The user can always override; this is only the default.
 */
export const advancesScheduleByDefault = (hasActiveRule: boolean): boolean => !hasActiveRule

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

/**
 * Periods per year for ANY recurring rhythm, including the ones the debt
 * vocabulary has no word for.
 *
 * `periodsPerYear` in debt-math only knows the five NAMED rhythms and returns
 * null otherwise, and every caller then falls back to 12. That fallback is a
 * guess for a debt nobody scheduled, and a real error for a rule that runs
 * every 10 days: it charges a whole month of interest on a ten-day period, so
 * roughly two thirds of what the user paid as principal is booked as spending
 * instead. When there IS a rule, its rhythm is known exactly — this is how.
 */
export function periodsPerYearForRule(unit: FrequencyUnit, interval: number): number {
  const per = interval > 0 ? interval : 1
  const yearly = unit === "day" ? 365 : unit === "week" ? 52 : unit === "month" ? 12 : 1
  return yearly / per
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
  /** The rule's true periods-per-year, when one drives this debt. Wins over `frequency`. */
  periodsPerYear?: number | null
}): Cents {
  const scheduled = Math.max(0, Math.round(input.scheduled))
  const outstanding = Math.max(0, Math.round(input.outstanding))
  if (outstanding <= 0 || scheduled <= 0) return 0
  const ppy = input.periodsPerYear ?? periodsPerYear(input.frequency) ?? 12
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

// ── Where the cursor goes when a repayment is edited ─────────────────────────

/** The parts of a live rule the cursor decision depends on. */
export type CursorState = {
  startDate: string
  frequencyUnit: FrequencyUnit
  frequencyInterval: number
  nextDueAt: string
  active: boolean
}

/**
 * The next-due date a repayment should carry after an edit.
 *
 * Two cases re-anchor to today, and both exist because the alternative posts
 * money nobody asked for:
 *
 *   • The SCHEDULE changed (a new anchor day or rhythm). Re-anchoring forward
 *     keeps everything already posted and back-dates nothing into a balance
 *     that already accounts for it.
 *   • The rule is being RESUMED. A paused repayment is a deliberate holiday
 *     from paying; coming back after six months must not fire six back-dated
 *     instalments in one click.
 *
 * Everything else — changing the amount, the paying account, the name — leaves
 * the cursor exactly where it was, so a due-but-unposted occurrence is not
 * stepped over.
 */
export function repaymentCursor(input: {
  current: CursorState | null
  startDate: string
  freq: Frequency
  wantActive: boolean
  today: string
}): string {
  const { current, startDate, freq, wantActive, today } = input
  const scheduleChanged =
    !current ||
    current.startDate !== startDate ||
    current.frequencyUnit !== freq.unit ||
    current.frequencyInterval !== freq.interval
  const resuming = !!current && !current.active && wantActive
  if (scheduleChanged || resuming) return startDate > today ? startDate : today
  return current.nextDueAt
}

// ── Adopting a recurring rule you already have ───────────────────────────────
//
// People set the standing order up long before they start tracking the debt it
// pays. "Car loan €300" sits in Recurring as a plain expense for eight months,
// and then the loan gets added and there are suddenly two versions of the same
// money. Linking the two is the fix, and it is the same operation from either
// side — the debt adopting a rule, or the rule being pointed at a debt.
//
// What it does NOT do is rewrite the past. The eight occurrences already posted
// were expenses; they stay expenses. Retroactively rebuilding them would move
// balances, change budget periods that have already been reported on, and guess
// at an interest split nobody recorded at the time. Linking is FORWARD ONLY,
// and the screens say so.

/** Why a rule cannot be adopted as a debt's repayment. Each maps to one message. */
export type LinkRefusal =
  | "rule_is_autosave"      // a Space auto-save: it belongs to the Space
  | "rule_pays_with_card"   // cards are instruments, not repayment sources
  | "rule_has_no_account"   // a repayment needs somewhere to be paid from
  | "account_archived"
  | "account_not_cash"      // bank or cash only — see the card rule in DEBTS.md
  | "direction_mismatch"    // an incoming rule cannot pay a loan
  | "debt_closed"
  | "repayment_exists"      // one repayment per debt keeps the mirror honest
  | "rule_linked_elsewhere" // already servicing a different debt
  | "rule_ended"            // its end date has passed: it can never fire again
  | "rule_has_pending"      // instalments are still waiting to post in their old shape

export type LinkCandidateRule = {
  id: string
  kind: "standard" | "transfer" | "debt"
  type: "incoming" | "outgoing"
  cardId: string | null
  accountId: string | null
  accountType: string | null
  accountArchived: boolean
  debtAccountId: string | null
  /** Its end date has passed, so it can never fire again. */
  ended?: boolean
  /**
   * Instalments are due but have not posted — the catch-up could not run them
   * (a plan limit, an archived account). Linking would move the cursor past
   * them and they would be recorded in neither shape.
   */
  hasPending?: boolean
}

export type LinkTargetDebt = {
  id: string
  direction: "owed" | "receivable"
  archived: boolean
  /**
   * Ids of EVERY rule already linked to this debt, active or not.
   *
   * Counting only the active ones let a debt quietly collect a second rule
   * while the first was paused — and resuming then paid it twice a month.
   */
  linkedRuleIds: string[]
}

/**
 * Whether this rule may become this debt's repayment.
 *
 * The direction check is the one that matters most. A rule and a debt disagreeing
 * about which way money moves is a mistake, not something to reconcile: silently
 * flipping an incoming €3,000 salary rule because it was dropped on a loan would
 * start taking €3,000 a month OUT of the account. So it is refused, loudly.
 */
export function linkRefusal(rule: LinkCandidateRule, debt: LinkTargetDebt): LinkRefusal | null {
  if (rule.kind === "transfer") return "rule_is_autosave"
  if (debt.archived) return "debt_closed"
  if (rule.cardId) return "rule_pays_with_card"
  if (!rule.accountId) return "rule_has_no_account"
  if (rule.accountArchived) return "account_archived"
  if (rule.accountType !== "bank" && rule.accountType !== "cash") return "account_not_cash"
  // A loan is paid; a receivable is collected.
  const wanted = debt.direction === "receivable" ? "incoming" : "outgoing"
  if (rule.type !== wanted) return "direction_mismatch"
  // Already doing this job for somebody else. Moving it would leave the OTHER
  // debt with a mirrored schedule — a payment amount, a next due date, a place
  // in the planner — describing a rule that had quietly walked away. Unlinking
  // it there first is one more step and leaves nothing behind.
  if (rule.debtAccountId && rule.debtAccountId !== debt.id) return "rule_linked_elsewhere"
  // A rule past its end date can never fire again; linking it would write a
  // schedule onto the debt that nothing will ever honour.
  if (rule.ended) return "rule_ended"
  // Instalments waiting to post must land in the shape they were owed in. The
  // link moves the cursor forward, so linking over them loses them entirely.
  if (rule.hasPending) return "rule_has_pending"
  // ONE repayment per debt, active or not: the debt's payment_amount /
  // payment_frequency / next_due_date mirror exactly one rule, and the planner,
  // the payoff estimate and the month's obligations all read that mirror. Two
  // would make them fiction — and a second one linked while the first was merely
  // PAUSED is the version of this that hides until both are running.
  if (debt.linkedRuleIds.some((id) => id !== rule.id)) return "repayment_exists"
  return null
}

/** Can this rule be offered in a debt's "link an existing one" picker at all? */
export const isLinkable = (rule: LinkCandidateRule, debt: LinkTargetDebt): boolean => linkRefusal(rule, debt) === null

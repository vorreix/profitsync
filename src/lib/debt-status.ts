// Derived, presentation-ready facts about a debt: its status (never stored —
// computed from the lifecycle the user set, what is owed and the next due
// date), repayment progress, the upcoming schedule, this month's obligations,
// the estimated debt-free date and the plain-language insights. Pure and
// unit-tested; the API and the UI both call these.

// `.js` extension: this module is reachable from the api/ functions (Node ESM).
import { addPeriods, amortize, fromCents, monthKey, monthlyEquivalent, nextDueAfter, periodsPerYear, toCents, type Cents, type PaymentFrequency } from "./debt-math.js"

/** What the user SETS. Everything else is derived. */
export type DebtLifecycle = "active" | "paused" | "paid_off" | "refinanced" | "written_off"
export const DEBT_LIFECYCLES: readonly DebtLifecycle[] = ["active", "paused", "paid_off", "refinanced", "written_off"]

/** What the user SEES. */
export type DebtStatus = DebtLifecycle | "overdue" | "due_soon"

export type DebtLike = {
  id: string
  name: string
  lifecycle: DebtLifecycle
  /** Amount owed today (positive), in cents. */
  owed: Cents
  original: Cents | null
  annualRatePct: number | null
  paymentAmount: Cents | null
  frequency: PaymentFrequency | null
  nextDueDate: string | null
  currency: string
}

export const DUE_SOON_DAYS = 7

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/**
 * Status shown on the card. Lifecycle wins (a paused or refinanced debt is
 * that regardless of dates); a zero balance is "paid off" even if the user has
 * not marked it; otherwise the next due date decides overdue / due soon / active.
 */
export function derivedStatus(d: Pick<DebtLike, "lifecycle" | "owed" | "nextDueDate">, today: string): DebtStatus {
  if (d.lifecycle !== "active") return d.lifecycle
  if (d.owed <= 0) return "paid_off"
  if (d.nextDueDate) {
    if (d.nextDueDate < today) return "overdue"
    if (daysBetween(today, d.nextDueDate) <= DUE_SOON_DAYS) return "due_soon"
  }
  return "active"
}

/** Whether the debt still counts toward totals / the planner. */
export const isOpenDebt = (d: Pick<DebtLike, "lifecycle" | "owed">): boolean => d.lifecycle === "active" && d.owed > 0 || d.lifecycle === "paused" && d.owed > 0

/** Repaid share 0..100 (null without a known original amount or when nothing was ever owed). */
export function progressPct(original: Cents | null, owed: Cents): number | null {
  if (original == null || original <= 0) return null
  return Math.max(0, Math.min(100, Math.round(((original - owed) / original) * 1000) / 10))
}

export type ScheduledPayment = { debtId: string; date: string; amount: Cents; paid: boolean; paidAmount: Cents }

/**
 * The expected payments from `from` for `months` months, using each debt's next
 * due date and frequency. `paidByMonth` marks a scheduled month as paid when a
 * recorded payment exists in that calendar month (irregular debts have no rows).
 */
export function upcomingSchedule(
  debts: DebtLike[],
  from: string,
  months: number,
  paidByMonth: Map<string, Cents> = new Map(), // key `${debtId}:${YYYY-MM}` → cents paid
): ScheduledPayment[] {
  // "The next N months" = this calendar month and the N−1 after it.
  const endKey = monthKey(addPeriods(from, "monthly", months))
  const out: ScheduledPayment[] = []
  for (const d of debts) {
    if (!isOpenDebt(d) || !d.nextDueDate || !d.frequency || d.frequency === "irregular" || !d.paymentAmount) continue
    let date = d.nextDueDate
    let n = 0
    while (monthKey(date) < endKey && n < 400) {
      const paidAmount = paidByMonth.get(`${d.id}:${monthKey(date)}`) ?? 0
      out.push({ debtId: d.id, date, amount: d.paymentAmount, paid: paidAmount > 0, paidAmount })
      // Always step from the debt's own anchor so month-end days never drift.
      date = addPeriods(d.nextDueDate, d.frequency, ++n)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.debtId.localeCompare(b.debtId))
}

export type MonthObligations = { required: Cents; paid: Cents; remaining: Cents; overdue: Cents }

/**
 * This month's debt obligations. `required` = every scheduled payment dated in
 * the month (plus an overdue one carried in from before); `paid` = what was
 * actually recorded this month (any amount, on any debt); `remaining` never
 * goes below zero.
 */
export function monthObligations(debts: DebtLike[], today: string, paidThisMonth: Map<string, Cents>): MonthObligations {
  const month = monthKey(today)
  let required = 0
  let overdue = 0
  for (const d of debts) {
    if (!isOpenDebt(d) || !d.paymentAmount || !d.nextDueDate || !d.frequency || d.frequency === "irregular") continue
    if (d.nextDueDate < today && monthKey(d.nextDueDate) !== month) {
      overdue += d.paymentAmount
      required += d.paymentAmount
    }
    // Every scheduled date falling in this month.
    let date = d.nextDueDate
    let n = 0
    while (monthKey(date) < month && n < 400) date = addPeriods(d.nextDueDate, d.frequency, ++n)
    while (monthKey(date) === month && n < 400) {
      required += d.paymentAmount
      if (date < today) overdue += d.paymentAmount
      date = addPeriods(d.nextDueDate, d.frequency, ++n)
    }
  }
  let paid = 0
  for (const v of paidThisMonth.values()) paid += v
  return { required, paid, remaining: Math.max(0, required - paid), overdue }
}

/** The single next scheduled payment across all debts (null when nothing is scheduled). */
export function nextPayment(debts: DebtLike[], today: string): { debt: DebtLike; date: string; amount: Cents } | null {
  let best: { debt: DebtLike; date: string; amount: Cents } | null = null
  for (const d of debts) {
    if (!isOpenDebt(d) || !d.nextDueDate || !d.paymentAmount) continue
    // An overdue date IS the next thing to pay.
    const date = d.nextDueDate
    if (!best || date < best.date || (date === best.date && d.paymentAmount > best.amount)) best = { debt: d, date, amount: d.paymentAmount }
  }
  void today
  return best
}

export type DebtFreeEstimate =
  | { kind: "date"; date: string; periods: number; remainingInterest: Cents; assumedZeroRate: boolean }
  | { kind: "unknown"; reason: "no_schedule" | "payment_too_small" | "no_balance" }

/**
 * When will THIS debt end at its current scheduled payment? Needs a balance,
 * a payment and a frequency; the rate may be unknown (then 0 % is assumed and
 * flagged). A payment that doesn't cover the interest → "unknown", never a
 * made-up date.
 */
export function debtFreeEstimate(d: DebtLike, today: string): DebtFreeEstimate {
  if (d.owed <= 0) return { kind: "unknown", reason: "no_balance" }
  const ppy = periodsPerYear(d.frequency)
  if (!ppy || !d.paymentAmount || d.paymentAmount <= 0 || !d.frequency || d.frequency === "irregular") return { kind: "unknown", reason: "no_schedule" }
  const result = amortize({ balance: d.owed, annualRatePct: d.annualRatePct ?? 0, payment: d.paymentAmount, ppy, keepRows: false })
  if (!result.converges) return { kind: "unknown", reason: "payment_too_small" }
  const anchor = d.nextDueDate ?? today
  const date = addPeriods(anchor, d.frequency, result.periods - 1)
  return { kind: "date", date, periods: result.periods, remainingInterest: result.totalInterest, assumedZeroRate: d.annualRatePct == null }
}

/** Sum owed per currency (native amounts, never converted). */
export function owedByCurrency(debts: DebtLike[]): { currency: string; owed: Cents }[] {
  const map = new Map<string, Cents>()
  for (const d of debts) if (isOpenDebt(d)) map.set(d.currency, (map.get(d.currency) ?? 0) + d.owed)
  return [...map].map(([currency, owed]) => ({ currency, owed })).sort((a, b) => b.owed - a.owed)
}

/** Scheduled payments per month across open debts (monthly equivalents). */
export function requiredMonthly(debts: DebtLike[]): Cents {
  return debts.filter(isOpenDebt).reduce((s, d) => s + monthlyEquivalent(d.paymentAmount ?? 0, d.frequency), 0)
}

// ── Plain-language insights ──────────────────────────────────────────────────
// Each insight is a KEY + params; the UI translates. Deterministic, ordered by
// usefulness, capped — the numbers are never produced by an LLM.

export type DebtInsight =
  | { key: "interest_this_month"; params: { amount: number; currency: string } }
  | { key: "highest_rate"; params: { name: string; rate: number } }
  | { key: "few_payments_left"; params: { name: string; count: number } }
  | { key: "smallest_clearable"; params: { name: string; amount: number; currency: string } }
  | { key: "frees_monthly"; params: { name: string; amount: number; currency: string; date: string } }
  | { key: "debt_free_date"; params: { date: string } }

export function debtInsights(input: {
  debts: DebtLike[]
  today: string
  interestPaidThisMonth: Cents
  currency: string
  /** Per-debt payoff estimates (already computed by the caller). */
  estimates: Map<string, DebtFreeEstimate>
}): DebtInsight[] {
  const open = input.debts.filter(isOpenDebt)
  const out: DebtInsight[] = []
  if (open.length === 0) return out
  if (input.interestPaidThisMonth > 0) out.push({ key: "interest_this_month", params: { amount: fromCents(input.interestPaidThisMonth), currency: input.currency } })
  const rated = open.filter((d) => d.annualRatePct != null && d.annualRatePct > 0).sort((a, b) => b.annualRatePct! - a.annualRatePct!)
  if (rated.length > 1) out.push({ key: "highest_rate", params: { name: rated[0].name, rate: rated[0].annualRatePct! } })
  for (const d of open) {
    const e = input.estimates.get(d.id)
    if (e?.kind === "date" && e.periods <= 3) out.push({ key: "few_payments_left", params: { name: d.name, count: e.periods } })
  }
  const smallest = [...open].sort((a, b) => a.owed - b.owed)[0]
  if (open.length > 1 && smallest) out.push({ key: "smallest_clearable", params: { name: smallest.name, amount: fromCents(smallest.owed), currency: smallest.currency } })
  // The debt ending soonest frees its payment.
  const ending = open
    .map((d) => ({ d, e: input.estimates.get(d.id) }))
    .filter((x): x is { d: DebtLike; e: Extract<DebtFreeEstimate, { kind: "date" }> } => x.e?.kind === "date" && !!x.d.paymentAmount)
    .sort((a, b) => a.e.date.localeCompare(b.e.date))[0]
  if (ending && open.length > 1) {
    out.push({ key: "frees_monthly", params: { name: ending.d.name, amount: fromCents(monthlyEquivalent(ending.d.paymentAmount!, ending.d.frequency)), currency: ending.d.currency, date: ending.e.date } })
  }
  return out.slice(0, 5)
}

/** Latest estimated payoff date across debts at current pace; null if any open debt cannot be estimated. */
export function overallDebtFreeDate(estimates: Map<string, DebtFreeEstimate>, open: DebtLike[]): string | null {
  let latest: string | null = null
  for (const d of open) {
    const e = estimates.get(d.id)
    if (!e || e.kind !== "date") return null
    if (!latest || e.date > latest) latest = e.date
  }
  return latest
}

/** Payment split the API stores: keep everything in cents and make the parts add up to the total. */
export function normalizeSplit(input: { total: number; principal?: number | null; interest?: number | null; fees?: number | null; other?: number | null }): {
  total: Cents; principal: Cents; interest: Cents; fees: Cents; other: Cents
} | null {
  const total = toCents(input.total)
  if (total <= 0) return null
  const interest = Math.max(0, toCents(input.interest ?? 0))
  const fees = Math.max(0, toCents(input.fees ?? 0))
  const other = Math.max(0, toCents(input.other ?? 0))
  const principal = input.principal == null ? total - interest - fees - other : toCents(input.principal)
  if (principal < 0 || principal + interest + fees + other !== total) return null
  return { total, principal, interest, fees, other }
}

export { nextDueAfter }

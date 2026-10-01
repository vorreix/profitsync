// Derived, presentation-ready facts about a debt: its status (never stored —
// computed from the lifecycle the user set, what is owed and the next due
// date), repayment progress, the upcoming schedule, this month's obligations,
// the estimated debt-free date and the plain-language insights. Pure and
// unit-tested; the API and the UI both call these.

// `.js` extension: this module is reachable from the api/ functions (Node ESM).
import { addPeriods, amortize, finalPaymentTolerance, fromCents, monthKey, monthlyEquivalent, nextDueAfter, periodsPerYear, toCents, type Cents, type PaymentFrequency } from "./debt-math.js"

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

/**
 * The lifecycles that still count toward totals — the hub's AND net worth on
 * /wealth (api/_lib/wealth-summary.ts filters on this same list in SQL, so a
 * written-off debt leaves both screens at once).
 */
export const OPEN_LIFECYCLES: readonly DebtLifecycle[] = ["active", "paused"]

/** Whether the debt still counts toward totals / the planner. */
export const isOpenDebt = (d: Pick<DebtLike, "lifecycle" | "owed">): boolean => OPEN_LIFECYCLES.includes(d.lifecycle) && d.owed > 0

/** One amount per currency. Debts keep their native currency, so a hub total is a LIST, never one number. */
export type CurrencyAmount = { currency: string; amount: Cents }

/** Sum native amounts per currency (never converted), largest first. */
export function sumByCurrency(items: Iterable<{ currency: string; amount: Cents }>): CurrencyAmount[] {
  const map = new Map<string, Cents>()
  for (const x of items) map.set(x.currency, (map.get(x.currency) ?? 0) + x.amount)
  return [...map].map(([currency, amount]) => ({ currency, amount })).sort((a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency))
}

/**
 * Units of ONE common currency per unit of each currency (the reporting
 * currency at the latest rate) — used only to RANK debts, never to display a
 * figure. ¥50,000 is ~$340, not "more" than $600.
 */
export type RankingRates = ReadonlyMap<string, number>

/**
 * Comparable values for ranking: native cents when every item shares one
 * currency, converted with `rates` otherwise, or null when any currency has no
 * rate — a ranking across currencies is then refused, never guessed from raw cents.
 */
function rankingValues<T>(items: T[], cents: (x: T) => Cents, currency: (x: T) => string, rates?: RankingRates): number[] | null {
  const single = items.every((x) => currency(x) === currency(items[0]))
  const out: number[] = []
  for (const x of items) {
    const r = single ? 1 : rates?.get(currency(x))
    if (r == null || !Number.isFinite(r)) return null
    out.push(cents(x) * r)
  }
  return out
}

/** Repaid share 0..100 (null without a known original amount or when nothing was ever owed). */
export function progressPct(original: Cents | null, owed: Cents): number | null {
  if (original == null || original <= 0) return null
  return Math.max(0, Math.min(100, Math.round(((original - owed) / original) * 1000) / 10))
}

export type ScheduledPayment = { debtId: string; date: string; amount: Cents; paid: boolean; paidAmount: Cents }

/**
 * `addPeriods(anchor, frequency, -k)`, taken as a FORWARD step from the anchor
 * moved back whole years: debt-math's month arithmetic wraps a negative month
 * across a year boundary ("2026-01-15" − 1 month → "2025-00-15"). Day-based
 * rhythms step back directly.
 */
export function periodsBefore(anchor: string, frequency: Exclude<PaymentFrequency, "irregular">, k: number): string {
  if (frequency === "weekly" || frequency === "biweekly") return addPeriods(anchor, frequency, -k)
  const perYear = periodsPerYear(frequency)!
  const years = Math.ceil(k / perYear)
  return addPeriods(`${String(Number(anchor.slice(0, 4)) - years).padStart(4, "0")}${anchor.slice(4)}`, frequency, years * perYear - k)
}

/**
 * What a month's payments on `d` (`paid`) settle of that month's instalments
 * the schedule has already ROLLED PAST. Recording a payment moves next_due_date
 * beyond the instalment it paid (a rule-serviced debt mirrors the rule's next
 * date the same way), so a paid Sep 7 is no longer a row, yet its payment is
 * still in September's total — it must settle Sep 7, not Sep 14 (MC-094).
 * Never more than was paid: an instalment skipped WITHOUT a payment (a debt that
 * started mid-month, a due date moved by hand) is not invented.
 */
function settledBeforeNextDue(d: DebtLike, month: string, paid: Cents): Cents {
  if (!paid || !d.paymentAmount || !d.nextDueDate || !d.frequency || d.frequency === "irregular") return 0
  let count = 0
  for (let k = 1; k <= 400; k++) {
    const key = monthKey(periodsBefore(d.nextDueDate, d.frequency, k))
    if (key < month) break
    if (key === month) count++
  }
  return Math.min(paid, count * d.paymentAmount)
}

/**
 * One debt's instalments from its next due date up to (not including) the month
 * `endKey`, each with what that month's payments (`paidIn`) already cover — the
 * month's money first settles the instalments the schedule rolled past, and the
 * rest is SPREAD over its rows in date order, each row taking at most its own
 * amount (MC-094).
 *
 * The walk stops at PAYOFF (MC-DB04): `owed` is today's balance, so the unpaid
 * part of the rows can only add up to what `amortize` — the engine behind the
 * payoff date — says it takes to clear it, and the last row is the payoff figure
 * with the same small-residue fold as the rule's last instalment
 * (payoffCappedAmount). Money already paid has already left `owed`, so a row it
 * covers draws nothing. A payment that never clears the balance (it does not
 * cover the interest) keeps the uncapped walk.
 */
function scheduledRows(d: DebtLike, endKey: string, paidIn: (month: string) => Cents): ScheduledPayment[] {
  if (!isOpenDebt(d) || !d.nextDueDate || !d.frequency || d.frequency === "irregular" || !d.paymentAmount) return []
  const payment = d.paymentAmount
  const plan = amortize({ balance: d.owed, annualRatePct: d.annualRatePct ?? 0, payment, ppy: periodsPerYear(d.frequency)!, maxPeriods: 400, keepRows: false })
  let toPay = plan.converges ? plan.totalPaid : Infinity
  // What is still unallocated of each month's payments on this debt.
  const left = new Map<string, Cents>()
  const out: ScheduledPayment[] = []
  // Always step from the debt's own anchor so month-end days never drift.
  for (let n = 0, date = d.nextDueDate; monthKey(date) < endKey && n < 400; date = addPeriods(d.nextDueDate, d.frequency, ++n)) {
    const key = monthKey(date)
    let available = left.get(key)
    if (available === undefined) {
      const paid = paidIn(key)
      available = paid - settledBeforeNextDue(d, key, paid)
    }
    const paidAmount = Math.max(0, Math.min(payment, available))
    left.set(key, available - paidAmount)
    const need = payment - paidAmount
    if (need > 0 && toPay - need <= finalPaymentTolerance(payment)) {
      // The last instalment: whatever is left, residue folded in.
      const amount = paidAmount + toPay
      out.push({ debtId: d.id, date, amount, paid: paidAmount >= amount, paidAmount })
      break
    }
    toPay -= need
    out.push({ debtId: d.id, date, amount: payment, paid: need <= 0, paidAmount })
  }
  return out
}

/**
 * The expected payments from `from` for `months` months, using each debt's next
 * due date and frequency (irregular debts have no rows), ending at payoff — see
 * `scheduledRows`. `paidByMonth` is what was recorded on the debt in each
 * calendar month. One €100 payment on a weekly €100 debt settles one week, not
 * all four, and not the next one either (MC-094).
 */
export function upcomingSchedule(
  debts: DebtLike[],
  from: string,
  months: number,
  paidByMonth: Map<string, Cents> = new Map(), // key `${debtId}:${YYYY-MM}` → cents paid
): ScheduledPayment[] {
  // "The next N months" = this calendar month and the N−1 after it.
  const endKey = monthKey(addPeriods(from, "monthly", months))
  return debts
    .flatMap((d) => scheduledRows(d, endKey, (key) => paidByMonth.get(`${d.id}:${key}`) ?? 0))
    .sort((a, b) => a.date.localeCompare(b.date) || a.debtId.localeCompare(b.debtId))
}

export type MonthObligations = { required: Cents; paid: Cents; remaining: Cents; overdue: Cents }

/**
 * This month's debt obligations, ONE ROW PER DEBT CURRENCY (MC-028) — an INR
 * instalment and a EUR one are two figures, never 5,200 of anything.
 * `required` = every scheduled payment dated in the month (plus the missed ones
 * carried in from before — the same overdue rows Upcoming lists — plus what this month's payments settled of the
 * instalments the schedule already rolled past — a paid Sep 7 still counts, so
 * required − paid stays honest, MC-094); `paid` = what was actually recorded
 * this month (any amount, on any debt of that currency); `remaining` never goes
 * below zero. Payments on a debt not in `debts` cannot be labelled and are left out.
 */
export function monthObligations(debts: DebtLike[], today: string, paidThisMonth: Map<string, Cents>): (MonthObligations & { currency: string })[] {
  const month = monthKey(today)
  const rows = new Map<string, MonthObligations>()
  const row = (currency: string) => {
    let r = rows.get(currency)
    if (!r) rows.set(currency, (r = { required: 0, paid: 0, remaining: 0, overdue: 0 }))
    return r
  }
  for (const d of debts) {
    if (!isOpenDebt(d) || !d.paymentAmount || !d.nextDueDate || !d.frequency || d.frequency === "irregular") continue
    const r = row(d.currency)
    const paid = paidThisMonth.get(d.id) ?? 0
    r.required += settledBeforeNextDue(d, month, paid)
    // The same payoff-capped rows as the Upcoming list: those from earlier
    // months are missed instalments carried in (all of them — each one drew on
    // the payoff budget), the rest are this month's.
    const due = scheduledRows(d, monthKey(addPeriods(`${month}-01`, "monthly", 1)), (key) => (key === month ? paid : 0))
    for (const s of due) {
      r.required += s.amount
      if (s.date < today) r.overdue += s.amount
    }
  }
  const currencyOf = new Map(debts.map((d) => [d.id, d.currency]))
  for (const [id, v] of paidThisMonth) {
    const currency = currencyOf.get(id)
    if (currency && v) row(currency).paid += v
  }
  return [...rows]
    .map(([currency, r]) => ({ currency, ...r, remaining: Math.max(0, r.required - r.paid) }))
    .sort((a, b) => b.required - a.required || b.paid - a.paid || a.currency.localeCompare(b.currency))
}

/**
 * The single next scheduled payment across all debts (null when nothing is
 * scheduled). Two debts due the same day: the larger payment wins, compared
 * through `rates` across currencies (MC-142) — and when they cannot be compared,
 * the first in list order, never a raw comparison of yen against dollars.
 */
export function nextPayment(debts: DebtLike[], today: string, rates?: RankingRates): { debt: DebtLike; date: string; amount: Cents } | null {
  // An overdue date IS the next thing to pay.
  const due = debts.filter((d) => isOpenDebt(d) && !!d.nextDueDate && !!d.paymentAmount)
  if (due.length === 0) return null
  const date = due.reduce((m, d) => (d.nextDueDate! < m ? d.nextDueDate! : m), due[0].nextDueDate!)
  const tied = due.filter((d) => d.nextDueDate === date)
  const values = rankingValues(tied, (d) => d.paymentAmount!, (d) => d.currency, rates)
  let i = 0
  if (values) for (let k = 1; k < tied.length; k++) if (values[k] > values[i]) i = k
  void today
  return { debt: tied[i], date, amount: tied[i].paymentAmount! }
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

/** Scheduled payments per month across open debts (monthly equivalents), per debt currency (MC-028). */
export function requiredMonthly(debts: DebtLike[]): CurrencyAmount[] {
  return sumByCurrency(debts.filter(isOpenDebt).map((d) => ({ currency: d.currency, amount: monthlyEquivalent(d.paymentAmount ?? 0, d.frequency) }))).filter((x) => x.amount > 0)
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
  /**
   * Interest + fees paid this month, per DEBT currency (MC-089) — never
   * $100 + €25 read as €125. Still ONE insight however many currencies, so it
   * cannot crowd the others out of the cap: the hub renders every part from
   * `summary.interest_this_month_by_currency`; `amount`/`currency` carry the
   * first part (each correctly labelled) for a bundle that predates that list.
   */
  interestPaidThisMonth: CurrencyAmount[]
  /** Per-debt payoff estimates (already computed by the caller). */
  estimates: Map<string, DebtFreeEstimate>
  /** Latest rates for RANKING across currencies (see `RankingRates`). */
  rates?: RankingRates
}): DebtInsight[] {
  const open = input.debts.filter(isOpenDebt)
  const out: DebtInsight[] = []
  if (open.length === 0) return out
  const interest = input.interestPaidThisMonth.find((x) => x.amount > 0)
  if (interest) out.push({ key: "interest_this_month", params: { amount: fromCents(interest.amount), currency: interest.currency } })
  const rated = open.filter((d) => d.annualRatePct != null && d.annualRatePct > 0).sort((a, b) => b.annualRatePct! - a.annualRatePct!)
  if (rated.length > 1) out.push({ key: "highest_rate", params: { name: rated[0].name, rate: rated[0].annualRatePct! } })
  for (const d of open) {
    const e = input.estimates.get(d.id)
    if (e?.kind === "date" && e.periods <= 3) out.push({ key: "few_payments_left", params: { name: d.name, count: e.periods } })
  }
  // "Your smallest debt" is only said when every open debt could be compared
  // (one currency, or a rate for each) — MC-142.
  const values = open.length > 1 ? rankingValues(open, (d) => d.owed, (d) => d.currency, input.rates) : null
  if (values) {
    const smallest = open[values.indexOf(Math.min(...values))]
    out.push({ key: "smallest_clearable", params: { name: smallest.name, amount: fromCents(smallest.owed), currency: smallest.currency } })
  }
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

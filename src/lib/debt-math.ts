// Pure loan mathematics for Debt & Loans. No I/O — shared by the API (payment
// splitting, projections) and the UI (schedules, what-if), and unit-tested.
//
// ── Money is INTEGER CENTS here ─────────────────────────────────────────────
// Long amortization schedules accumulate float noise into visible cent errors
// (a loan "ending" at €0.03). Every function below takes and returns integer
// minor units and rounds interest once per period, half-up, the way a lender
// does. Convert at the edges with toCents()/fromCents().
//
// ── Conventions ─────────────────────────────────────────────────────────────
// • Rates are ANNUAL percentages (5.8 = 5.8 %). The periodic rate is
//   annual / periodsPerYear (nominal, the near-universal consumer-loan
//   convention); APR is informational, never used to compound.
// • A "period" is one scheduled payment: monthly = 12/yr, weekly = 52,
//   biweekly = 26, quarterly = 4, yearly = 1. Irregular debts have no periods
//   and no schedule — see the callers, which must treat null as "unknown".
// • Every schedule is CAPPED (default 600 periods ≈ 50 years monthly). A
//   payment that does not cover the interest never converges; the result says
//   so (`converges: false`) instead of inventing a date.

export type Cents = number

export type PaymentFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly" | "irregular"
export const PAYMENT_FREQUENCIES: readonly PaymentFrequency[] = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "irregular"]

export function toCents(amount: number | string | null | undefined): Cents {
  const n = Number(amount)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

export function fromCents(cents: Cents): number {
  return Math.round(cents) / 100
}

/** Half-up rounding to an integer (we never pass negatives here). */
const roundCents = (n: number): Cents => Math.round(n)

/**
 * A level payment rounded to the cent can leave a few cents (or a few euros on
 * a 30-year loan) after the planned last instalment. Lenders fold that residue
 * into the FINAL payment rather than issue one more tiny instalment; so do we.
 * The residue must be small relative to the payment — never a whole instalment.
 */
export function finalPaymentTolerance(scheduledPayment: Cents): Cents {
  return Math.min(scheduledPayment, Math.max(100, roundCents(scheduledPayment * 0.02)))
}

/** Scheduled payments per year for a frequency; null for irregular (no schedule). */
export function periodsPerYear(frequency: PaymentFrequency | null | undefined): number | null {
  switch (frequency) {
    case "weekly": return 52
    case "biweekly": return 26
    case "monthly": return 12
    case "quarterly": return 4
    case "yearly": return 1
    default: return null
  }
}

/** Periodic decimal rate from an annual percentage (5.8 %, monthly → 0.004833…). */
export function periodicRate(annualRatePct: number, ppy: number): number {
  if (!Number.isFinite(annualRatePct) || annualRatePct <= 0 || ppy <= 0) return 0
  return annualRatePct / 100 / ppy
}

/** Interest accrued on `balance` over one period, rounded to the cent. */
export function interestForPeriod(balance: Cents, annualRatePct: number | null | undefined, ppy: number): Cents {
  if (balance <= 0 || annualRatePct == null) return 0
  return roundCents(balance * periodicRate(annualRatePct, ppy))
}

/**
 * Standard annuity payment for a fully amortizing loan: the level payment that
 * retires `principal` in `periods` payments at the given rate. Rate 0 → equal
 * instalments (rounded UP so the loan is cleared, never left with a remainder).
 */
export function paymentForLoan(principal: Cents, annualRatePct: number | null | undefined, periods: number, ppy = 12): Cents {
  if (principal <= 0 || periods <= 0) return 0
  const r = periodicRate(annualRatePct ?? 0, ppy)
  if (r === 0) return Math.ceil(principal / periods)
  const factor = Math.pow(1 + r, periods)
  return roundCents((principal * r * factor) / (factor - 1))
}

/** Convert a payment made every `frequency` into a per-month equivalent (for the monthly planner). */
export function monthlyEquivalent(payment: Cents, frequency: PaymentFrequency | null | undefined): Cents {
  const ppy = periodsPerYear(frequency)
  if (ppy == null || payment <= 0) return 0
  return roundCents((payment * ppy) / 12)
}

export type ScheduleRow = {
  period: number
  payment: Cents
  interest: Cents
  principal: Cents
  balance: Cents
}

export type AmortizationResult = {
  rows: ScheduleRow[]
  periods: number
  totalInterest: Cents
  totalPaid: Cents
  /** false when the payment never retires the balance within `maxPeriods` (e.g. it doesn't cover the interest). */
  converges: boolean
}

/**
 * Amortize a balance with a level payment (+ optional extra principal each
 * period). Interest is computed on the opening balance of each period and
 * rounded once; the FINAL payment is exactly balance + interest, so the loan
 * ends at 0 — never at a stray few cents.
 */
export function amortize(input: {
  balance: Cents
  annualRatePct: number | null | undefined
  payment: Cents
  extraPerPeriod?: Cents
  ppy?: number
  maxPeriods?: number
  /** Keep every row (default) or only the summary (rows = []) for big loans on hot paths. */
  keepRows?: boolean
}): AmortizationResult {
  const ppy = input.ppy ?? 12
  const maxPeriods = input.maxPeriods ?? 600
  const keepRows = input.keepRows ?? true
  const rate = input.annualRatePct ?? 0
  const scheduled = Math.max(0, input.payment) + Math.max(0, input.extraPerPeriod ?? 0)
  let balance = Math.max(0, Math.round(input.balance))
  const rows: ScheduleRow[] = []
  let totalInterest = 0
  let totalPaid = 0
  let period = 0

  while (balance > 0 && period < maxPeriods) {
    period++
    const interest = interestForPeriod(balance, rate, ppy)
    // The last payment is whatever is left (balance + this period's interest),
    // including a small rounding residue that would otherwise need one more payment.
    const due = balance + interest
    const payment = due - scheduled <= finalPaymentTolerance(scheduled) ? due : scheduled
    const principal = payment - interest
    if (principal <= 0) {
      // Payment does not even cover the interest: the balance can only grow.
      return { rows, periods: period - 1, totalInterest, totalPaid, converges: false }
    }
    balance -= principal
    totalInterest += interest
    totalPaid += payment
    if (keepRows) rows.push({ period, payment, interest, principal, balance })
  }

  return { rows, periods: period, totalInterest, totalPaid, converges: balance === 0 }
}

/**
 * Split ONE payment into principal / interest when the loan's rate is known:
 * interest for the period on the current balance, the rest principal (capped at
 * the balance). Without a rate the whole payment is principal — an informal,
 * interest-free debt never grows a fake interest line. `source` says which.
 */
export function splitPayment(input: {
  total: Cents
  balance: Cents
  annualRatePct: number | null | undefined
  frequency: PaymentFrequency | null | undefined
}): { principal: Cents; interest: Cents; source: "calculated" | "principal_only" } {
  const total = Math.max(0, Math.round(input.total))
  const balance = Math.max(0, Math.round(input.balance))
  const ppy = periodsPerYear(input.frequency) ?? 12
  if (input.annualRatePct == null || input.annualRatePct <= 0) {
    return { principal: Math.min(total, balance) || total, interest: 0, source: "principal_only" }
  }
  const interest = Math.min(total, interestForPeriod(balance, input.annualRatePct, ppy))
  const principal = Math.min(total - interest, balance)
  return { principal: Math.max(0, principal), interest, source: "calculated" }
}

// ── Dates (UTC ISO 'YYYY-MM-DD', same conventions as recurring.ts) ───────────

function parseIso(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number)
  return { y, m, d }
}
const toIso = (y: number, m: number, d: number) => `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

/**
 * The date `n` periods after `anchor`. Month-based frequencies clamp the
 * anchor's day (31st → Feb 28/29) and never drift; day-based ones step by days.
 */
export function addPeriods(anchor: string, frequency: PaymentFrequency, n: number): string {
  const { y, m, d } = parseIso(anchor)
  if (frequency === "weekly" || frequency === "biweekly") {
    const days = (frequency === "weekly" ? 7 : 14) * n
    const dt = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
    return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
  }
  const step = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : frequency === "yearly" ? 12 : 0
  if (step === 0) return anchor
  const total = m - 1 + step * n
  const ny = y + Math.floor(total / 12)
  const nm = (total % 12) + 1
  return toIso(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

/** First scheduled date strictly after `after`, walking from `anchor` by `frequency`. */
export function nextDueAfter(anchor: string, frequency: PaymentFrequency, after: string): string {
  let n = 0
  let d = anchor
  while (d <= after && n < 5000) {
    n++
    d = addPeriods(anchor, frequency, n)
  }
  return d
}

/** Month key 'YYYY-MM' of an ISO date. */
export const monthKey = (iso: string): string => iso.slice(0, 7)

/** ISO date `months` whole months after `iso` (day clamped). */
export const addMonths = (iso: string, months: number): string => addPeriods(iso, "monthly", months)

// What a debt will DO, worked out from what has been typed so far — before it
// exists. Pure, so the add form can recompute it on every keystroke and the
// tests can pin every branch.
//
// The point is that the consequential numbers on a debt are not the ones you
// enter. Nobody types "this costs me €118 of interest and ends in April 2029";
// they type an amount, a rate and an instalment, and those three decide it. A
// preview is the only place the decision is visible while it can still be
// changed.
//
// `.js` extensions: debt-math is reachable from the api/ functions, which run as
// unbundled ESM on @vercel/node.
import { addPeriods, amortize, interestForPeriod, periodsPerYear, type Cents, type PaymentFrequency } from "./debt-math.js"
import { progressPct } from "./debt-status.js"

/** The rhythms a scheduled repayment can run on — "irregular" has no schedule. */
export type ScheduledFrequency = Exclude<PaymentFrequency, "irregular">

export type DebtPreview =
  /** Nothing worth showing yet — no amount entered. */
  | { kind: "empty" }
  /** Tracked by hand: no schedule, so no payoff date can be honest. */
  | { kind: "manual"; owed: Cents; repaidPct: number | null }
  /** It pays itself off, and here is when and what it costs. */
  | {
      kind: "schedule"
      owed: Cents
      perPayment: Cents
      payments: number
      /** The last instalment, which is usually smaller than the rest. */
      finalPayment: Cents
      totalInterest: Cents
      totalPaid: Cents
      payoffDate: string
      /** No rate was entered, so this assumes 0 %. */
      assumedZeroRate: boolean
    }
  /** The instalment does not cover the interest: the balance can only grow. */
  | { kind: "never"; owed: Cents; perPayment: Cents; minimumPayment: Cents }
  /** It converges, but past the horizon worth drawing. */
  | { kind: "too_long"; owed: Cents; perPayment: Cents; years: number }

/** The horizon a preview will walk: 600 periods is ~50 years of monthly payments. */
export const PREVIEW_MAX_PERIODS = 600

export function previewDebt(input: {
  owed: Cents
  original: Cents | null
  annualRatePct: number | null
  repayment: { amount: Cents; frequency: ScheduledFrequency; firstPayment: string } | null
  maxPeriods?: number
}): DebtPreview {
  const owed = Math.max(0, Math.round(input.owed))
  if (owed <= 0) return { kind: "empty" }

  const repayment = input.repayment
  if (!repayment || repayment.amount <= 0) {
    return { kind: "manual", owed, repaidPct: progressPct(input.original, owed) }
  }

  const maxPeriods = input.maxPeriods ?? PREVIEW_MAX_PERIODS
  const ppy = periodsPerYear(repayment.frequency) ?? 12
  const perPayment = Math.round(repayment.amount)

  // Whether it converges is decided entirely by the FIRST period: if the
  // instalment clears that period's interest the balance falls, so the next
  // period's interest is smaller, and it can only keep falling. If it doesn't,
  // the balance can only grow — there is no date to show, and saying "50 years"
  // would be a lie rather than a long answer.
  const firstInterest = interestForPeriod(owed, input.annualRatePct, ppy)
  if (perPayment <= firstInterest) {
    return { kind: "never", owed, perPayment, minimumPayment: firstInterest + 1 }
  }

  const result = amortize({ balance: owed, annualRatePct: input.annualRatePct ?? 0, payment: perPayment, ppy, maxPeriods })
  if (!result.converges) {
    return { kind: "too_long", owed, perPayment, years: Math.round(maxPeriods / ppy) }
  }

  return {
    kind: "schedule",
    owed,
    perPayment,
    payments: result.periods,
    finalPayment: result.rows.at(-1)?.payment ?? perPayment,
    totalInterest: result.totalInterest,
    totalPaid: result.totalPaid,
    // The first instalment is period 1, so the last lands `payments - 1` periods later.
    payoffDate: addPeriods(repayment.firstPayment, repayment.frequency, result.periods - 1),
    assumedZeroRate: input.annualRatePct == null,
  }
}

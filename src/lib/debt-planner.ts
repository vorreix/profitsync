// The debt-clearance planner: month-by-month simulation of several debts under
// a repayment strategy, with the ROLLOVER engine (a cleared debt's payment joins
// the pool for the next debt). Pure, deterministic, integer cents, capped —
// the UI and the API call the same functions, and the tests pin the maths.
//
// Strategies (labels in the UI are friendlier; the maths is here):
//   minimum   — pay only the scheduled payments; nothing extra and NO rollover
//               (a finished loan's payment is simply not spent). The baseline:
//               "if I keep doing exactly what I do today".
//   avalanche — extra goes to the HIGHEST interest rate first (min total interest).
//   snowball  — extra goes to the SMALLEST balance first (earliest cleared debt).
//   cashflow  — "Free up monthly cash": extra goes to the debt whose scheduled
//               payment is largest RELATIVE to its balance (payment ÷ balance),
//               i.e. the one that returns the most monthly breathing room per
//               euro of extra repayment. Ties → smaller balance first.
//   custom    — the user's own order, honoured exactly; consequences are shown,
//               never judged.
//
// Every month, for each open debt: interest accrues on the opening balance
// (rounded once), the scheduled minimum is paid (capped at what is owed), then
// the pool (extra + payments freed by debts cleared in EARLIER months) is
// poured into debts in strategy order. When a debt reaches zero its minimum is
// released into the pool from the NEXT month on.
//
// Unknown interest rates are simulated at 0 % and reported (`assumedZeroRate`),
// so a projection is never more certain than its inputs. A debt with no
// scheduled payment (informal, irregular) only ever receives pool money; under
// "minimum" it never clears, which is the truthful answer.

import { finalPaymentTolerance, interestForPeriod, type Cents } from "./debt-math.js"

export type Strategy = "minimum" | "avalanche" | "snowball" | "cashflow" | "custom"
export const STRATEGIES: readonly Strategy[] = ["minimum", "avalanche", "snowball", "cashflow", "custom"]

export type PlannerDebt = {
  id: string
  name: string
  /** Amount owed today, in cents (> 0 to take part). */
  balance: Cents
  /** Annual % or null when unknown. */
  annualRatePct: number | null
  /** Scheduled payment per MONTH (use debt-math.monthlyEquivalent for other frequencies). 0 = none. */
  minPayment: Cents
}

export type DebtOutcome = {
  id: string
  /** 1-based month in which the debt reached zero; null = not within the horizon. */
  clearedMonth: number | null
  interestPaid: Cents
  principalPaid: Cents
}

export type PlanResult = {
  strategy: Strategy
  /** Months until every debt is cleared; null when the plan never gets there within the horizon. */
  months: number | null
  totalInterest: Cents
  totalPaid: Cents
  requiredMonthly: Cents
  extraMonthly: Cents
  firstCleared: { id: string; month: number } | null
  debts: DebtOutcome[]
  /** Total balance at the end of month 0 (today), 12, 24, … and the final month — for the payoff chart. */
  series: { month: number; balance: Cents }[]
  /** Debts whose rate was unknown and simulated at 0 %. */
  assumedZeroRate: string[]
  /** Order in which the pool was applied. */
  order: string[]
}

export const MAX_PLAN_MONTHS = 600

/** Rank debts for the pool under a strategy. Deterministic tie-breaks so results never flicker. */
export function rankDebts(debts: PlannerDebt[], strategy: Strategy, customOrder: string[] = []): PlannerDebt[] {
  const list = debts.filter((d) => d.balance > 0)
  const byBalanceAsc = (a: PlannerDebt, b: PlannerDebt) => a.balance - b.balance || a.id.localeCompare(b.id)
  switch (strategy) {
    case "avalanche":
      return [...list].sort((a, b) => (b.annualRatePct ?? 0) - (a.annualRatePct ?? 0) || b.balance - a.balance || a.id.localeCompare(b.id))
    case "snowball":
      return [...list].sort(byBalanceAsc)
    case "cashflow":
      return [...list].sort((a, b) => {
        const ra = a.balance > 0 ? a.minPayment / a.balance : 0
        const rb = b.balance > 0 ? b.minPayment / b.balance : 0
        return rb - ra || byBalanceAsc(a, b)
      })
    case "custom": {
      const pos = new Map(customOrder.map((id, i) => [id, i]))
      // Debts missing from the custom list go last, smallest first, so nothing is silently dropped.
      return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || byBalanceAsc(a, b))
    }
    case "minimum":
    default:
      return [...list].sort(byBalanceAsc)
  }
}

/**
 * Simulate a plan. `lumpSumNow` is applied in month 1 before anything else,
 * following the strategy order (a what-if for "what if I pay €1,000 today?").
 */
export function simulatePlan(input: {
  debts: PlannerDebt[]
  strategy: Strategy
  extraMonthly?: Cents
  lumpSumNow?: Cents
  customOrder?: string[]
  maxMonths?: number
}): PlanResult {
  const strategy = input.strategy
  const extraMonthly = strategy === "minimum" ? 0 : Math.max(0, Math.round(input.extraMonthly ?? 0))
  const maxMonths = input.maxMonths ?? MAX_PLAN_MONTHS
  const order = rankDebts(input.debts, strategy, input.customOrder)
  const state = new Map(order.map((d) => [d.id, { ...d, balance: Math.round(d.balance), interestPaid: 0, principalPaid: 0, clearedMonth: null as number | null }]))
  const assumedZeroRate = order.filter((d) => d.annualRatePct == null).map((d) => d.id)
  const requiredMonthly = order.reduce((s, d) => s + Math.max(0, d.minPayment), 0)

  const totalBalance = () => [...state.values()].reduce((s, d) => s + d.balance, 0)
  const series: PlanResult["series"] = [{ month: 0, balance: totalBalance() }]
  let totalInterest = 0
  let totalPaid = 0
  let freed = 0 // minimums released by debts cleared in earlier months
  let firstCleared: PlanResult["firstCleared"] = null
  let month = 0
  let lump = Math.max(0, Math.round(input.lumpSumNow ?? 0))
  let stalledMonths = 0

  const pour = (amount: Cents, m: number): Cents => {
    let pool = amount
    for (const id of order.map((d) => d.id)) {
      if (pool <= 0) break
      const d = state.get(id)!
      if (d.balance <= 0) continue
      const p = Math.min(pool, d.balance)
      d.balance -= p
      d.principalPaid += p
      pool -= p
      totalPaid += p
      if (d.balance === 0) clear(d, m)
    }
    return pool
  }
  const clear = (d: { id: string; minPayment: Cents; clearedMonth: number | null }, m: number) => {
    if (d.clearedMonth != null) return
    d.clearedMonth = m
    if (!firstCleared) firstCleared = { id: d.id, month: m }
  }

  while (totalBalance() > 0 && month < maxMonths) {
    month++
    const before = totalBalance()
    // Lump sum on day one of the plan, in strategy order.
    if (lump > 0) lump = pour(lump, month)
    // Interest, then scheduled minimums.
    const freedThisMonth: Cents[] = []
    for (const d of state.values()) {
      if (d.balance <= 0) continue
      const interest = interestForPeriod(d.balance, d.annualRatePct ?? 0, 12)
      d.balance += interest
      d.interestPaid += interest
      totalInterest += interest
      // The last scheduled payment absorbs a small rounding residue (debt-math).
      const min = Math.max(0, d.minPayment)
      const pay = d.balance - min <= finalPaymentTolerance(min) ? d.balance : Math.min(min, d.balance)
      d.balance -= pay
      d.principalPaid += pay - interest
      totalPaid += pay
      if (d.balance === 0) { clear(d, month); freedThisMonth.push(d.minPayment) }
    }
    // The pool: this month's extra + minimums freed in EARLIER months. The
    // minimum-only baseline has no pool at all — nothing is redirected.
    if (strategy !== "minimum") pour(extraMonthly + freed, month)
    // Minimums freed this month (by the pool or the last scheduled payment) join from next month.
    for (const d of state.values()) {
      if (d.clearedMonth === month && !freedThisMonth.includes(d.minPayment)) freedThisMonth.push(d.minPayment)
    }
    // Recompute freed from cleared debts (idempotent, avoids double counting).
    freed = [...state.values()].filter((d) => d.clearedMonth != null).reduce((s, d) => s + Math.max(0, d.minPayment), 0)

    const after = totalBalance()
    if (month % 12 === 0 && after > 0) series.push({ month, balance: after })
    // Not converging: balances not shrinking for a year → stop, report null.
    stalledMonths = after >= before ? stalledMonths + 1 : 0
    if (stalledMonths >= 12) break
  }

  const done = totalBalance() === 0
  if (done && (series[series.length - 1]?.month ?? -1) !== month) series.push({ month, balance: 0 })

  return {
    strategy,
    months: done ? month : null,
    totalInterest,
    totalPaid,
    requiredMonthly,
    extraMonthly,
    firstCleared,
    debts: order.map((d) => {
      const s = state.get(d.id)!
      return { id: d.id, clearedMonth: s.clearedMonth, interestPaid: s.interestPaid, principalPaid: s.principalPaid }
    }),
    series,
    assumedZeroRate,
    order: order.map((d) => d.id),
  }
}

export type PlanComparison = {
  baseline: PlanResult
  plans: PlanResult[]
  /** Per strategy: months and interest saved vs the minimum-only baseline (null when either is open-ended). */
  savings: Record<Strategy, { monthsSaved: number | null; interestSaved: Cents | null }>
}

/** Run every strategy with the same extra amount and compare them to minimum-only. */
export function comparePlans(input: { debts: PlannerDebt[]; extraMonthly: Cents; customOrder?: string[]; lumpSumNow?: Cents }): PlanComparison {
  const baseline = simulatePlan({ debts: input.debts, strategy: "minimum" })
  const plans = STRATEGIES.filter((s) => s !== "minimum").map((strategy) =>
    simulatePlan({ debts: input.debts, strategy, extraMonthly: input.extraMonthly, customOrder: input.customOrder, lumpSumNow: input.lumpSumNow }),
  )
  const savings = {} as PlanComparison["savings"]
  for (const p of [baseline, ...plans]) {
    savings[p.strategy] = {
      monthsSaved: baseline.months != null && p.months != null ? baseline.months - p.months : null,
      interestSaved: baseline.months != null && p.months != null ? baseline.totalInterest - p.totalInterest : null,
    }
  }
  return { baseline, plans, savings }
}

export type Affordability =
  | { mode: "optimize"; requiredMonthly: Cents; budget: Cents; extra: Cents }
  | { mode: "stabilize"; requiredMonthly: Cents; budget: Cents; gap: Cents }

/**
 * Can the monthly debt budget cover every scheduled payment? If not, the UX
 * switches from optimisation (which strategy?) to stabilisation (what is due,
 * what is short) — recommending Avalanche to someone €320 short is noise.
 */
export function affordability(requiredMonthly: Cents, budget: Cents): Affordability {
  if (budget >= requiredMonthly) return { mode: "optimize", requiredMonthly, budget, extra: budget - requiredMonthly }
  return { mode: "stabilize", requiredMonthly, budget, gap: requiredMonthly - budget }
}

/** Debt-payment ratio: cents of every €1 of net monthly income committed to scheduled debt payments (null without income). */
export function debtPaymentRatio(requiredMonthly: Cents, netMonthlyIncome: Cents | null | undefined): number | null {
  if (!netMonthlyIncome || netMonthlyIncome <= 0) return null
  return Math.round((requiredMonthly / netMonthlyIncome) * 1000) / 10
}

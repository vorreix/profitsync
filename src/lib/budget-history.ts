// Pure budget-history + insight helpers — NO imports (so the unbundled Vercel API,
// the Vite frontend, and the unit tests all consume it without any module-resolution
// quirks). Mirrors the period/threshold semantics of src/lib/budget.ts.

export type BudgetPeriod = "lifetime" | "monthly" | "weekly" | "daily"
export type BudgetAction = "set" | "raise" | "lower" | "period_change" | "remove"
export type SeriesState = "ok" | "warn" | "over" | "none"

/** Warn once 80% of the budget is used; "over" once exceeded (same as budgetState). */
export const BUDGET_WARN_RATIO = 0.8
export function seriesState(spent: number, budget: number): SeriesState {
  if (!(budget > 0)) return "none"
  if (spent > budget) return "over"
  return spent / budget >= BUDGET_WARN_RATIO ? "warn" : "ok"
}

export type BudgetSnapshot = { amount: number; period: BudgetPeriod }

/**
 * Classify a budget change for the timeline. "remove" is handled by the caller
 * (amount 0). Returns null when nothing actually changed (no history row needed).
 */
export function budgetChangeAction(prev: BudgetSnapshot | null, next: BudgetSnapshot): BudgetAction | null {
  if (!prev) return "set"
  if (next.amount > prev.amount) return "raise"
  if (next.amount < prev.amount) return "lower"
  if (next.period !== prev.period) return "period_change"
  return null
}

export type PeriodWindow = { start: string; endExclusive: string }

const p2 = (n: number) => String(n).padStart(2, "0")
const ymd = (y: number, m1: number, d: number) => `${y}-${p2(m1)}-${p2(d)}`
const DAY_MS = 86_400_000

/**
 * The last `n` period windows `[start, endExclusive)` for a cadence, oldest → newest,
 * as YYYY-MM-DD (UTC) — matching how transactions stamp `date`. Lifetime has no
 * periodic windows (returns []).
 */
export function periodBoundaries(period: BudgetPeriod, n: number, now: Date = new Date()): PeriodWindow[] {
  if (period === "lifetime" || n <= 0) return []
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  const windows: PeriodWindow[] = []

  if (period === "monthly") {
    for (let i = n - 1; i >= 0; i--) {
      const s = new Date(Date.UTC(y, m - i, 1))
      const e = new Date(Date.UTC(y, m - i + 1, 1))
      windows.push({
        start: ymd(s.getUTCFullYear(), s.getUTCMonth() + 1, 1),
        endExclusive: ymd(e.getUTCFullYear(), e.getUTCMonth() + 1, 1),
      })
    }
    return windows
  }

  // weekly = Monday-anchored, daily = single days. Both step by a fixed ms delta.
  const stepDays = period === "weekly" ? 7 : 1
  const sinceMonday = (now.getUTCDay() + 6) % 7
  const anchor = period === "weekly"
    ? Date.UTC(y, m, d - sinceMonday) // this week's Monday
    : Date.UTC(y, m, d) // today
  for (let i = n - 1; i >= 0; i--) {
    const s = new Date(anchor - i * stepDays * DAY_MS)
    const e = new Date(anchor - (i - 1) * stepDays * DAY_MS)
    windows.push({
      start: ymd(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()),
      endExclusive: ymd(e.getUTCFullYear(), e.getUTCMonth() + 1, e.getUTCDate()),
    })
  }
  return windows
}

export type HistoryRow = { amount: number; period: BudgetPeriod; action: BudgetAction; createdAt: string }

/**
 * The budget amount in effect at instant `t` (ISO/date string) — the latest snapshot
 * with `createdAt <= t`; 0 if none yet or the latest such change was a "remove".
 * `history` MUST be ascending by createdAt. A change stamped on a period boundary
 * (e.g. the 1st) belongs to the NEW period, which is the intuitive behaviour.
 */
export function budgetAmountAt(history: HistoryRow[], t: string): number {
  let amount = 0
  for (const h of history) {
    if (h.createdAt <= t) amount = h.action === "remove" ? 0 : h.amount
    else break
  }
  return amount
}

export type SeriesPoint = { start: string; spent: number; budget: number; state: SeriesState }

/** Per-window spent (from transactions) vs the budget in effect at the window's close. */
export function buildSeries(
  windows: PeriodWindow[],
  spentByStart: Record<string, number>,
  history: HistoryRow[],
): SeriesPoint[] {
  return windows.map((w) => {
    const spent = spentByStart[w.start] ?? 0
    const budget = budgetAmountAt(history, w.endExclusive)
    return { start: w.start, spent, budget, state: seriesState(spent, budget) }
  })
}

export type Adherence = { rate: number; streak: number; avgDelta: number; periods: number }

/** Adherence over the windows that had a budget: within-budget rate, current
 *  on-budget streak (most-recent-first), and average (spent − budget). */
export function adherence(series: SeriesPoint[]): Adherence {
  const withBudget = series.filter((p) => p.budget > 0)
  const periods = withBudget.length
  if (!periods) return { rate: 0, streak: 0, avgDelta: 0, periods: 0 }
  const within = withBudget.filter((p) => p.spent <= p.budget).length
  let streak = 0
  for (let i = withBudget.length - 1; i >= 0; i--) {
    if (withBudget[i].spent <= withBudget[i].budget) streak++
    else break
  }
  const avgDelta = withBudget.reduce((s, p) => s + (p.spent - p.budget), 0) / periods
  return { rate: within / periods, streak, avgDelta, periods }
}

export type Evolution = { first: number; current: number; pct: number }

/** How the budget changed from when it was first set to now (0 if currently removed). */
export function evolution(history: HistoryRow[]): Evolution | null {
  const active = history.filter((h) => h.action !== "remove")
  if (!active.length) return null
  const first = active[0].amount
  const last = history[history.length - 1]
  const current = last.action === "remove" ? 0 : last.amount
  const pct = first > 0 ? ((current - first) / first) * 100 : 0
  return { first, current, pct }
}

export type Creep = { flagged: boolean; raiseCount: number; pct: number }

/** Budget-creep heuristic: raised ≥2 times AND grown ≥20% since first set. */
export function detectCreep(history: HistoryRow[]): Creep {
  const raiseCount = history.filter((h) => h.action === "raise").length
  const pct = evolution(history)?.pct ?? 0
  return { flagged: raiseCount >= 2 && pct >= 20, raiseCount, pct }
}

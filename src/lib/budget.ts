// Pure budget helpers — no DB/React imports, so they're unit-testable in isolation
// and usable on both the client and the API (.js import in api/**).
//
// A budget targets OUTGOING (expense) spend over a rolling window. Spend itself is
// never stored; it's summed from transactions for the budget's current window.

export const BUDGET_PERIODS = ["lifetime", "monthly", "weekly", "daily"] as const
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number]

export function isBudgetPeriod(v: unknown): v is BudgetPeriod {
  return typeof v === "string" && (BUDGET_PERIODS as readonly string[]).includes(v)
}

/** Two-digit zero-pad. */
const p2 = (n: number) => String(n).padStart(2, "0")
const ymd = (y: number, m: number, d: number) => `${y}-${p2(m)}-${p2(d)}`

/**
 * The inclusive start date (YYYY-MM-DD, UTC) of the budget's CURRENT window, or
 * `null` for "lifetime" (no lower bound). Spend for the period = sum of outgoing
 * transactions with `date >= periodStart`. UTC is used so it matches how the app
 * stamps transaction dates (`toISOString().split("T")[0]`).
 *
 * - daily   → today
 * - weekly  → Monday of this week
 * - monthly → the 1st of this month
 * - lifetime→ null
 */
export function periodStart(period: BudgetPeriod, now: Date = new Date()): string | null {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() // 0-based
  const d = now.getUTCDate()
  switch (period) {
    case "daily":
      return ymd(y, m + 1, d)
    case "weekly": {
      // getUTCDay: 0=Sun … 6=Sat → days since Monday.
      const sinceMonday = (now.getUTCDay() + 6) % 7
      const monday = new Date(Date.UTC(y, m, d - sinceMonday))
      return ymd(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate())
    }
    case "monthly":
      return ymd(y, m + 1, 1)
    case "lifetime":
    default:
      return null
  }
}

export type BudgetState = "ok" | "warn" | "over"

/** Warn once 80% of the budget is used; "over" once it's exceeded. */
export const BUDGET_WARN_RATIO = 0.8

export function budgetState(spent: number, amount: number): {
  ratio: number
  remaining: number
  state: BudgetState
} {
  const safeAmount = amount > 0 ? amount : 0
  const remaining = Math.round((safeAmount - spent) * 100) / 100
  const ratio = safeAmount > 0 ? spent / safeAmount : spent > 0 ? Infinity : 0
  const state: BudgetState = spent > safeAmount ? "over" : ratio >= BUDGET_WARN_RATIO ? "warn" : "ok"
  return { ratio, remaining, state }
}

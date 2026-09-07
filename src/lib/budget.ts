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

// ─── Spending budgets ────────────────────────────────────────────────────────
//
// A SPENDING BUDGET is a named limit over a window, scoped to a set of expense
// categories (or to all spending). Several can coexist, and a main budget can
// carry SUB-BUDGETS that break its scope down. Spend is still never stored — the
// API sums it live for the window below. Everything here is pure so the server
// (api/_lib/spending-budgets.ts), the page, the transaction-form hint and the
// unit suite share one definition of "this month" and "this category".

export const SPENDING_PERIODS = ["daily", "weekly", "monthly", "yearly", "once"] as const
export type SpendingPeriod = (typeof SPENDING_PERIODS)[number]

export function isSpendingPeriod(v: unknown): v is SpendingPeriod {
  return typeof v === "string" && (SPENDING_PERIODS as readonly string[]).includes(v)
}

/** Every period except `once` recurs; the chart and "days left" only make sense for those. */
export const isPeriodic = (period: SpendingPeriod): boolean => period !== "once"

/** `[start, endExclusive)` as YYYY-MM-DD (UTC); `null` = unbounded on that side. */
export type BudgetWindow = { start: string | null; endExclusive: string | null }

export type OnceBounds = { start_date?: string | null; end_date?: string | null }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
export const isIsoDate = (v: unknown): v is string =>
  typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

/** Today as YYYY-MM-DD in UTC — how the app stamps every transaction date. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** `iso` shifted by `days` (UTC, so a DST change can never shorten a window). */
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function addMonths(iso: string, months: number): string {
  const [y, m] = iso.split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1 + months, 1))
  return d.toISOString().slice(0, 10)
}

/** Whole days from `a` to `b` (b − a); negative when b is earlier. */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/**
 * The budget's CURRENT window for `today`. Calendar-aligned in UTC exactly like
 * the v1 client caps: a week runs Monday→Monday, a month from the 1st, a year
 * from 1 January. A `once` budget's window is its own dates — `end_date` is the
 * last INCLUSIVE day, so the exclusive end is the day after; a missing bound is
 * open (both missing = all time, which is what a v1 `lifetime` budget becomes).
 */
export function budgetWindow(period: SpendingPeriod, bounds: OnceBounds | null | undefined, today: string): BudgetWindow {
  switch (period) {
    case "daily":
      return { start: today, endExclusive: addDays(today, 1) }
    case "weekly": {
      const dow = new Date(`${today}T00:00:00Z`).getUTCDay() // 0 = Sun
      const monday = addDays(today, -((dow + 6) % 7))
      return { start: monday, endExclusive: addDays(monday, 7) }
    }
    case "monthly": {
      const first = `${today.slice(0, 7)}-01`
      return { start: first, endExclusive: addMonths(first, 1) }
    }
    case "yearly": {
      const first = `${today.slice(0, 4)}-01-01`
      return { start: first, endExclusive: addMonths(first, 12) }
    }
    case "once":
    default: {
      const start = bounds?.start_date && isIsoDate(bounds.start_date) ? bounds.start_date : null
      const end = bounds?.end_date && isIsoDate(bounds.end_date) ? addDays(bounds.end_date, 1) : null
      return { start, endExclusive: end }
    }
  }
}

/**
 * The last `n` windows of a periodic budget, oldest → newest, ENDING with the
 * current one. Feeds the spend-vs-limit chart. Empty for `once`.
 */
export function windowsBack(period: SpendingPeriod, n: number, today: string): BudgetWindow[] {
  if (!isPeriodic(period) || n <= 0) return []
  const current = budgetWindow(period, null, today)
  const out: BudgetWindow[] = []
  for (let i = n - 1; i >= 0; i--) {
    const start = current.start!
    let s: string
    let e: string
    if (period === "daily" || period === "weekly") {
      const step = period === "weekly" ? 7 : 1
      s = addDays(start, -i * step)
      e = addDays(s, step)
    } else {
      const step = period === "yearly" ? 12 : 1
      s = addMonths(start, -i * step)
      e = addMonths(s, step)
    }
    out.push({ start: s, endExclusive: e })
  }
  return out
}

export type WindowPhase = "upcoming" | "active" | "ended"

/** Has the window started / finished relative to `today`? Only `once` can be upcoming or ended. */
export function windowPhase(w: BudgetWindow, today: string): WindowPhase {
  if (w.start && today < w.start) return "upcoming"
  if (w.endExclusive && today >= w.endExclusive) return "ended"
  return "active"
}

/**
 * Days still inside the window, counting today: on the last day of a month it
 * is 1, the day after it is 0. `null` when the window has no end.
 */
export function daysLeft(w: BudgetWindow, today: string): number | null {
  if (!w.endExclusive) return null
  // A window that has not opened has no "days left" yet — it has days until it starts.
  if (w.start && today < w.start) return null
  return Math.max(0, diffDays(today, w.endExclusive))
}

/** Is `date` inside the window? Open bounds accept anything on that side. */
export function inWindow(w: BudgetWindow, date: string): boolean {
  if (w.start && date < w.start) return false
  if (w.endExclusive && date >= w.endExclusive) return false
  return true
}

/** "You can spend about €X a day for the rest of the window" — only when there is money and time left. */
export function perDayLeft(remaining: number, days: number | null): number | null {
  if (days === null || days <= 0 || remaining <= 0) return null
  return Math.round((remaining / days) * 100) / 100
}

/**
 * The normalised category key — the JS twin of the SQL
 * `lower(btrim(coalesce(category, '')))` every spend query matches on. Postgres'
 * btrim strips only ASCII spaces, so this deliberately does the same rather
 * than using `.trim()`, which is wider (it would also strip a non-breaking
 * space and give two answers for one row).
 */
export function categoryKey(s: string | null | undefined): string {
  return (s ?? "").replace(/^ +| +$/g, "").toLowerCase()
}

/** Dedupe by key, keeping the first spelling seen; drops blanks. */
export function normaliseCategories(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const k = categoryKey(raw)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(raw.replace(/^ +| +$/g, ""))
  }
  return out
}

/** Does a transaction in `category` count towards a budget with this scope? Empty scope = all spending. */
export function scopeMatches(categories: readonly string[], category: string | null | undefined): boolean {
  if (categories.length === 0) return true
  const k = categoryKey(category)
  return categories.some((c) => categoryKey(c) === k)
}

/** Which of `a`'s categories also appear in `b`? Used to refuse sibling overlap. */
export function categoryOverlap(a: readonly string[], b: readonly string[]): string[] {
  const keys = new Set(b.map(categoryKey))
  return a.filter((c) => keys.has(categoryKey(c)))
}

/** Every category of `child` must be in `parent`'s scope — unless the parent is all spending. */
export function categoriesWithin(child: readonly string[], parent: readonly string[]): boolean {
  if (parent.length === 0) return true
  const keys = new Set(parent.map(categoryKey))
  return child.every((c) => keys.has(categoryKey(c)))
}

/**
 * Spend inside a main budget that none of its sub-budgets claim. Signed like
 * everything else here — a refund-heavy child can push it above the parent's
 * own figure, and hiding that would be lying.
 */
export function otherSpent(parentSpent: number, childrenSpent: readonly number[]): number {
  return Math.round((parentSpent - childrenSpent.reduce((s, n) => s + n, 0)) * 100) / 100
}

// ─── The view window ─────────────────────────────────────────────────────────
//
// Budgets are AUTHORED in the rhythm the user thinks in — rent monthly, coffee
// weekly — but they can only be compared, summed and set against one overall
// limit when they are all expressed in the SAME window. So the page carries one
// toggle (Day / Week / Month / Year) and every limit is converted into it. The
// window that matches how a budget was authored reads exactly; the others read
// as its stated equivalent.
//
// Everything pivots through a MONTHLY equivalent and rounds ONCE at the end, so
// a weekly 50 reads as exactly 2,600 a year rather than 2,600.04.

export const VIEW_WINDOWS = ["daily", "weekly", "monthly", "yearly"] as const
export type ViewWindow = (typeof VIEW_WINDOWS)[number]

export function isViewWindow(v: unknown): v is ViewWindow {
  return typeof v === "string" && (VIEW_WINDOWS as readonly string[]).includes(v)
}

/**
 * How many days each rhythm spans. Conversions pivot through a DAY, not a
 * month: a week must be exactly 7 days or "€10 a day" reads as "€70.24 a week"
 * and the first thing a user checks in their head is wrong. The month and year
 * are the Gregorian means, which is the only sensible answer for "a month".
 */
export const PERIOD_DAYS: Record<Exclude<SpendingPeriod, "once">, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30.436875,
  yearly: 365.2425,
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The view's calendar window containing `today` — the same windows a budget can be authored in. */
export function viewRange(view: ViewWindow, today: string): BudgetWindow {
  return budgetWindow(view, null, today)
}

/** An authored limit as a rate per day — the pivot every conversion goes through. */
export function perDayRate(amount: number, period: SpendingPeriod): number {
  if (!Number.isFinite(amount) || amount <= 0 || period === "once") return 0
  return amount / PERIOD_DAYS[period]
}

/**
 * The limit to QUOTE for a budget as a rate in another rhythm — "€300 a month
 * is about €9.86 a day". Exact in the rhythm it was authored in. A `once`
 * budget is a fixed sum over fixed dates, not a rate, so it never converts.
 */
export function limitForView(amount: number, period: SpendingPeriod, view: ViewWindow): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (period === "once" || period === view) return round2(amount)
  return round2(perDayRate(amount, period) * PERIOD_DAYS[view])
}

/** True when the view IS the rhythm the budget was authored in, so its figure is exact. */
export const viewMatchesPeriod = (period: SpendingPeriod, view: ViewWindow): boolean => period === view

/**
 * The limit a window must actually be JUDGED against — which is not always the
 * one on screen. `limitForView` pivots through the mean month so a headline
 * reads sensibly ("€20 a day is about €609 a month"); but a real February is 28
 * days, and marking an 8% overspend as "on budget" because the mean month is
 * longer is a wrong verdict, not a rounding cosmetic.
 *
 * So: when the budget was authored in the window's own rhythm the limit is
 * exactly what the user typed (a €300 month is €300 in February too); otherwise
 * it is the daily rate times the days the window really has.
 */
export function limitForWindow(amount: number, period: SpendingPeriod, view: ViewWindow, window: BudgetWindow): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  if (period === view) return round2(amount)
  const days = window.start && window.endExclusive ? diffDays(window.start, window.endExclusive) : 0
  return Math.round(perDayRate(amount, period) * days * 100) / 100
}

export type Allocation = {
  /** Σ of the budgets' limits in the view window. */
  allocated: number
  /** What the overall budget has not handed out; null when there is no overall budget. */
  unallocated: number | null
  /** The budgets add up to more than the overall limit. */
  over: boolean
}

/**
 * How much of the overall budget the individual budgets account for. Their
 * scopes are disjoint by rule, so this is a plain sum and means something.
 */
export function allocation(overallLimit: number | null, limits: readonly number[]): Allocation {
  const raw = limits.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0)
  const allocated = round2(raw)
  if (overallLimit === null || !Number.isFinite(overallLimit)) return { allocated, unallocated: null, over: false }
  return {
    allocated,
    unallocated: round2(overallLimit - raw),
    // Half a cent of slack: a rounding artefact must never paint the header amber.
    over: raw > overallLimit + 0.005,
  }
}

/**
 * The limit in effect at `t`, or `null` when the budget did not exist yet.
 *
 * The distinction matters: without it a budget created last week is painted
 * across a year of windows it was never part of, and every one of those
 * fabricated verdicts lands in the on-budget rate and the streak.
 */
export function limitAt(
  history: readonly AmountChange[],
  t: string,
  current: number,
  createdAt: string | null,
): number | null {
  if (createdAt && t <= createdAt) return null
  return amountAt(history, t, current)
}

/**
 * The newest instant at which a field was CHANGED — creating the budget does
 * not count. Without that distinction every window before a budget was made
 * looks "unreliable" and nothing is ever judged.
 */
export function lastChangedAt(history: readonly AmountChange[], field: string): string | null {
  let latest: string | null = null
  for (const h of history) {
    if (!h.created_at || !h.changes?.[field]) continue
    if (h.action && h.action !== "update") continue
    if (!latest || h.created_at > latest) latest = h.created_at
  }
  return latest
}

export type SpendingBudgetLite = {
  id: string
  parent_id: string | null
  name: string
  amount: number
  spent: number
  categories: string[]
  status: "active" | "closed"
  /** The current window, as the API reports it; a row outside it is not this budget's business. */
  window?: { start: string | null; end_exclusive: string | null } | null
}

/**
 * The budget the transaction form should quote for `category` on `date`: the
 * most SPECIFIC one — a sub-budget beats a main budget with categories, which
 * beats an all-spending budget — and among equals the one with the least room.
 * Paused budgets never speak, and neither does one whose window the date falls
 * outside (a receipt backdated into last month does not touch this month).
 */
export function tightestBudget<T extends SpendingBudgetLite>(
  budgets: readonly T[],
  category: string | null | undefined,
  date?: string | null,
): T | null {
  const rank = (b: T) => (b.parent_id ? 0 : b.categories.length > 0 ? 1 : 2)
  const inside = (b: T) =>
    !date || !b.window || inWindow({ start: b.window.start, endExclusive: b.window.end_exclusive }, date)
  const matching = budgets.filter((b) => b.status === "active" && b.amount > 0 && scopeMatches(b.categories, category) && inside(b))
  if (!matching.length) return null
  return [...matching].sort((a, b) => rank(a) - rank(b) || (a.amount - a.spent) - (b.amount - b.spent))[0]
}

export type AmountChange = {
  created_at: string | null
  /** create | update | delete, from the audit trail. */
  action?: string
  changes: Record<string, { from: unknown; to: unknown } | undefined>
}

/**
 * The limit in effect at instant `t` (ISO), read off the budget's audit trail —
 * newest first, as the API returns it. Before the first recorded change the
 * amount is whatever the earliest entry moved FROM, or `current` when the
 * trail is empty; so lowering a limit today does not repaint last month.
 */
export function amountAt(history: readonly AmountChange[], t: string, current: number): number {
  const asc = history
    .filter((h) => h.created_at && h.changes?.amount && typeof h.changes.amount.to === "number")
    .sort((a, b) => a.created_at!.localeCompare(b.created_at!))
  if (!asc.length) return current
  const first = asc[0].changes.amount!
  let amount = typeof first.from === "number" ? first.from : current
  for (const h of asc) {
    if (h.created_at! <= t) amount = h.changes.amount!.to as number
    else break
  }
  return amount
}

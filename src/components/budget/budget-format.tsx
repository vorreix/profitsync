import type { TFunction } from "i18next"
import { budgetState, daysLeft, limitForView, limitForWindow, perDayLeft, viewRange, type BudgetWindow } from "@/lib/budget"
import type { SpendingBudget, SpendingBudgetState, SpendingPeriod, SpendingViewWindow } from "@/lib/types"

/**
 * Small shared formatters for the budgets UI. Every date here is a UTC
 * calendar day (that is how the app stamps transactions and how windows are
 * cut), so it is rendered with `timeZone: "UTC"` — otherwise "2026-09-01"
 * prints as 31 August anywhere west of Greenwich.
 */
export function fmtDay(iso: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { ...opts, timeZone: "UTC" })
}

/** "This month" / "This week" … for the periodic cadences. */
export function periodLabel(t: TFunction, period: SpendingPeriod): string {
  return t(`budgets.section.${period}`)
}

/** The name of a view window as a scale ("a month"), for the toggle and rate hints. */
export function viewLabel(t: TFunction, view: SpendingViewWindow): string {
  return t(`budget.${view}`)
}

/**
 * A budget as the page shows it in the chosen window.
 *
 * The page reports on ONE window, so everything here — spend, limit, bar,
 * colour — is about that window. A budget authored in another rhythm has its
 * limit pro-rated by the days this window really has (a 28-day February allows
 * 28 days of a daily rate, not the mean month's 30.44), and `converted` is true
 * so the row can say what was actually set.
 *
 * A custom-date budget never converts: it is a fixed sum over fixed dates.
 */
export type BudgetInView = {
  window: BudgetWindow
  limit: number
  spent: number
  remaining: number
  ratio: number
  state: SpendingBudgetState
  days_left: number | null
  per_day_left: number | null
  other_spent: number | null
  /** The view is not the rhythm this budget was authored in. */
  converted: boolean
}

export function inView(b: SpendingBudget, view: SpendingViewWindow, today: string): BudgetInView {
  const custom = b.period === "once"
  const window: BudgetWindow = custom
    ? { start: b.window.start, endExclusive: b.window.end_exclusive }
    : viewRange(view, today)
  const limit = custom ? b.amount : limitForWindow(b.amount, b.period, view, window)
  const spent = custom ? b.spent : b.spent_by_view[view]
  const { ratio, remaining, state } = budgetState(spent, limit)
  const days = daysLeft(window, today)
  const phaseOk = custom ? b.window.phase === "active" : true
  const counted = b.status === "active" && limit > 0 && phaseOk
  return {
    window,
    limit,
    spent,
    remaining,
    ratio,
    state: counted ? state : "none",
    days_left: days,
    per_day_left: counted ? perDayLeft(remaining, days) : null,
    other_spent: custom ? b.other_spent : (b.other_spent_by_view?.[view] ?? null),
    converted: !custom && b.period !== view,
  }
}

/**
 * "You set $300 a month" — what the row says under a converted figure.
 *
 * One sentence per rhythm rather than an interpolated period word: in several
 * languages that word is an adjective, and "You set €500 monthly" comes out
 * ungrammatical when it is dropped into a sentence built for English.
 */
export function authoredRate(t: TFunction, b: SpendingBudget, money: (n: number) => string): string {
  if (b.period === "once") return ""
  return t(`budgets.authored.${b.period}`, { amount: money(b.amount) })
}

/** "$9.86 a day · $69 a week · $3,600 a year" — the equivalences the dialog shows under a limit. */
export function rateHints(t: TFunction, amount: number, period: SpendingPeriod, money: (n: number) => string): string {
  if (period === "once" || !(amount > 0)) return ""
  const others = (["daily", "weekly", "monthly", "yearly"] as const).filter((v) => v !== period)
  return others.map((v) => t(`budgets.rate.${v}`, { amount: money(limitForView(amount, period, v)) })).join(" · ")
}

/** The window a `once` budget covers, in words: "All time", "From 1 Sep", "1 Sep – 30 Sep". */
export function customWindowLabel(t: TFunction, b: Pick<SpendingBudget, "start_date" | "end_date">, locale: string): string {
  const withYear: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
  if (b.start_date && b.end_date) {
    const sameYear = b.start_date.slice(0, 4) === b.end_date.slice(0, 4)
    return t("budgets.window.range", { from: fmtDay(b.start_date, locale, sameYear ? undefined : withYear), until: fmtDay(b.end_date, locale, withYear) })
  }
  if (b.start_date) return t("budgets.window.from", { date: fmtDay(b.start_date, locale, withYear) })
  if (b.end_date) return t("budgets.window.until", { date: fmtDay(b.end_date, locale, withYear) })
  return t("budgets.window.allTime")
}

/** What the row says about its window: the cadence, or the custom range. */
export function windowLabel(t: TFunction, b: SpendingBudget, locale: string): string {
  return b.period === "once" ? customWindowLabel(t, b, locale) : periodLabel(t, b.period)
}

/** A budget migrated from v1 has no name; it is "the personal budget". */
export function budgetName(t: TFunction, b: Pick<SpendingBudget, "name">): string {
  return b.name || t("budgets.personal")
}

export const BAR_COLOR: Record<SpendingBudget["state"], string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  over: "bg-red-500",
  none: "bg-muted-foreground/40",
}

export const DELTA_COLOR: Record<SpendingBudget["state"], string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  over: "text-red-600 dark:text-red-400",
  none: "text-muted-foreground",
}

/** Bar fill 0–100, from a ratio. */
export const barPct = (ratio: number | null | undefined): number => Math.max(0, Math.min(1, ratio ?? 0)) * 100

/** Group a flat list into main budgets with their sub-budgets, keeping API order. */
export function nestBudgets(list: SpendingBudget[]): { budget: SpendingBudget; children: SpendingBudget[] }[] {
  const children = new Map<string, SpendingBudget[]>()
  for (const b of list) {
    if (!b.parent_id) continue
    children.set(b.parent_id, [...(children.get(b.parent_id) ?? []), b])
  }
  return list.filter((b) => !b.parent_id).map((b) => ({ budget: b, children: children.get(b.id) ?? [] }))
}

/** The API's error code → the sentence to show. Unknown codes fall back to the generic one. */
export function budgetErrorMessage(t: TFunction, raw: string, detail?: Record<string, unknown>): string {
  const code = raw.trim()
  const list = Array.isArray(detail?.categories) ? (detail!.categories as string[]).join(", ") : ""
  switch (code) {
    case "name_taken":
      return t("budgets.errors.nameTaken")
    case "name_required":
      return t("budgets.errors.nameRequired")
    case "category_claimed":
      return detail?.a ? t("budgets.errors.renameClash", { categories: list, a: detail.a, b: detail.b }) : t("budgets.errors.categoryClaimed", { categories: list, name: detail?.by ?? "" })
    case "categories_outside_parent":
      return t("budgets.errors.categoriesOutsideParent")
    case "sub_budget_needs_categories":
      return t("budgets.errors.subNeedsCategories")
    case "child_outside_scope":
      return t("budgets.errors.childOutsideScope", { child: detail?.child ?? "" })
    case "overall_exists":
      return t("budgets.errors.overallExists", { name: detail?.by || t("budgets.overall") })
    case "too_many_budgets":
    case "too_many_sub_budgets":
      return t("budgets.errors.tooMany")
    case "has_sub_budgets":
      return t("budgets.errors.hasSubBudgets")
    default:
      return code || t("budgets.saveFailed")
  }
}

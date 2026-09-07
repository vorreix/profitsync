import type { TFunction } from "i18next"
import type { SpendingBudget, SpendingPeriod } from "@/lib/types"

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

/** Bar fill 0–100, from the API's ratio. */
export const barPct = (b: Pick<SpendingBudget, "ratio">): number => Math.max(0, Math.min(1, b.ratio ?? 0)) * 100

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
    case "too_many_budgets":
    case "too_many_sub_budgets":
      return t("budgets.errors.tooMany")
    case "has_sub_budgets":
      return t("budgets.errors.hasSubBudgets")
    default:
      return code || t("budgets.saveFailed")
  }
}

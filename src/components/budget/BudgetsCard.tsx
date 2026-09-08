import { useId } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ChevronDown, ChevronRight, Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { useBudgetView } from "@/lib/budget-view"
import { budgetState, todayUtc } from "@/lib/budget"
import { canWriteRole } from "@/lib/roles"
import { formatMoney, usePersistedOpen } from "@/lib/wealth"
import type { SpendingBudgetState, SpendingBudgetsResponse } from "@/lib/types"
import { budgetIcon } from "@/components/budget/budget-icons"
import {
  BAR_COLOR,
  DELTA_COLOR,
  authoredRate,
  barPct,
  budgetName,
  customWindowLabel,
  inView,
  periodLabel,
} from "@/components/budget/budget-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * The dashboard's budgets card (registry id `budget`, personal workspaces).
 *
 * ONE HEADLINE, THEN THE DETAIL. Collapsed, the card answers the only question
 * a dashboard has room for — am I inside my budget? — with the OVERALL budget
 * if one is set, and otherwise with every budget added together. Expanded, it
 * adds the three fullest budgets underneath. With nothing set at all it is a
 * single button.
 *
 * EVERY FIGURE IS IN ONE WINDOW — monthly unless the user has chosen otherwise
 * on /budgets. Showing each budget in its own authored rhythm put a weekly
 * "$40 left" directly above a yearly "$4,000 left" and invited a comparison
 * that means nothing, and it made the total below them unaddable.
 *
 * Because a converted figure is not the number anyone typed, each row says
 * underneath what was actually set ("You set $300 a month"), or, for a
 * fixed-date budget, the dates it covers. A budget's rhythm is the thing its
 * owner thinks in; the card must never overwrite that memory with a pro-rated
 * equivalent and no explanation.
 *
 * Reads the same cached body as the budgets page, so it costs no extra request
 * once either has loaded. Returns null with nothing to show for a viewer, so
 * the dashboard registry hides it.
 */
export function BudgetsCard({ className = "" }: { className?: string }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const { data, loading } = useApiQuery<SpendingBudgetsResponse>("/api/spending-budgets")
  const [view] = useBudgetView(activeOrg?.id)
  const [open, setOpen] = usePersistedOpen(`ps_budget_card_open_${activeOrg?.id ?? ""}`)
  const panelId = useId()
  const money = (n: number) => formatMoney(n, currency)
  const go = () => navigate("/budgets")

  if (loading) {
    return (
      <Card className={`py-0 ${className}`}>
        <CardContent className="space-y-3 p-4">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-1.5 w-full" />
          <Skeleton className="h-1.5 w-full" />
        </CardContent>
      </Card>
    )
  }

  const today = data?.today ?? todayUtc()
  const all = data?.budgets ?? []

  // The overall budget is the figure everything else is measured against, and
  // it lives in the headline rather than the list — exactly as on /budgets.
  const overall = all.find((b) => b.is_overall && b.status === "active") ?? null
  const overallView = overall ? inView(overall, view, today) : null

  const lines = all
    .filter((b) => !b.parent_id && !b.is_overall && b.status === "active" && b.window.phase === "active")
    .map((b) => ({ b, v: inView(b, view, today) }))

  // Without an overall budget, the headline is every budget added together.
  // Fixed-date budgets are left OUT of that sum, for the same reason /budgets
  // leaves them out of its allocation line: a one-off sum over its own dates is
  // not part of "this month", and adding it in would silently inflate both the
  // limit and the spend. Top-level budgets never overlap by scope, so the
  // remaining figures add up without double-counting.
  const summable = lines.filter(({ b }) => b.period !== "once")
  const totals = summable.reduce((acc, { v }) => ({ spent: acc.spent + v.spent, limit: acc.limit + v.limit }), { spent: 0, limit: 0 })

  const summary: { label: string; spent: number; limit: number; remaining: number; ratio: number; state: SpendingBudgetState } | null =
    overallView
      ? { label: t("budgets.overall"), ...overallView }
      : summable.length > 0
        ? { label: t("budgets.yourBudgets"), spent: totals.spent, limit: totals.limit, ...budgetState(totals.spent, totals.limit) }
        : null

  const top = [...lines].sort((x, y) => y.v.ratio - x.v.ratio).slice(0, 3)

  if (!summary && top.length === 0) {
    if (!canWrite) return null
    return (
      <Card
        role="button"
        tabIndex={0}
        onClick={go}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go() } }}
        className={`group cursor-pointer py-0 transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
      >
        <CardContent className="p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 text-muted-foreground" aria-hidden />
            {t("budgets.card.title")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t("budgets.card.empty")}</p>
          <Button variant="outline" size="sm" className="mt-3 h-9 text-xs" onClick={(e) => { e.stopPropagation(); go() }}>
            <Plus className="size-3" /> {t("budgets.card.cta")}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const foldable = top.length > 0

  return (
    <Card className={`py-0 ${className}`}>
      <CardContent className="p-4">
        {/* Two targets, two meanings, never one tap doing both: the title folds
            the list, the chevron on the right opens /budgets. */}
        <div className="flex items-center justify-between gap-1">
          {foldable ? (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpen(!open)}
              className="pressable -my-1.5 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pe-1 text-start text-sm font-medium transition-colors hover:text-foreground"
            >
              <MoneyBag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{t("budgets.card.title")}</span>
              {/* Which window every figure below is in. */}
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {periodLabel(t, view)}
              </span>
              <ChevronDown
                className={`size-4 shrink-0 text-muted-foreground transition-transform duration-300 ease-out motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
                aria-hidden
              />
            </button>
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
              <MoneyBag className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{t("budgets.card.title")}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {periodLabel(t, view)}
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={go}
            className="pressable -my-1.5 flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-1 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {t("budgets.card.viewAll")} <ChevronRight className="size-4 rtl:rotate-180" aria-hidden />
          </button>
        </div>

        {/* The headline — the overall budget, or everything added up. */}
        {summary && (
          <div className="mt-3" data-testid="budget-card-summary">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs font-medium text-muted-foreground">{summary.label}</span>
              <span className={`shrink-0 text-xs font-medium tabular-nums ${DELTA_COLOR[summary.state]}`}>
                {summary.remaining >= 0
                  ? t("budgets.left", { amount: money(summary.remaining) })
                  : t("budgets.over", { amount: money(-summary.remaining) })}
              </span>
            </div>
            <p className="mt-0.5 text-lg font-semibold tabular-nums">
              {money(summary.spent)}{" "}
              <span className="text-sm font-normal text-muted-foreground">/ {money(summary.limit)}</span>
            </p>
            <div
              className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(barPct(summary.ratio))}
              aria-label={summary.label}
            >
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${BAR_COLOR[summary.state]}`}
                style={{ width: `${barPct(summary.ratio)}%` }}
              />
            </div>
          </div>
        )}

        {/* The 0fr→1fr grid keeps the fold on the compositor instead of
            animating height, and the list's top padding sits INSIDE the
            overflow-hidden so a closed card ends flush with the headline. */}
        {foldable && (
          <div
            id={panelId}
            className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
            style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
          >
            <div className="overflow-hidden">
              <ul className={`space-y-2 pt-3 ${summary ? "mt-3 border-t" : ""}`}>
                {top.map(({ b, v }) => {
                  const Icon = budgetIcon(b.icon)
                  const name = budgetName(t, b)
                  // What was actually set — never let a converted figure be the
                  // only number a budget's owner sees.
                  const authored = b.period === "once" ? customWindowLabel(t, b, i18n.language) : authoredRate(t, b, money)
                  return (
                    <li key={b.id} data-budget={b.id} data-budget-state={v.state}>
                      <button
                        type="button"
                        onClick={() => navigate(`/budgets/${b.id}`)}
                        className="pressable min-h-11 w-full rounded-lg px-1.5 py-1.5 text-start transition-colors hover:bg-accent/60"
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate font-medium">{name}</span>
                          </span>
                          <span className={`shrink-0 font-medium tabular-nums ${DELTA_COLOR[v.state]}`}>
                            {v.remaining >= 0
                              ? t("budgets.left", { amount: money(v.remaining) })
                              : t("budgets.over", { amount: money(-v.remaining) })}
                          </span>
                        </div>
                        <div
                          className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                          role="progressbar"
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={Math.round(barPct(v.ratio))}
                          aria-label={name}
                        >
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${BAR_COLOR[v.state]}`}
                            style={{ width: `${barPct(v.ratio)}%` }}
                          />
                        </div>
                        {authored && <p className="mt-1 truncate text-[11px] text-muted-foreground/80">{authored}</p>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

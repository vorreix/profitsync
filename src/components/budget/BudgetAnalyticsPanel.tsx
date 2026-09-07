import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { Info, TrendingDown, TrendingUp } from "lucide-react"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { budgetState } from "@/lib/budget"
import type { SpendingBudget, SpendingBudgetAnalytics, SpendingViewWindow } from "@/lib/types"
import { budgetName, fmtDay } from "@/components/budget/budget-format"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

const BAR = { ok: "#10b981", warn: "#f59e0b", over: "#ef4444", none: "#94a3b8" } as const
const BACK_CHOICES = [6, 12, 24]

/**
 * Budget analytics — the questions the list cannot answer, and nothing it can.
 *
 * 1. Is the habit improving? A window-by-window trend against the limit that
 *    applied THEN, so lowering a limit today does not repaint last month.
 * 2. What is nothing watching? Spend that no budget claims, ranked, with a
 *    one-tap way to put a budget on it.
 * 3. Am I keeping to it? On-budget rate, streak and average over/under —
 *    counted only over finished windows whose figures can be trusted.
 * 4. Which budget is the problem? Every budget's spend against its limit in the
 *    window, worst first.
 */
export function BudgetAnalyticsPanel({
  view,
  budgets,
  onBudgetCategory,
}: {
  view: SpendingViewWindow
  budgets: SpendingBudget[]
  onBudgetCategory?: (category: string) => void
}) {
  const { t, i18n } = useTranslation()
  const { currency } = useCurrency()
  const money = (n: number) => formatMoney(n, currency)
  const [back, setBack] = useState(6)
  const [focus, setFocus] = useState<string>("overall")

  const { data, loading } = useApiQuery<SpendingBudgetAnalytics>(`/api/spending-budgets/analytics?view=${view}&back=${back}`)
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

  const overall = budgets.find((b) => b.is_overall && b.status === "active") ?? null
  const lines = budgets.filter((b) => !b.parent_id && !b.is_overall && b.status === "active" && b.period !== "once")
  const focusable = [...(overall ? [{ id: "overall", name: t("budgets.overall") }] : []), ...lines.map((b) => ({ id: b.id, name: budgetName(t, b) }))]

  const series = useMemo(() => {
    if (!data) return []
    return data.windows.map((w) => {
      const spent = focus === "overall" ? w.total : (w.per_budget[focus] ?? 0)
      const limit = focus === "overall" ? (w.overall_limit ?? (w.budgeted_limit > 0 ? w.budgeted_limit : null)) : (w.per_budget_limit[focus] ?? null)
      return {
        start: w.start,
        label: fmtDay(w.start, i18n.language, view === "yearly" ? { year: "numeric" } : view === "monthly" ? { month: "short" } : { day: "numeric", month: "short" }),
        spent,
        limit,
        partial: w.partial,
        reliable: w.reliable,
        state: (limit && limit > 0 ? budgetState(spent, limit).state : "none") as keyof typeof BAR,
      }
    })
  }, [data, focus, i18n.language, view])

  const chartConfig: ChartConfig = {
    spent: { label: t("budgetsPage.spent") },
    limit: { label: t("budgets.detail.limit") },
  }

  if (loading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  const current = data.windows[data.windows.length - 1]
  const unclaimed = data.categories.filter((c) => c.budget_id === null && c.spent > 0)
  const a = data.adherence

  return (
    <div className="space-y-4" data-testid="budget-analytics">
      {/* 1 — the trend */}
      <Card className="py-0">
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">{t("budgets.analytics.trend")}</h2>
            <div className="flex flex-wrap items-center gap-2">
              {focusable.length > 1 && (
                <NativeSelect value={focus} onChange={(e) => setFocus(e.target.value)} className="h-11 w-auto text-xs sm:h-9" aria-label={t("budgets.analytics.focus")}>
                  {focusable.map((f) => (
                    <NativeSelectOption key={f.id} value={f.id}>
                      {f.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              )}
              <NativeSelect value={String(back)} onChange={(e) => setBack(Number(e.target.value))} className="h-11 w-auto text-xs sm:h-9" aria-label={t("budgets.analytics.periods")}>
                {BACK_CHOICES.map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    {t("budgets.analytics.lastN", { count: n })}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>
          {series.length > 1 ? (
            <>
              <ChartContainer config={chartConfig} className="h-52 w-full">
                <ComposedChart data={series} margin={{ left: 4, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="spent" radius={4} isAnimationActive={!reduced}>
                    {series.map((p) => (
                      <Cell key={p.start} fill={BAR[p.state]} fillOpacity={p.partial ? 0.45 : p.reliable ? 1 : 0.6} />
                    ))}
                  </Bar>
                  <Line dataKey="limit" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="4 4" dot={false} connectNulls={false} isAnimationActive={!reduced} />
                </ComposedChart>
              </ChartContainer>
              <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
                {t("budgets.analytics.trendNote")}
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-muted-foreground">{t("budgets.analytics.notEnough")}</p>
          )}
        </CardContent>
      </Card>

      {/* 2 — what nothing is watching */}
      <Card className="py-0">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">{t("budgets.analytics.unclaimed")}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("budgets.analytics.unclaimedTotal", { amount: money(current?.unclaimed ?? 0) })}
          </p>
          {unclaimed.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">{t("budgets.analytics.allClaimed")}</p>
          ) : (
            <ul className="mt-3 space-y-2" data-testid="unclaimed-list">
              {unclaimed.slice(0, 8).map((c) => {
                const pct = current && current.total > 0 ? Math.min(100, (c.spent / current.total) * 100) : 0
                return (
                  <li key={c.name || "__none"}>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-medium">{c.name || t("budgets.analytics.uncategorised")}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="tabular-nums">{money(c.spent)}</span>
                        {onBudgetCategory && c.name && (
                          <button
                            type="button"
                            onClick={() => onBudgetCategory(c.name)}
                            className="pressable rounded-md px-1.5 py-0.5 text-[11px] font-medium text-primary underline-offset-2 hover:underline"
                          >
                            {t("budgets.analytics.budgetThis")}
                          </button>
                        )}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-muted-foreground/50" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3 — are you keeping to it */}
      <Card className="py-0">
        <CardContent className="p-4">
          <h2 className="text-sm font-semibold">{t("budgets.analytics.adherence")}</h2>
          {a.periods === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("budgets.analytics.noJudgeable")}</p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Tile label={t("budgets.analytics.onBudget")} value={`${Math.round(a.rate * 100)}%`} />
                <Tile label={t("budgets.analytics.streak")} value={String(a.streak)} />
                <Tile
                  label={t("budgets.analytics.avgDelta")}
                  value={`${a.avg_delta > 0 ? "+" : ""}${money(a.avg_delta)}`}
                  tone={a.avg_delta > 0 ? "bad" : "good"}
                  icon={a.avg_delta > 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
                />
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">{t("budgets.analytics.judgedOver", { count: a.periods })}</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 4 — which budget is the problem */}
      {lines.length > 0 && current && (
        <Card className="py-0">
          <CardContent className="p-4">
            <h2 className="text-sm font-semibold">{t("budgets.analytics.byBudget")}</h2>
            <ul className="mt-3 space-y-2.5">
              {lines
                .map((b) => {
                  const spent = current.per_budget[b.id] ?? 0
                  const limit = current.per_budget_limit[b.id] ?? 0
                  return { b, spent, limit, ratio: limit > 0 ? spent / limit : 0 }
                })
                .sort((x, y) => y.ratio - x.ratio)
                .map(({ b, spent, limit }) => {
                  const st = limit > 0 ? budgetState(spent, limit).state : "none"
                  const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0
                  return (
                    <li key={b.id}>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-medium">{budgetName(t, b)}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {t("budgets.spentOf", { spent: money(spent), amount: money(limit) })}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: BAR[st] }} />
                      </div>
                    </li>
                  )
                })}
            </ul>
            <p className="mt-3 text-[11px] text-muted-foreground">{t("budgets.analytics.byBudgetNote")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Tile({ label, value, tone = "neutral", icon }: { label: string; value: string; tone?: "good" | "bad" | "neutral"; icon?: React.ReactNode }) {
  const cls = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : ""
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums ${cls}`}>
        {icon}
        {value}
      </p>
    </div>
  )
}

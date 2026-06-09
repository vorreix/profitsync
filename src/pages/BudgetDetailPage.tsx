import { useCallback, useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Pencil, Plus, TrendingUp, History as HistoryIcon } from "lucide-react"
import { ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid } from "recharts"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import type { BudgetPeriod } from "@/lib/budget"
import type { Budget } from "@/lib/types"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { BudgetDialog } from "@/components/budget/BudgetDialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

type Action = "set" | "raise" | "lower" | "period_change" | "remove"
type TimelineRow = { amount: number; period: BudgetPeriod; action: Action; created_at: string }
type SeriesPoint = { start: string; spent: number; budget: number; state: "ok" | "warn" | "over" | "none" }
type Detail = {
  key: string
  client_id: string | null
  client_name: string | null
  is_default: boolean
  current: { amount: number; period: BudgetPeriod } | null
  timeline: TimelineRow[]
  has_series: boolean
  series: SeriesPoint[]
  adherence: { rate: number; streak: number; avgDelta: number; periods: number }
  evolution: { first: number; current: number; pct: number } | null
  creep: { flagged: boolean; raiseCount: number; pct: number }
}

// Semantic spend colours (read well in both themes); the dashed line is the budget.
const BAR = { ok: "#10b981", warn: "#f59e0b", over: "#ef4444", none: "#94a3b8" } as const
const BUDGET_LINE = "var(--chart-1)"
const ACTION_KEY: Record<Action, string> = {
  set: "budgetsPage.actionSet", raise: "budgetsPage.actionRaise", lower: "budgetsPage.actionLower",
  period_change: "budgetsPage.actionPeriod", remove: "budgetsPage.actionRemove",
}

export function BudgetDetailPage() {
  const { key = "default" } = useParams<{ key: string }>()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const canWrite = canWriteRole(activeOrg?.role)

  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  // Respect reduced-motion: recharts doesn't honour it, so gate its animations.
  const animate = !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      setD(await apiGet<Detail>(`/api/budgets/detail?client_id=${encodeURIComponent(key)}`, token))
    } catch {
      setD(null)
    } finally {
      setLoading(false)
    }
  }, [getToken, key])

  useEffect(() => { void load() }, [load])

  const title = d?.client_name ?? (isPersonal ? t("budgetsPage.personal") : t("budgetsPage.companyDefault"))
  const fmtPeriodLabel = (start: string, period: BudgetPeriod) =>
    new Date(start + "T00:00:00Z").toLocaleDateString(i18n.language, period === "monthly" ? { month: "short" } : { day: "numeric", month: "short" })
  const fmtDate = (s: string) => new Date(s).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })

  const chartData = (d?.series ?? []).map((p) => ({ ...p, label: fmtPeriodLabel(p.start, d?.current?.period ?? "monthly") }))
  const chartConfig: ChartConfig = {
    spent: { label: t("budgetsPage.spent") },
    budget: { label: t("budget.title", { defaultValue: "Budget" }) },
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6 page-enter">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate("/budgets")} className="-ml-2 mt-0.5 shrink-0" aria-label={t("common.back", { defaultValue: "Back" })}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight truncate">{title}</h1>
          <p className="text-sm text-muted-foreground">{t("budgetsPage.title")}</p>
        </div>
        {canWrite && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditOpen(true)}>
            {d?.current ? <><Pencil className="size-3.5" /> {t("budget.edit")}</> : <><Plus className="size-3.5" /> {t("budget.set")}</>}
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-20 w-full rounded-xl" /><Skeleton className="h-48 w-full rounded-xl" /></div>
      ) : !d ? (
        <p className="text-sm text-muted-foreground py-12 text-center">{t("budgetsPage.notFound")}</p>
      ) : (
        <>
          {/* Current budget */}
          <div className="rounded-xl border p-4">
            {d.current ? (
              <BudgetIndicator amount={d.current.amount} spent={d.series.length ? d.series[d.series.length - 1].spent : 0} period={d.current.period} currency={currency} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("budget.noBudget")}</p>
            )}
          </div>

          {/* Creep callout */}
          {d.creep.flagged && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <TrendingUp className="size-4 shrink-0 mt-0.5" />
              <p>{t("budgetsPage.creepWarning", { count: d.creep.raiseCount, pct: Math.round(d.creep.pct) })}</p>
            </div>
          )}

          {/* Spend vs budget chart + adherence */}
          {d.has_series && chartData.length > 0 ? (
            <div className="rounded-xl border p-4 space-y-4">
              <p className="text-sm font-medium">{t("budgetsPage.spendVsBudget")}</p>
              <ChartContainer config={chartConfig} className="h-44 w-full">
                <ComposedChart data={chartData} margin={{ left: 4, right: 4, top: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
                  <YAxis hide />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="spent" radius={4} isAnimationActive={animate}>
                    {chartData.map((p) => <Cell key={p.start} fill={BAR[p.state]} />)}
                  </Bar>
                  <Line dataKey="budget" stroke={BUDGET_LINE} strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={animate} />
                </ComposedChart>
              </ChartContainer>

              {d.adherence.periods > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <Stat label={t("budgetsPage.onBudget")} value={`${Math.round(d.adherence.rate * 100)}%`} />
                  <Stat label={t("budgetsPage.streak")} value={String(d.adherence.streak)} />
                  <Stat
                    label={t("budgetsPage.avgVsBudget")}
                    value={`${d.adherence.avgDelta > 0 ? "+" : ""}${formatMoney(d.adherence.avgDelta, currency)}`}
                    tone={d.adherence.avgDelta > 0 ? "bad" : "good"}
                  />
                  {d.evolution && (
                    <Stat
                      label={t("budgetsPage.sinceFirstSet")}
                      value={`${d.evolution.pct > 0 ? "+" : ""}${Math.round(d.evolution.pct)}%`}
                      tone={d.evolution.pct > 0 ? "bad" : d.evolution.pct < 0 ? "good" : "neutral"}
                    />
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground rounded-xl border border-dashed p-4 text-center">{t("budgetsPage.templateNoChart")}</p>
          )}

          {/* Change timeline */}
          <div className="rounded-xl border p-4 space-y-3">
            <p className="text-sm font-medium flex items-center gap-1.5"><HistoryIcon className="size-4 text-muted-foreground" /> {t("budgetsPage.changeHistory")}</p>
            {d.timeline.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t("budgetsPage.noHistory")}</p>
            ) : (
              <ol className="space-y-2.5">
                {[...d.timeline].reverse().map((row, i, arr) => {
                  const prev = arr[i + 1] // older row (the list is newest-first here)
                  return (
                    <li key={row.created_at + i} className="flex items-start gap-2.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                      <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${row.action === "remove" ? "bg-red-500" : row.action === "raise" ? "bg-amber-500" : "bg-emerald-500"}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          <span className="font-medium">{t(ACTION_KEY[row.action])}</span>{" "}
                          {row.action !== "remove" && (
                            <span className="tabular-nums">
                              {formatMoney(row.amount, currency)} · {t(`budget.${row.period}`)}
                            </span>
                          )}
                          {prev && row.action !== "remove" && prev.action !== "remove" && row.amount !== prev.amount && (
                            <Badge variant="outline" className="ml-1.5 text-[10px] py-0">
                              {row.amount > prev.amount ? "+" : "−"}{formatMoney(Math.abs(row.amount - prev.amount), currency)}
                            </Badge>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">{fmtDate(row.created_at)}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        </>
      )}

      <BudgetDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        clientId={d?.client_id ?? null}
        label={title}
        current={d?.current ? ({ amount: d.current.amount, period: d.current.period } as Budget) : null}
        onSaved={() => { void load() }}
      />
    </div>
  )
}

function Stat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "good" | "bad" | "neutral" }) {
  const cls = tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-red-600 dark:text-red-400" : ""
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  )
}

export default BudgetDetailPage

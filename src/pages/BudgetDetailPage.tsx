import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowLeft, History as HistoryIcon, MoreHorizontal, Pencil, Play, Plus, Square, Trash2 } from "lucide-react"
import { Bar, CartesianGrid, Cell, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { apiDelete, apiErrorMessage, apiPatch, peekApiCache } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import { budgetState } from "@/lib/budget"
import type { SpendingBudget, SpendingBudgetDetail, SpendingBudgetsResponse } from "@/lib/types"
import { budgetIcon } from "@/components/budget/budget-icons"
import { BAR_COLOR, DELTA_COLOR, barPct, budgetName, fmtDay, windowLabel } from "@/components/budget/budget-format"
import { BudgetRow, type BudgetRowActions } from "@/components/budget/BudgetRow"
import { SpendingBudgetDialog, type SpendingBudgetDialogMode } from "@/components/budget/SpendingBudgetDialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

const CHART_BAR = { ok: "#10b981", warn: "#f59e0b", over: "#ef4444", none: "#94a3b8" } as const

/**
 * /budgets/:id — one budget in full: the figure, its sub-budgets, how past
 * windows went against the limit that applied then, the latest rows that
 * landed in it, and every change made to it.
 *
 * The hero paints from the list's cached body the instant the page opens
 * (the user was just looking at that number), while the chart, recent rows and
 * history arrive behind it — so navigating in never shows a skeleton over a
 * figure the screen already had.
 */
export function BudgetDetailPage() {
  const { id = "" } = useParams<{ id: string }>()
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { getToken, userId } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const money = (n: number) => formatMoney(n, currency)
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

  const list = useApiQuery<SpendingBudgetsResponse>("/api/spending-budgets")
  const detail = useApiQuery<SpendingBudgetDetail>(id ? `/api/spending-budgets/${id}` : null)
  const [dialog, setDialog] = useState<SpendingBudgetDialogMode | null>(null)
  const [removing, setRemoving] = useState<SpendingBudget | null>(null)

  // Legacy URLs: the v1 personal page lived at /budgets/default, and a business
  // workspace's client caps at /budgets/<clientId>. Neither is a spending
  // budget, so once the list has loaded and the id is not in it, send them on.
  const seeded = peekApiCache<SpendingBudgetsResponse>("/api/spending-budgets", userId)
  const known = (list.data ?? seeded)?.budgets
  useEffect(() => {
    if (id === "default") { navigate("/budgets", { replace: true }); return }
    if (!known || !detail.error) return
    if (known.some((b) => b.id === id)) return
    if (!isPersonal) navigate(`/budgets/clients/${id}`, { replace: true })
  }, [id, known, detail.error, isPersonal, navigate])

  const budget: SpendingBudget | undefined = detail.data?.budget ?? known?.find((b) => b.id === id)
  const children: SpendingBudget[] = useMemo(
    () => detail.data?.children ?? (known ?? []).filter((b) => b.parent_id === id),
    [detail.data, known, id],
  )
  const all = list.data?.budgets ?? seeded?.budgets ?? (budget ? [budget, ...children] : [])

  const refetch = () => { detail.refetch(); list.refetch() }
  const withToken = async (fn: (token: string) => Promise<void>) => {
    try {
      const token = await getToken()
      if (!token) return
      await fn(token)
      refetch()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("budgets.saveFailed")))
    }
  }

  const actions: BudgetRowActions = {
    onEdit: (b) => setDialog({ kind: "edit", budget: b }),
    onAddSub: (parent) => setDialog({ kind: "createSub", parent }),
    onToggleStatus: (b) => void withToken(async (token) => { await apiPatch(`/api/spending-budgets/${b.id}`, token, { status: b.status === "closed" ? "active" : "closed" }) }),
    onMove: () => {},
    onRemove: (b) => setRemoving(b),
  }
  const confirmRemove = () => {
    const b = removing
    if (!b) return
    setRemoving(null)
    void withToken(async (token) => {
      await apiDelete(`/api/spending-budgets/${b.id}`, token)
      toast.success(t("budgets.removed"))
      if (b.id === id) navigate(b.parent_id ? `/budgets/${b.parent_id}` : "/budgets", { replace: true })
    })
  }

  if (!budget) {
    return (
      <div className="space-y-4 p-3 sm:p-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => navigate("/budgets")} className="-ms-2 size-11 sm:size-9" aria-label={t("common.back", { defaultValue: "Back" })}>
            <ArrowLeft className="size-4 rtl:rotate-180" />
          </Button>
          <Skeleton className="h-6 w-40" />
        </div>
        {detail.error && known && !known.some((b) => b.id === id) ? (
          <p className="py-12 text-center text-sm text-muted-foreground">{t("budgets.detail.notFound")}</p>
        ) : (
          <>
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </>
        )}
      </div>
    )
  }

  const name = budgetName(t, budget)
  const Icon = budgetIcon(budget.icon)
  const closed = budget.status === "closed"
  const phase = budget.window.phase
  const parentName = detail.data?.parent?.name ?? (budget.parent_id ? budgetName(t, all.find((b) => b.id === budget.parent_id) ?? { name: "" }) : null)
  const delta = budget.remaining >= 0 ? t("budgets.left", { amount: money(budget.remaining) }) : t("budgets.over", { amount: money(-budget.remaining) })
  const showRest = children.some((c) => c.status === "active") && budget.other_spent !== null && budget.other_spent > 0.004

  const series = (detail.data?.series ?? []).map((p) => ({
    ...p,
    label: fmtDay(p.start, i18n.language, budget.period === "yearly" ? { year: "numeric" } : budget.period === "monthly" ? { month: "short" } : { day: "numeric", month: "short" }),
    state: (p.amount > 0 ? budgetState(p.spent, p.amount).state : "none") as SpendingBudget["state"],
  }))
  const chartConfig: ChartConfig = { spent: { label: t("budgetsPage.spent") }, amount: { label: t("budgets.detail.limit") } }

  const seeAll = (() => {
    if (budget.categories.length > 1) return null
    const q = new URLSearchParams()
    if (budget.categories[0]) q.set("category", budget.categories[0])
    if (budget.window.start) q.set("from", budget.window.start)
    if (budget.window.end_exclusive) q.set("to", budget.window.end_exclusive)
    const qs = q.toString()
    return `/transactions${qs ? `?${qs}` : ""}`
  })()

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6 page-enter">
      {/* Header */}
      <div className="flex items-start gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(budget.parent_id ? `/budgets/${budget.parent_id}` : "/budgets")} className="-ms-2 mt-0.5 size-11 shrink-0 sm:size-9" aria-label={t("common.back", { defaultValue: "Back" })}>
          <ArrowLeft className="size-4 rtl:rotate-180" />
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 truncate text-xl font-semibold tracking-tight sm:text-2xl">
            <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{name}</span>
            {closed && <Badge variant="outline" className="shrink-0">{t("budgets.closed")}</Badge>}
          </h1>
          <p className="text-sm text-muted-foreground">
            {parentName ? t("budgets.dialog.subOf", { parent: parentName }) : windowLabel(t, budget, i18n.language)}
            {budget.categories.length > 0 ? ` · ${budget.categories.join(", ")}` : parentName ? "" : ` · ${t("budgets.allSpending")}`}
          </p>
        </div>
        {canWrite && (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setDialog({ kind: "edit", budget })}>
              <Pencil className="size-3.5" /> {t("budgets.menu.edit")}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 sm:size-9" aria-label={t("common.moreActions", { defaultValue: "More actions" })}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                {!budget.parent_id && (
                  <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => setDialog({ kind: "createSub", parent: budget })}>
                    <Plus className="size-4" /> {t("budgets.menu.addSub")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="min-h-11 sm:min-h-9" onSelect={() => actions.onToggleStatus(budget)}>
                  {closed ? <Play className="size-4" /> : <Square className="size-4" />} {closed ? t("budgets.menu.reopen") : t("budgets.menu.close")}
                </DropdownMenuItem>
                {canDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="min-h-11 text-destructive focus:text-destructive sm:min-h-9" onSelect={() => setRemoving(budget)}>
                      <Trash2 className="size-4" /> {t("budgets.menu.remove")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {closed && <Banner>{t("budgets.detail.closedBanner")}</Banner>}
      {!closed && phase === "ended" && budget.window.end_exclusive && (
        <Banner>{t("budgets.detail.endedBanner", { date: fmtDay(budget.window.end_exclusive, i18n.language, { day: "numeric", month: "short", year: "numeric" }) })}</Banner>
      )}
      {!closed && phase === "upcoming" && budget.window.start && (
        <Banner>{t("budgets.detail.upcomingBanner", { date: fmtDay(budget.window.start, i18n.language, { day: "numeric", month: "short", year: "numeric" }) })}</Banner>
      )}

      {/* Hero */}
      <Card className="py-0" data-testid="budget-hero">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-2xl font-bold tabular-nums">
              {money(budget.spent)} <span className="text-base font-normal text-muted-foreground">/ {money(budget.amount)}</span>
            </p>
            <p className={`text-sm font-medium tabular-nums ${DELTA_COLOR[budget.state]}`}>{delta}</p>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(barPct(budget.ratio))} aria-label={name}>
            <div className={`h-full rounded-full transition-[width] duration-500 ${BAR_COLOR[budget.state]}`} style={{ width: `${barPct(budget.ratio)}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {budget.window.days_left !== null && phase === "active" && t("budgets.daysLeft", { count: budget.window.days_left })}
            {budget.per_day_left !== null && <> · {t("budgets.perDay", { amount: money(budget.per_day_left) })}</>}
            {budget.window.days_left === null && phase === "active" && budget.period === "once" && windowLabel(t, budget, i18n.language)}
          </p>
        </CardContent>
      </Card>

      {/* Sub-budgets */}
      {!budget.parent_id && (
        <Card className="py-0">
          <CardContent className="p-2 sm:p-4">
            <div className="flex items-center justify-between gap-2 px-2 pb-1 sm:px-1">
              <h2 className="text-sm font-semibold">{t("budgets.detail.subBudgets")}</h2>
              {canWrite && (
                <Button variant="ghost" size="sm" className="h-11 text-xs sm:h-8" onClick={() => setDialog({ kind: "createSub", parent: budget })} data-testid="budget-add-sub">
                  <Plus className="size-3.5" /> {t("budgets.addSub")}
                </Button>
              )}
            </div>
            {children.length === 0 ? (
              <p className="px-2 pb-2 text-xs text-muted-foreground sm:px-1">{t("budgets.detail.noSubBudgets")}</p>
            ) : (
              <ul className="space-y-1" data-testid="sub-budgets">
                {children.map((c, i) => (
                  <BudgetRow key={c.id} budget={c} view={c.period === "once" ? "monthly" : c.period} today={detail.data?.today ?? ""} depth={1} isFirst={i === 0} isLast={i === children.length - 1} canWrite={canWrite} canDelete={canDelete} actions={actions} />
                ))}
              </ul>
            )}
            {showRest && (
              <p className="px-2 pt-2 text-[11px] text-muted-foreground sm:px-1">{t("budgets.notInSubBudgets", { amount: money(budget.other_spent!) })}</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Spend vs limit */}
      {series.length > 1 && (
        <Card className="py-0">
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-semibold">{t("budgets.detail.chart")}</p>
            <ChartContainer config={chartConfig} className="h-44 w-full">
              <ComposedChart data={series} margin={{ left: 4, right: 4, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={6} fontSize={11} />
                <YAxis hide />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="spent" radius={4} isAnimationActive={!reduced}>
                  {series.map((p) => <Cell key={p.start} fill={CHART_BAR[p.state]} />)}
                </Bar>
                <Line dataKey="amount" stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="4 4" dot={false} isAnimationActive={!reduced} />
              </ComposedChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent */}
      <Card className="py-0">
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold">{t("budgets.detail.recent")}</p>
            {seeAll && detail.data && detail.data.recent.length > 0 && (
              <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => navigate(seeAll)}>{t("budgets.detail.seeAll")}</Button>
            )}
          </div>
          {!detail.data ? (
            <div className="mt-3 space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>
          ) : detail.data.recent.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("budgets.detail.noRecent")}</p>
          ) : (
            <ul className="mt-2 divide-y">
              {detail.data.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{r.description || r.category || "—"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {fmtDay(r.date, i18n.language)}{r.category ? ` · ${r.category}` : ""}{r.client_name ? ` · ${r.client_name}` : ""}
                      {r.kind === "refund" && ` · ${t("budgets.detail.refund")}`}
                    </p>
                  </div>
                  <span className={`shrink-0 tabular-nums ${r.amount < 0 ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
                    {r.amount < 0 ? "+" : ""}{money(Math.abs(r.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Changes */}
      <Card className="py-0">
        <CardContent className="p-4">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><HistoryIcon className="size-4 text-muted-foreground" aria-hidden /> {t("budgets.detail.changes")}</p>
          {!detail.data ? (
            <Skeleton className="mt-3 h-4 w-1/2" />
          ) : detail.data.history.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("budgets.detail.noChanges")}</p>
          ) : (
            <ol className="mt-2 space-y-2.5">
              {detail.data.history.map((h) => (
                <li key={h.id} className="flex items-start gap-2.5">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${h.action === "delete" ? "bg-red-500" : h.action === "create" ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{t(`budgets.history.${h.action}`, { defaultValue: h.action })}</span>
                      {Object.entries(h.changes).filter(([k]) => k !== "icon").map(([k, v]) => (
                        <span key={k} className="ms-1.5 text-muted-foreground">
                          {t(`budgets.history.field.${k}`, { defaultValue: k })}: {formatChange(v.from, k)} → {formatChange(v.to, k)}
                        </span>
                      ))}
                    </p>
                    {h.created_at && <p className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleDateString(i18n.language, { day: "numeric", month: "short", year: "numeric" })}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      {/* Mounted closed and opened (see BudgetsPage for why). */}
      <SpendingBudgetDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null) }} mode={dialog ?? { kind: "create" }} all={all} onSaved={refetch} />

      <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("budgets.removeTitle", { name: removing ? budgetName(t, removing) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>{removing && removing.children_count > 0 ? t("budgets.removeBodyWithSubs") : t("budgets.removeBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-white hover:bg-destructive/90 sm:h-9" onClick={confirmRemove}>{t("budgets.menu.remove")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

  function formatChange(v: unknown, field: string): string {
    if (v === null || v === undefined || v === "") return t("budgets.history.none")
    if (Array.isArray(v)) return v.length ? v.join(", ") : t("budgets.allSpending")
    if (field === "amount" && typeof v === "number") return money(v)
    if (field === "period" && typeof v === "string") return t(`budget.${v}`, { defaultValue: v })
    if (field === "status" && typeof v === "string") return v === "closed" ? t("budgets.closed") : t("budgets.menu.reopen")
    if ((field === "start_date" || field === "end_date") && typeof v === "string") return fmtDay(v, i18n.language, { day: "numeric", month: "short", year: "numeric" })
    if (field === "parent_id" && typeof v === "string") return budgetName(t, all.find((b) => b.id === v) ?? { name: "" })
    return String(v)
  }
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{children}</div>
}

export default BudgetDetailPage

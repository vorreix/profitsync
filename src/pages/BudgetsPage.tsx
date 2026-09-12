import { lazy, Suspense, useCallback, useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowUpDown, Check, Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { apiDelete, apiErrorMessage, apiPatch, apiPost } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import { FxExcludedNotice } from "@/components/FxExcludedNotice"
import { allocation, todayUtc, VIEW_WINDOWS } from "@/lib/budget"
import { useBudgetView } from "@/lib/budget-view"
import type { Category, SpendingBudget, SpendingBudgetsResponse } from "@/lib/types"
import { BudgetList } from "@/components/budget/BudgetList"
import { SpendingBudgetDialog, type SpendingBudgetDialogMode } from "@/components/budget/SpendingBudgetDialog"
import { ClientBudgetsSection } from "@/components/budget/ClientBudgetsSection"
import { BAR_COLOR, DELTA_COLOR, barPct, budgetName, inView, budgetsExcluded } from "@/components/budget/budget-format"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
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

const BudgetAnalyticsPanel = lazy(() =>
  import("@/components/budget/BudgetAnalyticsPanel").then((m) => ({ default: m.BudgetAnalyticsPanel })),
)

/**
 * /budgets — where am I with each budget?
 *
 * The page reports on ONE window at a time (Day / Week / Month / Year). Every
 * budget is authored in the rhythm its owner thinks in — rent monthly, coffee
 * weekly — and converted into the chosen window, which is the only way budgets
 * of different rhythms can be compared, added up, and measured against one
 * overall limit. The toggle costs no request: every row already carries its
 * spend for all four windows.
 *
 * A business workspace keeps its per-client spend caps in a section below.
 */
export function BudgetsPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const { data, loading, refetch } = useApiQuery<SpendingBudgetsResponse>("/api/spending-budgets")
  // Spend is measured in the currency the server reported (the workspace's
  // reporting currency; the org's is only the fallback before the first payload
  // lands), with every ledger row converted at its own date.
  const budgetsCurrency = data?.currency || currency
  const money = (n: number) => formatMoney(n, budgetsCurrency)
  const cats = useApiQuery<Category[]>("/api/categories?type=outgoing")
  const budgets = useMemo(() => data?.budgets ?? [], [data])
  const today = data?.today ?? todayUtc()

  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get("tab") === "analytics" ? "analytics" : "budgets"
  const setTab = (next: "budgets" | "analytics") => {
    const p = new URLSearchParams(searchParams)
    if (next === "budgets") p.delete("tab")
    else p.set("tab", next)
    setSearchParams(p, { replace: true })
  }

  // The window the page is read in, remembered per workspace — the same
  // preference the dashboard card reads, so the two never disagree.
  const [view, setView] = useBudgetView(activeOrg?.id)

  const [dialog, setDialog] = useState<SpendingBudgetDialogMode | null>(null)
  const [removing, setRemoving] = useState<SpendingBudget | null>(null)
  const [reordering, setReordering] = useState(false)
  const [busy, setBusy] = useState(false)

  const withToken = useCallback(
    async (fn: (token: string) => Promise<void>) => {
      if (busy) return
      setBusy(true)
      try {
        const token = await getToken()
        if (!token) return
        await fn(token)
        refetch()
      } catch (err) {
        toast.error(apiErrorMessage(err, t("budgets.saveFailed")))
      } finally {
        setBusy(false)
      }
    },
    [busy, getToken, refetch, t],
  )

  const overall = budgets.find((b) => b.is_overall && b.status === "active") ?? null
  const lines = budgets.filter((b) => !b.parent_id && !b.is_overall && b.status === "active" && b.period !== "once")
  const overallView = overall ? inView(overall, view, today) : null
  const alloc = allocation(
    overallView ? overallView.limit : null,
    lines.map((b) => inView(b, view, today).limit),
  )

  const actions = {
    onEdit: (b: SpendingBudget) => setDialog({ kind: "edit", budget: b }),
    onAddSub: (parent: SpendingBudget) => setDialog({ kind: "createSub", parent }),
    onWidenScope: (parent: SpendingBudget) => setDialog({ kind: "edit", budget: parent, openScope: true }),
    onToggleStatus: (b: SpendingBudget) =>
      void withToken(async (token) => {
        await apiPatch(`/api/spending-budgets/${b.id}`, token, { status: b.status === "closed" ? "active" : "closed" })
      }),
    onMove: (b: SpendingBudget, dir: "up" | "down") =>
      void withToken(async (token) => {
        const siblings = budgets.filter((x) => x.parent_id === b.parent_id && x.status === b.status && !x.is_overall)
        const i = siblings.findIndex((x) => x.id === b.id)
        const j = dir === "up" ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= siblings.length) return
        const ids = siblings.map((x) => x.id)
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        await apiPost("/api/spending-budgets/reorder", token, { ids })
      }),
    onRemove: (b: SpendingBudget) => setRemoving(b),
  }

  const reorder = (ids: string[]) =>
    void withToken(async (token) => {
      await apiPost("/api/spending-budgets/reorder", token, { ids })
    })

  const confirmRemove = () => {
    const b = removing
    if (!b) return
    setRemoving(null)
    void withToken(async (token) => {
      await apiDelete(`/api/spending-budgets/${b.id}`, token)
      toast.success(t("budgets.removed"))
    })
  }

  const tabButton = (key: "budgets" | "analytics", label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      data-testid={`tab-${key}`}
      className={`pressable min-h-11 flex-1 rounded-md px-3 text-sm font-medium transition-colors sm:min-h-9 ${
        tab === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4 p-3 sm:space-y-5 sm:p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <MoneyBag className="size-5 shrink-0 text-muted-foreground" aria-hidden /> {t("budgets.title")}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("budgets.subtitle")}</p>
        </div>
        {canWrite && budgets.length > 0 && (
          <Button className="h-11 sm:h-9" onClick={() => setDialog({ kind: "create" })} data-testid="budget-add">
            <Plus className="size-4" /> {t("budgets.add")}
          </Button>
        )}
      </div>

      <div role="tablist" aria-label={t("budgets.title")} className="flex gap-1 rounded-lg bg-muted p-1">
        {tabButton("budgets", t("budgets.tabBudgets"))}
        {tabButton("analytics", t("budgets.tabAnalytics"))}
      </div>

      {/* The scale everything on the page is read at. */}
      <div role="group" aria-label={t("budgets.viewLabel")} className="flex gap-1 rounded-lg bg-muted p-1" data-testid="view-toggle">
        {VIEW_WINDOWS.map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            data-testid={`view-${v}`}
            className={`pressable min-h-11 flex-1 truncate rounded-md px-2 text-sm font-medium transition-colors sm:min-h-9 ${
              view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t(`budget.${v}`)}
          </button>
        ))}
      </div>

      {tab === "analytics" ? (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <BudgetAnalyticsPanel
            view={view}
            budgets={budgets}
            onBudgetCategory={(category) => {
              setTab("budgets")
              setDialog({ kind: "create", prefillCategories: [category] })
            }}
          />
        </Suspense>
      ) : loading ? (
        <Card className="py-0">
          <CardContent className="space-y-4 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : budgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-12 text-center sm:py-16">
          <MoneyBag className="mx-auto mb-3 size-10 text-muted-foreground/50" aria-hidden />
          <p className="text-sm font-medium">{t("budgets.empty")}</p>
          <p className="mx-auto mt-1 max-w-md px-6 text-xs text-muted-foreground">
            {canWrite ? t("budgets.emptyHint") : t("budgets.emptyReadOnly")}
          </p>
          {canWrite && (
            <Button className="mt-4 h-11 sm:h-9" onClick={() => setDialog({ kind: "create" })} data-testid="budget-add">
              <Plus className="size-4" /> {t("budgets.setFirst")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* The overall budget: the one figure everything else is measured against. */}
          <Card className="py-0" data-testid="overall-card">
            <CardContent className="p-4">
              {overall && overallView ? (
                <>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-muted-foreground">{t("budgets.overall")}</p>
                      <p className="mt-0.5 text-2xl font-bold tabular-nums">
                        {money(overallView.spent)}{" "}
                        <span className="text-base font-normal text-muted-foreground">/ {money(overallView.limit)}</span>
                      </p>
                    </div>
                    <p className={`text-sm font-medium tabular-nums ${DELTA_COLOR[overallView.state]}`}>
                      {overallView.remaining >= 0
                        ? t("budgets.left", { amount: money(overallView.remaining) })
                        : t("budgets.over", { amount: money(-overallView.remaining) })}
                    </p>
                  </div>
                  <div
                    className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(barPct(overallView.ratio))}
                    aria-label={t("budgets.overall")}
                  >
                    <div className={`h-full rounded-full transition-[width] duration-500 ${BAR_COLOR[overallView.state]}`} style={{ width: `${barPct(overallView.ratio)}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {overallView.days_left !== null && t("budgets.daysLeft", { count: overallView.days_left })}
                    {overallView.per_day_left !== null && <> · {t("budgets.perDay", { amount: money(overallView.per_day_left) })}</>}
                  </p>
                  {lines.length > 0 && (
                    <div className="mt-3 border-t pt-3">
                      <p className="text-xs text-muted-foreground">
                        {t("budgets.allocated", { allocated: money(alloc.allocated), total: money(overallView.limit) })}
                        {alloc.unallocated !== null && (
                          <span className={alloc.over ? "text-amber-600 dark:text-amber-400" : ""}>
                            {" · "}
                            {alloc.over
                              ? t("budgets.overAllocated", { amount: money(-alloc.unallocated) })
                              : t("budgets.unallocated", { amount: money(alloc.unallocated) })}
                          </span>
                        )}
                      </p>
                      <div className="mt-2 flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        {lines.map((b) => {
                          const pct = overallView.limit > 0 ? Math.min(100, (inView(b, view, today).limit / overallView.limit) * 100) : 0
                          return <span key={b.id} className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} title={budgetName(t, b)} />
                        })}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{t("budgets.noOverall")}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("budgets.noOverallHint", { amount: money(alloc.allocated) })}</p>
                  </div>
                  {canWrite && (
                    <Button variant="outline" size="sm" className="h-11 sm:h-9" onClick={() => setDialog({ kind: "createOverall" })} data-testid="set-overall">
                      <Plus className="size-4" /> {t("budgets.setOverall")}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="py-0">
            <CardContent className="p-2 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2 sm:px-1">
                <h2 className="text-sm font-semibold">{t("budgets.yourBudgets")}</h2>
                {canWrite && lines.length + budgets.filter((b) => !b.parent_id && !b.is_overall && b.period === "once").length > 1 && (
                  <Button
                    variant={reordering ? "default" : "ghost"}
                    size="sm"
                    className="h-11 text-xs sm:h-8"
                    onClick={() => setReordering((v) => !v)}
                    data-testid="reorder-toggle"
                  >
                    {reordering ? <Check className="size-3.5" /> : <ArrowUpDown className="size-3.5" />}
                    {reordering ? t("budgets.doneReordering") : t("budgets.reorder")}
                  </Button>
                )}
              </div>
              {/* Rows in another currency with no rate for their day are not in
                  any figure below — say so instead of quietly under-reporting. */}
              {!loading && <FxExcludedNotice count={budgetsExcluded(budgets)} className="mb-2" />}
              <BudgetList
                budgets={budgets}
                view={view}
                today={today}
                canWrite={canWrite}
                canDelete={canDelete}
                reordering={reordering}
                categoryNames={(cats.data ?? []).map((c) => c.name)}
                actions={actions}
                onReorder={reorder}
              />
            </CardContent>
          </Card>
        </>
      )}

      {!isPersonal && tab === "budgets" && <ClientBudgetsSection />}

      {/* Mounted closed and OPENED, never mounted open: the dialog's back-gesture
          hook pushes a history entry on the false→true transition, and mounting
          with `open` already true pops it straight back. */}
      <SpendingBudgetDialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) setDialog(null)
        }}
        mode={dialog ?? { kind: "create" }}
        all={budgets}
        onSaved={refetch}
      />

      <AlertDialog open={!!removing} onOpenChange={(o) => { if (!o) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("budgets.removeTitle", { name: removing ? budgetName(t, removing) : "" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {removing && removing.children_count > 0 ? t("budgets.removeBodyWithSubs") : t("budgets.removeBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11 sm:h-9">{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="h-11 bg-destructive text-white hover:bg-destructive/90 sm:h-9" onClick={confirmRemove}>
              {t("budgets.menu.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export default BudgetsPage

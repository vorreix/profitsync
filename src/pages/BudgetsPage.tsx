import { useCallback, useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { ChevronRight, TrendingUp, Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import { budgetState, type BudgetPeriod } from "@/lib/budget"
import type { Budget } from "@/lib/types"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { BudgetDialog } from "@/components/budget/BudgetDialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type OverviewBudget = {
  key: string
  client_id: string | null
  client_name: string | null
  is_own: boolean
  is_default: boolean
  period: BudgetPeriod
  amount: number
  spent: number | null
  state: "ok" | "warn" | "over" | "none"
  ratio: number | null
  creep_flagged: boolean
}
type Overview = {
  budgets: OverviewBudget[]
  account_type: string
  aggregate: { total_budget: number; total_spent: number; on_track: number; total: number }
}

const HEALTH_DOT = { ok: "bg-emerald-500", warn: "bg-amber-500", over: "bg-red-500", none: "bg-muted-foreground/40" }

export function BudgetsPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const canWrite = canWriteRole(activeOrg?.role)

  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [setDefaultOpen, setSetDefaultOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const token = await getToken()
      if (!token) return
      setData(await apiGet<Overview>("/api/budgets/overview", token))
    } catch {
      /* non-blocking */
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { void load() }, [load])

  const label = (b: OverviewBudget) =>
    b.client_name ?? (isPersonal ? t("budgetsPage.personal") : t("budgetsPage.companyDefault"))

  const agg = data?.aggregate
  const aggState = agg && agg.total_budget > 0 ? budgetState(agg.total_spent, agg.total_budget).state : "none"

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2">
            <MoneyBag className="size-5 text-muted-foreground shrink-0" /> {t("budgetsPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t("budgetsPage.subtitle")}</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}
          </div>
        </div>
      ) : !data || data.budgets.length === 0 ? (
        <div className="rounded-2xl border border-dashed py-16 text-center">
          <MoneyBag className="size-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm font-medium">{t("budgetsPage.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1 px-6">{t("budgetsPage.emptyHint")}</p>
          {canWrite && (
            <Button className="mt-4" onClick={() => setSetDefaultOpen(true)}>
              <Plus className="size-4" /> {t("budgetsPage.setBudget")}
            </Button>
          )}
        </div>
      ) : (
        <>
          {/* Cross-budget overview — one glanceable summary. */}
          {agg && agg.total > 0 && (
            <Card className="py-0">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    <span aria-hidden className={`size-2 shrink-0 rounded-full ${HEALTH_DOT[aggState]}`} />
                    {t("budgetsPage.acrossAllBudgets")}
                  </p>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("budgetsPage.onTrack", { count: agg.on_track, total: agg.total })}
                  </span>
                </div>
                <p className="mt-2 text-lg font-bold tabular-nums">
                  {formatMoney(agg.total_spent, currency)}
                  <span className="text-sm font-normal text-muted-foreground"> / {formatMoney(agg.total_budget, currency)}</span>
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-[width] duration-500 ${aggState === "over" ? "bg-red-500" : aggState === "warn" ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${Math.min(100, agg.total_budget > 0 ? (agg.total_spent / agg.total_budget) * 100 : 0)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* One card per budget → tap into its history + insights. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
            {data.budgets.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={() => navigate(`/budgets/${b.key}`)}
                className="pressable group flex flex-col gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-foreground/15 hover:bg-accent"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{label(b)}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.is_default && !isPersonal ? t("budgetsPage.defaultTemplate") : t(`budget.${b.period}`)}
                    </p>
                  </div>
                  {b.creep_flagged && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
                      <TrendingUp className="size-2.5" /> {t("budgetsPage.creep")}
                    </span>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                </div>
                {b.spent !== null ? (
                  <BudgetIndicator amount={b.amount} spent={b.spent} period={b.period} currency={currency} />
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {formatMoney(b.amount, currency)} · {t(`budget.${b.period}`)}
                  </p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Empty-state quick-set targets the org/personal budget (client_id = null). */}
      <BudgetDialog
        open={setDefaultOpen}
        onOpenChange={setSetDefaultOpen}
        clientId={null}
        label={isPersonal ? t("budgetsPage.personal") : t("budgetsPage.companyDefault")}
        current={null as Budget | null}
        onSaved={() => { void load() }}
      />
    </div>
  )
}

export default BudgetsPage

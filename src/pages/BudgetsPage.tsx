import { useMemo, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Plus } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { apiDelete, apiErrorMessage, apiPatch, apiPost } from "@/lib/api"
import { useApiQuery } from "@/hooks/use-api-query"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canDeleteRole, canWriteRole } from "@/lib/roles"
import { formatMoney } from "@/lib/wealth"
import type { SpendingPeriod } from "@/lib/budget"
import type { SpendingBudget, SpendingBudgetsResponse } from "@/lib/types"
import { BudgetRow, type BudgetRowActions } from "@/components/budget/BudgetRow"
import { SpendingBudgetDialog, type SpendingBudgetDialogMode } from "@/components/budget/SpendingBudgetDialog"
import { ClientBudgetsSection } from "@/components/budget/ClientBudgetsSection"
import { budgetName, nestBudgets, periodLabel } from "@/components/budget/budget-format"
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

const SECTION_ORDER: SpendingPeriod[] = ["daily", "weekly", "monthly", "yearly", "once"]

/**
 * /budgets — where am I with each budget?
 *
 * One card, one list. Main budgets with their sub-budgets underneath, grouped
 * by window only when more than one is in use (a single monthly budget gets no
 * "This month" header above it). A section header never SUMS its rows — an
 * all-spending budget and a groceries budget would count the same receipt
 * twice — it shows the server's union figure, and quotes a limit only when
 * the scopes are disjoint. A business workspace keeps its per-client spend
 * caps in a second section below.
 */
export function BudgetsPage() {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const isPersonal = activeOrg?.account_type === "personal"
  const canWrite = canWriteRole(activeOrg?.role)
  const canDelete = canDeleteRole(activeOrg?.role)
  const money = (n: number) => formatMoney(n, currency)

  const { data, loading, refetch } = useApiQuery<SpendingBudgetsResponse>("/api/spending-budgets")
  const budgets = useMemo(() => data?.budgets ?? [], [data])
  const groups = useMemo(() => nestBudgets(budgets), [budgets])

  const [dialog, setDialog] = useState<SpendingBudgetDialogMode | null>(null)
  const [removing, setRemoving] = useState<SpendingBudget | null>(null)
  const [busy, setBusy] = useState(false)

  const sections = useMemo(
    () =>
      SECTION_ORDER.map((period) => ({ period, groups: groups.filter((g) => g.budget.period === period) })).filter((s) => s.groups.length),
    [groups],
  )
  const showHeaders = sections.length > 1

  const withToken = async (fn: (token: string) => Promise<void>) => {
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
  }

  const actions: BudgetRowActions = {
    onEdit: (b) => setDialog({ kind: "edit", budget: b }),
    onAddSub: (parent) => setDialog({ kind: "createSub", parent }),
    onToggleStatus: (b) =>
      void withToken(async (token) => {
        await apiPatch(`/api/spending-budgets/${b.id}`, token, { status: b.status === "paused" ? "active" : "paused" })
      }),
    onMove: (b, dir) =>
      void withToken(async (token) => {
        const siblings = budgets.filter((x) => x.parent_id === b.parent_id)
        const i = siblings.findIndex((x) => x.id === b.id)
        const j = dir === "up" ? i - 1 : i + 1
        if (i < 0 || j < 0 || j >= siblings.length) return
        const ids = siblings.map((x) => x.id)
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        await apiPost("/api/spending-budgets/reorder", token, { ids })
      }),
    onRemove: (b) => setRemoving(b),
  }

  const confirmRemove = () => {
    const b = removing
    if (!b) return
    setRemoving(null)
    void withToken(async (token) => {
      await apiDelete(`/api/spending-budgets/${b.id}`, token)
      toast.success(t("budgets.removed"))
    })
  }

  return (
    <div className="space-y-4 p-3 sm:space-y-6 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
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

      {loading ? (
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
          <p className="mx-auto mt-1 max-w-md px-6 text-xs text-muted-foreground">{canWrite ? t("budgets.emptyHint") : t("budgets.emptyReadOnly")}</p>
          {canWrite && (
            <Button className="mt-4 h-11 sm:h-9" onClick={() => setDialog({ kind: "create" })} data-testid="budget-add">
              <Plus className="size-4" /> {t("budgets.setFirst")}
            </Button>
          )}
        </div>
      ) : (
        <Card className="py-0">
          <CardContent className="p-2 sm:p-4">
            {sections.map(({ period, groups: list }) => {
              const summary = data?.sections?.[period]
              const first = list[0].budget
              return (
                <section key={period} className="py-1" aria-label={periodLabel(t, period)}>
                  {showHeaders && (
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-2 pb-1 pt-2 sm:px-1">
                      <h2 className="text-sm font-semibold">{periodLabel(t, period)}</h2>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {summary && (summary.limit !== null
                          ? t("budgets.spentOf", { spent: money(summary.spent), amount: money(summary.limit) })
                          : t("budgets.spentSoFar", { amount: money(summary.spent) }))}
                        {summary && summary.count > 1 && <> · {t("budgets.onTrack", { count: summary.on_track, total: summary.count })}</>}
                        {period !== "once" && first.window.days_left !== null && <> · {t("budgets.daysLeft", { count: first.window.days_left })}</>}
                      </p>
                    </div>
                  )}
                  <ul className="space-y-1" data-testid={`budgets-${period}`}>
                    {list.map(({ budget, children }, i) => (
                      <BudgetRow
                        key={budget.id}
                        budget={budget}
                        children={children}
                        isFirst={i === 0}
                        isLast={i === list.length - 1}
                        canWrite={canWrite}
                        canDelete={canDelete}
                        actions={actions}
                      />
                    ))}
                  </ul>
                </section>
              )
            })}
            {!showHeaders && sections[0] && sections[0].period !== "once" && sections[0].groups[0].budget.window.days_left !== null && (
              <p className="px-2 pt-2 text-[11px] text-muted-foreground sm:px-1">
                {periodLabel(t, sections[0].period)} · {t("budgets.daysLeft", { count: sections[0].groups[0].budget.window.days_left })}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isPersonal && <ClientBudgetsSection />}

      {/* Mounted closed and OPENED, never mounted open: the dialog's back-gesture
          hook pushes a history entry on the false→true transition, and a
          mount-with-open under StrictMode's double effect would pop it straight
          back and slam the dialog shut. */}
      <SpendingBudgetDialog open={dialog !== null} onOpenChange={(o) => { if (!o) setDialog(null) }} mode={dialog ?? { kind: "create" }} all={budgets} onSaved={refetch} />

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

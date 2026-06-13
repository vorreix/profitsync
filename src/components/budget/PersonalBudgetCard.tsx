import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { Plus, ChevronRight } from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import type { Budget } from "@/lib/types"
import { useDataRefresh } from "@/lib/data-refresh-context"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { BudgetDialog } from "@/components/budget/BudgetDialog"

/**
 * The personal (org-level) expense budget, shown on the personal dashboard. Loads
 * the org's client_id=NULL budget and renders the spend indicator + a set/edit
 * dialog. Self-contained so the Dashboard just drops it in for personal accounts.
 */
export function PersonalBudgetCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  // Refetch when any mutation bumps the app-wide refresh signal (e.g. FAB add).
  const { revision } = useDataRefresh()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Gate the empty "Set budget" state on the first load so a refresh doesn't flash
  // "no budget" → real budget (confusing). Show a skeleton until we actually know.
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      setBudget(res.budgets.find((b) => b.client_id === null) ?? null)
    } catch {
      /* non-blocking */
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, revision])

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate("/budgets/default")}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate("/budgets/default") } }}
      className={`group py-0 cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MoneyBag className="size-4 text-muted-foreground" />
            {t("budget.personal")}
          </div>
          <div className="flex items-center gap-0.5">
            {canWrite && loaded && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setDialogOpen(true) }}>
                {budget ? t("budget.edit") : <><Plus className="size-3 mr-1" />{t("budget.set")}</>}
              </Button>
            )}
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
          </div>
        </div>
        <div className="mt-3">
          {!loaded ? (
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-1.5 w-full" />
            </div>
          ) : budget ? (
            <BudgetIndicator amount={budget.amount} spent={budget.spent ?? 0} period={budget.period} currency={currency} />
          ) : (
            <p className="text-xs text-muted-foreground">{t("budget.noBudget")}</p>
          )}
        </div>
      </CardContent>
      <BudgetDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientId={null}
        label={t("budget.personal")}
        current={budget}
        onSaved={() => { void load() }}
      />
    </Card>
  )
}

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { Plus, PiggyBank, ChevronRight } from "lucide-react"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import type { Budget } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { BudgetIndicator } from "@/components/budget/BudgetIndicator"
import { BudgetDialog } from "@/components/budget/BudgetDialog"

/**
 * The OWN company's expense budget, shown on the business dashboard — the
 * counterpart of {@link PersonalBudgetCard}, but bound to the `is_own` client
 * instead of the org-level (client_id=NULL) budget. Loads that client's budget
 * (spend derived server-side) and renders the indicator + a set/edit dialog.
 */
export function BusinessBudgetCard({
  clientId,
  clientName,
  className = "",
}: {
  clientId: string
  clientName: string
  className?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [defaultBudget, setDefaultBudget] = useState<Budget | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // Gate the empty "Set budget" state on the first load so a refresh doesn't flash
  // "no budget" → real budget (confusing). Show a skeleton until we actually know.
  const [loaded, setLoaded] = useState(false)

  const load = async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      setBudget(res.budgets.find((b) => b.client_id === clientId) ?? null)
      setDefaultBudget(res.budgets.find((b) => b.client_id === null) ?? null)
    } catch {
      /* non-blocking */
    } finally {
      setLoaded(true)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, clientId])

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/budgets/${clientId}`)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigate(`/budgets/${clientId}`) } }}
      className={`group py-0 cursor-pointer transition-colors hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium min-w-0">
            <PiggyBank className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">{t("dashboard.ownCompanyBudget")}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {canWrite && loaded && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={(e) => { e.stopPropagation(); setDialogOpen(true) }}>
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
        clientId={clientId}
        label={clientName}
        current={budget}
        prefill={defaultBudget ? { amount: defaultBudget.amount, period: defaultBudget.period } : null}
        onSaved={() => { void load() }}
      />
    </Card>
  )
}

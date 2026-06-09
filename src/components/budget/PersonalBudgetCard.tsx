import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { Plus, Wallet } from "lucide-react"
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
 * The personal (org-level) expense budget, shown on the personal dashboard. Loads
 * the org's client_id=NULL budget and renders the spend indicator + a set/edit
 * dialog. Self-contained so the Dashboard just drops it in for personal accounts.
 */
export function PersonalBudgetCard({ className = "" }: { className?: string }) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
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
  }, [activeOrg?.id])

  return (
    <Card className={`py-0 ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wallet className="size-4 text-muted-foreground" />
            {t("budget.personal")}
          </div>
          {canWrite && loaded && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setDialogOpen(true)}>
              {budget ? t("budget.edit") : <><Plus className="size-3 mr-1" />{t("budget.set")}</>}
            </Button>
          )}
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

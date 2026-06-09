import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { Plus, Building2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { canWriteRole } from "@/lib/roles"
import type { Budget } from "@/lib/types"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
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
  const { getToken } = useAuth()
  const { currency } = useCurrency()
  const { activeOrg } = useOrg()
  const canWrite = canWriteRole(activeOrg?.role)
  const [budget, setBudget] = useState<Budget | null>(null)
  const [defaultBudget, setDefaultBudget] = useState<Budget | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const load = async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await apiGet<{ budgets: Budget[] }>("/api/budgets", token)
      setBudget(res.budgets.find((b) => b.client_id === clientId) ?? null)
      setDefaultBudget(res.budgets.find((b) => b.client_id === null) ?? null)
    } catch {
      /* non-blocking */
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrg?.id, clientId])

  return (
    <Card className={`py-0 ${className}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium min-w-0">
            <Building2 className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">{t("dashboard.ownCompanyBudget")}</span>
          </div>
          {canWrite && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={() => setDialogOpen(true)}>
              {budget ? t("budget.edit") : <><Plus className="size-3 mr-1" />{t("budget.set")}</>}
            </Button>
          )}
        </div>
        <div className="mt-3">
          {budget ? (
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

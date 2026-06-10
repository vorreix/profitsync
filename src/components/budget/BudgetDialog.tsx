import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, Trash2 } from "lucide-react"
import { apiPost } from "@/lib/api"
import { BUDGET_PERIODS, type BudgetPeriod } from "@/lib/budget"
import type { Budget } from "@/lib/types"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const PERIOD_KEY: Record<BudgetPeriod, string> = {
  lifetime: "budget.lifetime",
  monthly: "budget.monthly",
  weekly: "budget.weekly",
  daily: "budget.daily",
}

/**
 * Set / change / remove an expense budget. Calls POST /api/budgets which upserts by
 * (org, client_id); amount 0 (or Remove) clears it. `clientId` is null for the
 * personal budget (personal org) or the business default. `onSaved` receives the
 * new budget row (or null when removed) so the caller can update its list in place.
 */
export function BudgetDialog({
  open,
  onOpenChange,
  clientId,
  label,
  current,
  prefill,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string | null
  label: string
  current?: Budget | null
  prefill?: { amount?: number; period?: BudgetPeriod } | null
  onSaved: (budget: Budget | null) => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [amount, setAmount] = useState("")
  const [period, setPeriod] = useState<BudgetPeriod>("monthly")
  const [saving, setSaving] = useState<"save" | "remove" | null>(null)

  // Seed from the current budget (edit) or the prefill (e.g. the business default).
  useEffect(() => {
    if (!open) return
    if (current) {
      setAmount(String(current.amount))
      setPeriod(current.period)
    } else {
      setAmount(prefill?.amount ? String(prefill.amount) : "")
      setPeriod(prefill?.period ?? "monthly")
    }
    setSaving(null)
  }, [open, current, prefill])

  const save = async (remove = false) => {
    setSaving(remove ? "remove" : "save")
    try {
      const token = await getToken()
      if (!token) return
      const amt = remove ? 0 : Number(amount)
      const res = await apiPost<Budget | { removed: true }>("/api/budgets", token, {
        client_id: clientId,
        period,
        amount: amt,
      })
      if (remove || amt === 0) {
        toast.success(t("budget.removed"))
        onSaved(null)
      } else {
        toast.success(t("budget.saved"))
        onSaved(res as Budget)
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budget.saveFailed"))
      setSaving(null)
    }
  }

  const amt = Number(amount)
  const canSave = !saving && Number.isFinite(amt) && amt > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-sm">
        <DialogHeader>
          <DialogTitle>{current ? t("budget.edit") : t("budget.set")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">{label}</p>
        <div className="space-y-3 mt-1">
          <div className="space-y-1.5">
            <Label htmlFor="budget-amount">{t("budget.amountLabel")}</Label>
            <Input
              id="budget-amount"
              inputMode="decimal"
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("budget.periodLabel")}</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as BudgetPeriod)}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {BUDGET_PERIODS.map((p) => (
                  <SelectItem key={p} value={p}>{t(PERIOD_KEY[p])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {/* Footer: Save is the one primary action; Remove is destructive and kept
            visually apart (its own row under a divider on mobile, far-left on desktop)
            so the three buttons don't read as one cluttered group. */}
        <DialogFooter className="mt-4 gap-2 sm:items-center">
          {current && (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!saving}
                onClick={() => save(true)}
                className="w-full justify-center text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto sm:w-auto"
              >
                {saving === "remove" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                {t("budget.remove")}
              </Button>
              <div className="h-px bg-border sm:hidden" aria-hidden />
            </>
          )}
          <Button variant="outline" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={!!saving}>
            {t("common.cancel")}
          </Button>
          <Button className="w-full sm:w-auto" onClick={() => save(false)} disabled={!canSave}>
            {saving === "save" ? <Loader2 className="size-4 animate-spin" /> : t("budget.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

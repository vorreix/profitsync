import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { HandCoins, Plus } from "lucide-react"
import { apiErrorMessage, apiGet, apiPatch } from "@/lib/api"
import { isLinkable, type LinkCandidateRule } from "@/lib/debt-recurring"
import { dropModalBackEntry } from "@/hooks/use-back-close"
import type { Debt, DebtsOverview, RecurringRuleDetail } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Point an existing recurring rule at the debt it has really been paying.
 *
 * The mirror image of the debt screen's "link an existing one": same rules
 * (src/lib/debt-recurring.ts linkRefusal), same single server operation, same
 * forward-only promise. Only the direction the user approaches it from differs,
 * and people arrive from both — sometimes holding the debt, sometimes the
 * standing order.
 */
export function LinkDebtDialog({
  open,
  onOpenChange,
  rule,
  onLinked,
  onCreateDebt,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rule: RecurringRuleDetail
  onLinked: () => void
  /** Nothing fits: open the edit dialog, where a debt can be made on the spot. */
  onCreateDebt: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const today = new Date().toISOString().split("T")[0]
  const [data, setData] = useState<DebtsOverview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setData(null)
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const overview = await apiGet<DebtsOverview>("/api/debts", token).catch(() => null)
      if (!cancelled) setData(overview)
    })()
    return () => { cancelled = true }
  }, [open, getToken])

  const candidate: LinkCandidateRule = useMemo(
    () => ({
      id: rule.id,
      kind: (rule.kind ?? "standard") as LinkCandidateRule["kind"],
      type: rule.type,
      cardId: rule.card_id ?? null,
      accountId: rule.wealth_account_id,
      // Everything the server fills in, filled in here too. Guessing any of
      // these (an archived payer, an expired rule, instalments still waiting)
      // is how a picker offers a row that is refused the moment it is clicked.
      accountType: rule.account_type ?? null,
      accountArchived: !!rule.account_archived,
      accountCurrency: rule.account_currency ?? rule.currency_code ?? null,
      debtAccountId: rule.debt_account_id ?? null,
      ended: !!rule.end_date && rule.end_date < today,
      hasPending: rule.active && String(rule.next_due_at).slice(0, 10) <= today,
    }),
    [rule, today],
  )

  // Exactly the predicate the server applies, so nothing on this list can be
  // clicked and then refused.
  const eligible = useMemo(() => {
    const all: Debt[] = [...(data?.debts ?? []), ...(data?.receivables ?? [])]
    return all.filter((d) =>
      isLinkable(candidate, {
        id: d.id,
        direction: d.direction,
        archived: !!d.archived_at,
        currency: d.currency,
        // Only a boolean is exposed, which is all the one-repayment rule needs:
        // is something OTHER than this rule already attached? PAUSED counts —
        // a debt with a paused rule must not quietly take a second one.
        lifecycle: d.lifecycle,
        linkedRuleIds: (d.repayment_linked ?? d.repayment_active) ? (rule.debt_account_id === d.id ? [rule.id] : ["other"]) : [],
      }),
    )
  }, [data, candidate, rule.id, rule.debt_account_id])

  async function link(debt: Debt) {
    setBusy(debt.id)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/recurring/${rule.id}`, token, { debt_account_id: debt.id })
      toast.success(t("recurring.linkedToDebt"))
      onOpenChange(false)
      onLinked()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("recurring.failedToUpdate")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("recurring.linkDebtTitle")}</DialogTitle>
          <DialogDescription>{t("recurring.linkDebtDesc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[50svh] space-y-2 overflow-y-auto scrollbar-thin py-1">
          {data === null ? (
            <>{[1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</>
          ) : eligible.length === 0 ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 px-3 py-6 text-center">
              <p className="text-sm text-muted-foreground">{t("recurring.linkDebtNone")}</p>
              {/* Nothing fits usually means the debt simply is not in the app
                  yet, which is a thing to offer rather than a dead end.
                  dropModalBackEntry first: chaining straight into another modal
                  otherwise pops OUR back-entry, and the pop slams the new one
                  shut before it has painted. */}
              <Button variant="outline" size="sm" className="pressable" onClick={() => { dropModalBackEntry(); onOpenChange(false); onCreateDebt() }}>
                <Plus className="size-4" /> {t("recurring.createDebtForThis")}
              </Button>
            </div>
          ) : (
            eligible.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={!!busy}
                onClick={() => void link(d)}
                className={cn(
                  "pressable flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40",
                  busy === d.id && "opacity-60",
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <HandCoins className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{d.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {d.direction === "receivable" ? t("debts:owedToMe") : t("debts:iOwe")}
                  </span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(d.balance, d.currency, true)}</span>
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("recurring.linkDebtForwardOnly")}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>{t("common.cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Repeat } from "lucide-react"
import { apiErrorMessage, apiGet, apiPatch } from "@/lib/api"
import { isLinkable, type LinkCandidateRule, type LinkTargetDebt } from "@/lib/debt-recurring"
import type { Debt, RecurringRule } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"

const everyLabel = (r: RecurringRule, t: (k: string, o?: Record<string, unknown>) => string) =>
  r.frequency_interval === 1
    ? t(`unitEvery.${r.frequency_unit}`)
    : t("frequencyCustom", { interval: r.frequency_interval, unit: t(`unit.${r.frequency_unit}`) })

/**
 * Adopt a recurring rule the user already has as this debt's repayment.
 *
 * The standing order almost always exists before the debt does: "Car loan €300"
 * runs as a plain expense for months, then the loan gets added and the same
 * money is in the app twice. This is the join — and it is FORWARD ONLY, which
 * the dialog says out loud, because the occurrences already posted were
 * expenses and rewriting them would move balances and budget periods that have
 * already been reported on.
 */
export function LinkRepaymentDialog({
  open,
  onOpenChange,
  debt,
  linkedRuleIds,
  onLinked,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  debt: Debt
  /** Rules already servicing this debt, so the one-repayment rule can be applied. */
  linkedRuleIds: string[]
  onLinked: () => void
}) {
  const { t } = useTranslation("debts")
  const { getToken } = useAuth()
  const [rules, setRules] = useState<RecurringRule[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const today = new Date().toISOString().split("T")[0]

  useEffect(() => {
    if (!open) return
    setRules(null)
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token) return
      const all = await apiGet<RecurringRule[]>("/api/recurring", token).catch(() => [] as RecurringRule[])
      if (!cancelled) setRules(all)
    })()
    return () => { cancelled = true }
  }, [open, getToken])

  const target: LinkTargetDebt = useMemo(
    () => ({ id: debt.id, direction: debt.direction, archived: !!debt.archived_at, currency: debt.currency, lifecycle: debt.lifecycle, linkedRuleIds }),
    [debt.id, debt.direction, debt.archived_at, debt.currency, debt.lifecycle, linkedRuleIds],
  )

  // The SAME predicate the server enforces (src/lib/debt-recurring.ts), so the
  // list never offers something that will be refused on click.
  const eligible = useMemo(
    () =>
      (rules ?? []).filter((r) =>
        isLinkable(
          {
            id: r.id,
            kind: (r.kind ?? "standard") as LinkCandidateRule["kind"],
            type: r.type,
            cardId: r.card_id ?? null,
            accountId: r.wealth_account_id,
      // Everything the server fills in, filled in here too. Guessing any of
      // these (an archived payer, an expired rule, instalments still waiting)
      // is how a picker offers a row that is refused the moment it is clicked.
            accountType: r.account_type ?? null,
            accountArchived: !!r.account_archived,
            accountCurrency: r.account_currency ?? r.currency_code ?? null,
            debtAccountId: r.debt_account_id ?? null,
            ended: !!r.end_date && r.end_date < today,
            hasPending: r.active && String(r.next_due_at).slice(0, 10) <= today,
          },
          target,
        ),
      ),
    [rules, target, today],
  )

  async function link(rule: RecurringRule) {
    setBusy(rule.id)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPatch(`/api/recurring/${rule.id}`, token, { debt_account_id: debt.id })
      toast.success(t("repaymentLinked"))
      onOpenChange(false)
      onLinked()
    } catch (err) {
      toast.error(apiErrorMessage(err, t("couldNotSave")))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("linkRepaymentTitle")}</DialogTitle>
          <DialogDescription>{t("linkRepaymentDesc")}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[50svh] space-y-2 overflow-y-auto scrollbar-thin py-1">
          {rules === null ? (
            <>{[1, 2].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</>
          ) : eligible.length === 0 ? (
            <p className="rounded-xl border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
              {t("linkRepaymentNone", { direction: debt.direction === "receivable" ? t("linkIncoming") : t("linkOutgoing") })}
            </p>
          ) : (
            eligible.map((r) => (
              <button
                key={r.id}
                type="button"
                disabled={!!busy}
                onClick={() => void link(r)}
                className={cn(
                  "pressable flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40",
                  busy === r.id && "opacity-60",
                )}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Repeat className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.account_name ?? t("repaymentNoAccount")}
                    {!r.active && ` · ${t("repaymentPaused")}`}
                  </span>
                </span>
                <span className="shrink-0 text-end">
                  <span className="block text-sm font-semibold tabular-nums">{formatMoney(Number(r.amount), debt.currency, true)}</span>
                  <span className="block text-[11px] text-muted-foreground">{everyLabel(r, t)}</span>
                </span>
              </button>
            ))
          )}
        </div>

        <p className="text-xs text-muted-foreground">{t("linkRepaymentForwardOnly")}</p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={!!busy}>{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Loader as Loader2, Undo2 } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import type { BudgetProvisionalRefund } from "@/lib/types"
import { Button } from "@/components/ui/button"

/**
 * Provisional refunds, disclosed and correctable (spec §6.10, §8.8).
 *
 * An inflow that shares a category with an envelope is netted against it as a
 * GUESS, because that is usually right and silently ignoring it would overstate
 * spending. But a guess must never masquerade as a fact: this lists every one,
 * says which envelope it affects, and lets the user say "not a refund" — which
 * records an audited exclusion rather than editing the transaction.
 *
 * Renders nothing when there is nothing to review, so it costs no attention in
 * the common case.
 */
export function RefundReview({
  revision,
  money,
  canWrite,
  onChanged,
}: {
  /** Bump to re-fetch after the plan changes. */
  revision: number
  money: (n: number) => string
  canWrite: boolean
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [refunds, setRefunds] = useState<BudgetProvisionalRefund[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const token = await getToken()
        if (!token) return
        const res = await apiGet<{ refunds: BudgetProvisionalRefund[] }>("/api/budgets/v2/refunds", token)
        if (alive) setRefunds(Array.isArray(res?.refunds) ? res.refunds : [])
      } catch {
        // Non-critical: the figures are already correct with the guess applied,
        // so a failure here removes a review affordance, not a number.
        if (alive) setRefunds([])
      }
    })()
    return () => {
      alive = false
    }
  }, [revision, getToken])

  if (dismissed || !refunds.length) return null

  const reject = async (r: BudgetProvisionalRefund) => {
    setBusy(r.transaction_id)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/budgets/v2/refunds", token, { action: "reject", transaction_id: r.transaction_id }, [
        "/api/budgets",
      ])
      setRefunds((list) => list.filter((x) => x.transaction_id !== r.transaction_id))
      toast.success(t("budgetV2.refundRejected"))
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("budgetV2.refundFailed"))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="refunds-h" className="rounded-xl border bg-muted/30 p-3 sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="refunds-h" className="text-sm font-semibold">
            {t("budgetV2.refundReviewTitle", { count: refunds.length })}
          </h2>
          {/* The wording must convey a GUESS the user can correct. */}
          <p className="mt-0.5 text-xs text-muted-foreground">{t("budgetV2.refundReviewBody")}</p>
        </div>
        <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => setDismissed(true)}>
          {t("budgetV2.reviewLater")}
        </Button>
      </div>

      <ul className="mt-3 space-y-2">
        {refunds.map((r) => (
          <li
            key={r.transaction_id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background/70 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {r.description || r.category || t("budgetV2.noDescription")}
              </p>
              <p className="text-[11px] text-muted-foreground tabular-nums">
                +{money(r.amount)} · {r.date}
                {r.envelope ? ` · ${t("budgetV2.appliedTo", { name: r.envelope.name })}` : ""}
              </p>
            </div>
            {canWrite && (
              <div className="flex shrink-0 items-center gap-1">
                {/* Confirming is a no-op: the guess is ALREADY applied, so the
                    only action that changes anything is rejecting it. Offering a
                    "confirm" button that does nothing would be theatre. */}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 gap-1 px-2 text-xs"
                  disabled={busy === r.transaction_id}
                  onClick={() => reject(r)}
                >
                  {busy === r.transaction_id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Undo2 className="size-3" />
                  )}
                  {t("budgetV2.rejectRefund")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

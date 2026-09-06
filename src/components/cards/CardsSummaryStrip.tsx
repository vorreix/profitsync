import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { creditUsage } from "@/lib/credit-card"
import type { Card, CardSummary } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { shortDate, todayIso } from "@/components/cards/card-dates"

const DAY_MS = 86_400_000

/**
 * The line above the Cards grid. It adapts to what the user has: with any
 * credit card it shows what is owed, the credit left and the next payment due;
 * with only debit cards it stays a cheap count ("3 debit cards · linked to 2
 * banks") — summing per-card spend would cost one request per card. Owed and
 * available come straight from the card rows (no summary needed); only the next
 * due date needs the credit summaries, so that cell shows a skeleton until they
 * arrive. Privacy mode hides every amount.
 */
export function CardsSummaryStrip({
  cards,
  summaries,
  summariesLoading = false,
  currency,
  balancesVisible,
  canWrite,
  onAddCard,
}: {
  /** Open (non-closed) cards. */
  cards: Card[]
  summaries: Record<string, CardSummary | null | undefined>
  summariesLoading?: boolean
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  onAddCard: () => void
}) {
  const { t } = useTranslation("wealth")
  const money = (n: number) => formatMoney(n, currency, balancesVisible)

  const stats = useMemo(() => {
    const debit = cards.filter((c) => c.kind === "debit")
    const credit = cards.filter((c) => c.kind === "credit")
    const bankIds = new Set<string>()
    for (const c of cards) {
      const id = c.kind === "debit" ? c.account_id : c.funding_account_id
      if (id) bankIds.add(id)
    }
    let owed = 0
    let available = 0
    let hasLimit = false
    for (const c of credit) {
      const u = creditUsage(c.account_credit_limit, c.account_current_balance)
      owed += u.debt
      if (u.available !== null) { available += u.available; hasLimit = true }
    }
    // The soonest unpaid statement across every credit card.
    let next: { date: string; amount: number; card: string } | null = null
    for (const c of credit) {
      const s = summaries[c.id]?.credit?.statement
      if (!s || s.remaining <= 0) continue
      if (!next || s.due_date < next.date) next = { date: s.due_date, amount: s.remaining, card: c.id }
    }
    const today = todayIso()
    const days = next ? Math.round((Date.parse(`${next.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS) : null
    return { debit: debit.length, credit: credit.length, banks: bankIds.size, owed, available, hasLimit, next, days }
  }, [cards, summaries])

  const nextLoading = summariesLoading && !stats.next
  const dueTone = stats.days === null ? "" : stats.days < 0 ? "text-red-600 dark:text-red-400" : stats.days <= 3 ? "text-amber-600 dark:text-amber-400" : ""

  return (
    <div className="rounded-2xl border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{t("cards.count", { count: cards.length })}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {stats.debit > 0 && <span>{t("cards.debitCount", { count: stats.debit })}</span>}
            {stats.debit > 0 && stats.credit > 0 && <span aria-hidden> · </span>}
            {stats.credit > 0 && <span>{t("cards.creditCount", { count: stats.credit })}</span>}
            {stats.banks > 0 && (
              <>
                <span aria-hidden> · </span>
                <span>{t("cards.linkedToBanks", { count: stats.banks })}</span>
              </>
            )}
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={onAddCard} className="pressable">
            <Plus className="size-4" /> {t("cards.addCard")}
          </Button>
        )}
      </div>

      {/* Narrow screens: one row per figure (label · value). sm+: three stat tiles. */}
      {stats.credit > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border bg-card/60 px-3 py-2.5 sm:block sm:p-3">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{t("cards.owedTotal")}</p>
            <p className={cn("shrink-0 text-sm font-bold tabular-nums sm:mt-1 sm:text-lg", stats.owed > 0 ? "text-red-600 dark:text-red-400" : "")}>{money(stats.owed)}</p>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border bg-card/60 px-3 py-2.5 sm:block sm:p-3">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{t("cards.availableCredit")}</p>
            <p className="shrink-0 text-sm font-bold tabular-nums text-emerald-600 sm:mt-1 sm:text-lg dark:text-emerald-400">{stats.hasLimit ? money(stats.available) : "—"}</p>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border bg-card/60 px-3 py-2.5 sm:block sm:p-3">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{t("cards.nextDue")}</p>
            {nextLoading ? (
              <Skeleton className="h-5 w-20 shrink-0 sm:mt-1.5" />
            ) : stats.next ? (
              <div className="min-w-0 shrink-0 text-end sm:mt-1 sm:text-start">
                <p className={cn("text-sm font-bold tabular-nums sm:text-lg", dueTone)}>{shortDate(stats.next.date)}</p>
                <p className={cn("truncate text-[11px] tabular-nums text-muted-foreground", dueTone)}>
                  {money(stats.next.amount)}
                  {stats.days !== null && (
                    <>
                      <span aria-hidden> · </span>
                      {stats.days < 0 ? t("cards.overdueBy", { count: -stats.days }) : stats.days === 0 ? t("cards.dueToday") : t("cards.dueIn", { count: stats.days })}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <p className="shrink-0 text-sm font-semibold text-muted-foreground sm:mt-1 sm:text-lg">{t("cards.nothingDue")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

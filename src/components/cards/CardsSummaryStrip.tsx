import { useMemo, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Plus, WalletCards } from "lucide-react"
import { creditUsage } from "@/lib/credit-card"
import type { Card, CardSummary } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { shortDate, todayIso } from "@/components/cards/card-dates"

const DAY_MS = 86_400_000

/**
 * label + value on one baseline — the unit the status bar is built from. The
 * label shortens on a phone ("Owed" / "Owed on cards") so three figures still
 * fit on one line.
 */
function Figure({ label, short, tone, children }: { label: string; short: string; tone?: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0 text-[11px] font-medium text-muted-foreground">
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </span>
      <span className={cn("truncate text-sm font-semibold tabular-nums", tone)}>{children}</span>
    </span>
  )
}

/**
 * The status line above the Cards grid — deliberately ONE slim bar (one row on
 * a desktop, two on a phone), not a panel: for a handful of figures a stack of
 * stat tiles was the biggest block on the screen.
 *
 * It adapts to what the user has: with any credit card it shows what is owed,
 * the credit left and the next payment due; with only debit cards it stays a
 * cheap count ("3 cards · 3 debit cards") — summing per-card spend would cost
 * one request per card. Owed and available come straight from the card
 * rows (no summary needed); only the next due date needs the credit summaries,
 * so that figure shows a skeleton until they arrive. Privacy mode hides every
 * amount.
 */
export function CardsSummaryStrip({
  cards,
  summaries,
  summariesLoading = false,
  currency,
  balancesVisible,
  canWrite,
  onAddCard,
  onOpenFan,
}: {
  /** Open (non-closed) cards. */
  cards: Card[]
  summaries: Record<string, CardSummary | null | undefined>
  summariesLoading?: boolean
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  onAddCard: () => void
  /** Phone only: opens the card fan. Absent (or fewer than two cards) → no button. */
  onOpenFan?: () => void
}) {
  const { t } = useTranslation("wealth")
  const money = (n: number) => formatMoney(n, currency, balancesVisible)

  const stats = useMemo(() => {
    const debit = cards.filter((c) => c.kind === "debit")
    const credit = cards.filter((c) => c.kind === "credit")
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
    return { debit: debit.length, credit: credit.length, owed, available, hasLimit, next, days }
  }, [cards, summaries])

  const nextLoading = summariesLoading && !stats.next
  const dueTone = stats.days === null ? "" : stats.days < 0 ? "text-red-600 dark:text-red-400" : stats.days <= 3 ? "text-amber-600 dark:text-amber-400" : ""

  // Mobile order: [counts] [Add card] / [figures on their own line]. On sm+ the
  // three run inline and `flex-1` on the figures keeps the button at the end.
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-3 py-2.5 sm:px-4">
      {/* The breakdown is desktop-only: on a phone the bar has one line to
          spend and the figures earn it more than "1 debit card · 1 credit card". */}
      <p className="min-w-0 flex-1 truncate text-sm sm:flex-none">
        <span className="font-semibold">{t("cards.count", { count: cards.length })}</span>
        <span className="hidden text-muted-foreground sm:inline">
          {stats.debit > 0 && <> · {t("cards.debitCount", { count: stats.debit })}</>}
          {stats.credit > 0 && <> · {t("cards.creditCount", { count: stats.credit })}</>}
        </span>
      </p>

      {stats.credit > 0 && (
        <div className="order-3 flex w-full min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1.5 border-t pt-2 sm:order-none sm:w-auto sm:flex-1 sm:gap-x-4 sm:border-s sm:border-t-0 sm:ps-4 sm:pt-0">
          <Figure label={t("cards.owedTotal")} short={t("cards.owedShort")} tone={stats.owed > 0 ? "text-red-600 dark:text-red-400" : undefined}>
            {money(stats.owed)}
          </Figure>
          <Figure label={t("cards.availableCredit")} short={t("cards.availableShort")} tone="text-emerald-600 dark:text-emerald-400">
            {stats.hasLimit ? money(stats.available) : "—"}
          </Figure>
          {nextLoading ? (
            <span className="inline-flex items-baseline gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                <span className="sm:hidden">{t("cards.dueShort")}</span>
                <span className="hidden sm:inline">{t("cards.nextDue")}</span>
              </span>
              <Skeleton className="h-4 w-16" />
            </span>
          ) : stats.next ? (
            <Figure label={t("cards.nextDue")} short={t("cards.dueShort")} tone={dueTone}>
              {shortDate(stats.next.date)}
              <span className="font-normal text-muted-foreground"> · {money(stats.next.amount)}</span>
              {stats.days !== null && (
                <span className={cn("font-normal", dueTone || "text-muted-foreground")}>
                  {" "}
                  {stats.days < 0 ? t("cards.overdueBy", { count: -stats.days }) : stats.days === 0 ? t("cards.dueToday") : t("cards.dueIn", { count: stats.days })}
                </span>
              )}
            </Figure>
          ) : (
            // "Nothing due" says the label's job itself — a "Next payment due"
            // in front of it is a wasted line on a phone.
            <span className="text-sm font-medium text-muted-foreground">{t("cards.nothingDue")}</span>
          )}
        </div>
      )}

      {canWrite && (
        <Button size="sm" onClick={onAddCard} className="pressable order-2 min-h-11 shrink-0 sm:order-none sm:ms-auto sm:min-h-8">
          <Plus className="size-4" /> {t("cards.addCard")}
        </Button>
      )}

      {/* The fan: a phone-only way to hold every card in one hand. It is the
          last child and ms-auto, so it sits at the strip's bottom-right corner
          whatever the figures row wrapped to. Hidden from `sm` up, where the
          grid shows several tiles at once and there is nothing to fan. */}
      {onOpenFan && cards.length > 1 && (
        <Button
          variant="outline"
          size="icon"
          onClick={onOpenFan}
          aria-label={t("cards.fanOpen")}
          className="pressable order-4 ms-auto size-11 shrink-0 self-end sm:hidden"
        >
          <WalletCards className="size-5" aria-hidden />
        </Button>
      )}
    </div>
  )
}

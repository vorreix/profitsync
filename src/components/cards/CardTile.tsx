import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { cardDisplayName } from "@/lib/cards"
import { creditUsage } from "@/lib/credit-card"
import type { Card, CardSummary } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { CardActionsMenu } from "@/components/cards/CardActionsMenu"
import { cardStatusKey, shortDate, todayIso } from "@/components/cards/card-dates"

/**
 * The Cards grid: at most two columns, roomy gaps. Three cards across is what
 * made the tab feel cluttered — a payment card is a picture, and pictures need
 * air. Each tile is a CONTAINER, so a wide column lays the card and its status
 * out side by side instead of stretching the plastic into a billboard.
 */
const GRID = "grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2"

/** Grid placeholders in the card's own aspect ratio, so nothing jumps when the tiles arrive. */
export function CardsGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="@container/tile rounded-2xl border bg-card p-3.5 sm:p-4">
          <div className="flex flex-col @lg/tile:flex-row @lg/tile:items-center @lg/tile:gap-4">
            <Skeleton className="aspect-[1.586] w-full rounded-xl @lg/tile:w-56 @lg/tile:shrink-0 @2xl/tile:w-72" />
            <div className="mt-4 w-full @lg/tile:mt-0">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="mt-2.5 h-3 w-4/5" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Textual status pill — words carry the meaning, colour only reinforces it. */
export function CardStatusPill({ card, className }: { card: Pick<Card, "status" | "expiry_month" | "expiry_year">; className?: string }) {
  const { t } = useTranslation("wealth")
  const key = cardStatusKey(card)
  const tone = {
    statusActive: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    statusFrozen: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
    statusExpired: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
    statusClosed: "border-border bg-muted text-muted-foreground",
  }[key]
  return <Badge variant="outline" className={cn("py-0 text-[11px]", tone, className)}>{t(`cards.${key}`)}</Badge>
}

/**
 * One card in the Cards grid: the realistic visual (the whole tile links to the
 * card page), its status underneath — credit: owed · available of limit · due
 * date + a thin utilization bar; debit: bank · balance available — and the
 * kebab. Privacy mode hides every amount and the bar.
 */
export function CardTile({
  card,
  summary,
  currency,
  balancesVisible,
  canWrite,
  canDelete,
  onEdit,
  onChanged,
}: {
  card: Card
  summary?: CardSummary | null
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  canDelete: boolean
  onEdit?: () => void
  onChanged?: (card: Card | null) => void
}) {
  const { t } = useTranslation("wealth")
  const name = cardDisplayName(card)
  const bank = (card.account_nickname || card.account_bank_name || "").trim()
  const money = (n: number) => formatMoney(n, currency, balancesVisible)
  const isCredit = card.kind === "credit"
  const usage = isCredit ? creditUsage(card.account_credit_limit, card.account_current_balance) : null
  const statement = summary?.credit?.statement ?? null
  const today = todayIso()
  const dueSoon = statement && statement.remaining > 0 ? statement : null
  const overdue = !!dueSoon && dueSoon.due_date < today
  const pct = usage?.utilization !== null && usage?.utilization !== undefined ? Math.round(usage.utilization * 100) : null
  const dimmed = card.status !== "active"

  const parts: { key: string; text: string; className?: string }[] = []
  if (isCredit && usage) {
    parts.push({ key: "owed", text: usage.debt > 0 ? t("cards.owedLine", { owed: money(usage.debt) }) : usage.credit > 0 ? t("cardCredit", { amount: money(usage.credit) }) : t("cards.nothingOwed") })
    if (usage.limit !== null && usage.available !== null) parts.push({ key: "avail", text: t("cards.availableOfLine", { available: money(usage.available), limit: money(usage.limit) }) })
    if (dueSoon) parts.push({ key: "due", text: overdue ? t("cards.overdueLine", { date: shortDate(dueSoon.due_date) }) : t("cards.dueLine", { date: shortDate(dueSoon.due_date) }), className: overdue ? "font-medium text-red-600 dark:text-red-400" : undefined })
  } else {
    parts.push({ key: "debit", text: t("cards.debitLine", { bank: bank || t("bank"), balance: money(Number(card.account_current_balance ?? 0)) }) })
  }

  return (
    // Stretched-link tile: the Link is the single full-bleed click target (z-0);
    // the visible content sits above it (pointer-events-none) and only the kebab
    // re-enables pointer events — no interactive element nests inside another.
    <div
      data-card-tile={card.id}
      className={cn(
        "@container/tile group relative rounded-2xl border bg-card p-3.5 transition-colors hover:border-primary/40 sm:p-4",
        dimmed && "bg-muted/30",
      )}
    >
      <Link
        to={`/wealth/cards/${card.id}`}
        aria-label={t("cards.openCard", { name })}
        className="pressable ios-tap absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {/* Narrow: card over status. Wide column: card beside its status, with a
          hairline between them — the plastic never stretches past ~16rem. */}
      <div className="pointer-events-none relative z-10 flex flex-col @lg/tile:flex-row @lg/tile:items-center @lg/tile:gap-4">
        <div className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:-translate-y-0.5 @lg/tile:w-56 @lg/tile:shrink-0 @2xl/tile:w-72">
          <CardVisual {...visualPropsFromCard(card)} size="md" still className="w-full" />
        </div>
        <div className="mt-4 flex items-start gap-2 @lg/tile:mt-0 @lg/tile:min-w-0 @lg/tile:flex-1 @lg/tile:self-stretch @lg/tile:items-center @lg/tile:border-s @lg/tile:ps-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <p className="truncate text-sm font-semibold">{name}</p>
              <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{isCredit ? t("cards.kindCredit") : t("cards.kindDebit")}</span>
            </div>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground tabular-nums">
              {parts.map((p, i) => (
                <span key={p.key} className={p.className}>
                  {i > 0 && <span aria-hidden className="text-muted-foreground/50"> · </span>}
                  {p.text}
                </span>
              ))}
              {usage?.overLimit && <span className="font-medium text-red-600 dark:text-red-400"> · {t("overLimit")}</span>}
            </p>
            {isCredit && pct !== null && balancesVisible && (
              <div
                role="progressbar"
                aria-label={t("cards.utilizationLabel", { pct })}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
                className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                    usage?.overLimit ? "bg-red-500" : pct >= 90 ? "bg-amber-500" : "bg-primary",
                  )}
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            )}
          </div>
          <div className="pointer-events-auto -me-1 -mt-1 shrink-0 @lg/tile:mt-0">
            <CardActionsMenu card={card} canWrite={canWrite} canDelete={canDelete} currency={currency} onEdit={onEdit} onChanged={onChanged} />
          </div>
        </div>
      </div>
    </div>
  )
}

import type { ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { AlertTriangle, Archive, ArrowLeftRight, CalendarClock, CheckCircle2, Clock, GripVertical, Landmark, Snowflake, Wallet, Zap } from "lucide-react"
import { cardDisplayName } from "@/lib/cards"
import { creditUsage } from "@/lib/credit-card"
import type { Card, CardSummary, CreditCardStatementView } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { CardActionsMenu } from "@/components/cards/CardActionsMenu"
import { ExpiryAlert } from "@/components/cards/ExpiryAlert"
import { cardStatusKey, expiryAlert, shortDate } from "@/components/cards/card-dates"

/**
 * The Cards grid: at most two columns, roomy gaps. Three cards across is what
 * made the tab feel cluttered — a payment card is a picture, and pictures need
 * air. Each tile is a CONTAINER, so a wide column lays the card and its status
 * out side by side instead of stretching the plastic into a billboard.
 */
const GRID = "grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2"

/** Utilization at or above this is worth a warning. Matches the card page. */
const WARN_PCT = 90

/** The drag activator the grid hands each tile (dnd-kit's useDraggable). */
export type CardDragHandle = {
  ref: (el: HTMLElement | null) => void
  listeners?: Record<string, unknown>
  attributes?: Record<string, unknown>
}

/**
 * What releasing on THIS tile would do right now. "action" is the middle of the
 * tile: paying it, or moving money onto it. "reorder" is an edge, and shows an
 * insertion line in the gap the tile would move to.
 */
export type CardDropTarget =
  | { kind: "action"; label: string }
  | { kind: "reorder"; edge: "before" | "after"; axis: "x" | "y" }
  | null

/** The blue insertion bar shown in the gap the dragged tile would land in. */
function InsertionLine({ edge, axis }: { edge: "before" | "after"; axis: "x" | "y" }) {
  const vertical = axis === "y"
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute z-30 rounded-full bg-primary",
        vertical
          ? cn("inset-x-2 h-1", edge === "before" ? "-top-2.5" : "-bottom-2.5")
          : cn("inset-y-2 w-1", edge === "before" ? "-start-2.5" : "-end-2.5"),
      )}
    />
  )
}

/** Grid placeholders in the tile's real shape, so nothing jumps when they arrive. */
export function CardsGridSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div className={GRID} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="@container/tile rounded-2xl border bg-card p-3.5 sm:p-4">
          <div className="flex flex-col @lg/tile:flex-row @lg/tile:gap-4">
            <Skeleton className="aspect-[1.586] w-full rounded-xl @lg/tile:w-52 @lg/tile:shrink-0 @lg/tile:self-center @2xl/tile:w-64" />
            <div className="mt-4 w-full space-y-2.5 @lg/tile:mt-0 @lg/tile:flex-1">
              <Skeleton className="h-4 w-2/5" />
              <Skeleton className="h-3 w-3/5" />
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-3 w-4/5" />
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

/** caption over figure — the unit both kinds of tile are built from. */
function Figure({ caption, align = "start", children }: { caption: ReactNode; align?: "start" | "end"; children: ReactNode }) {
  return (
    <div className={cn("min-w-0", align === "end" && "text-end")}>
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{caption}</p>
      <p className="truncate text-sm font-semibold tabular-nums">{children}</p>
    </div>
  )
}

/**
 * The capacity meter. Hand-rolled rather than @/components/ui/progress on
 * purpose: that primitive moves its indicator with `transform: translateX(-N%)`,
 * a PHYSICAL transform, so it fills from the visual left — i.e. from the inline
 * END — under <html dir="rtl">. A normal-flow width grows from the inline start
 * in both directions. (CreditCardPanel has the original bug; don't copy it here.)
 */
function Meter({ pct, tone, label, valueText }: { pct: number; tone: string; label: string; valueText: string }) {
  // A card with 1% used must still draw something, or the meter reads as broken;
  // exactly 0 draws nothing. aria-valuenow stays exact either way.
  const width = pct <= 0 ? 0 : Math.max(3, Math.min(100, pct))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, pct)}
      aria-valuetext={valueText}
      className="h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-foreground/10 dark:ring-foreground/15"
    >
      <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none", tone)} style={{ width: `${width}%` }} />
    </div>
  )
}

/** The meter's slot while balances are hidden: same height, but hatched — an
 *  empty track would claim "nothing used", which is a different lie. */
function HiddenMeter({ label }: { label: string }) {
  return (
    <div role="img" aria-label={label} className="h-2.5 w-full overflow-hidden rounded-full bg-muted ring-1 ring-inset ring-foreground/10 dark:ring-foreground/15">
      <div className="h-full w-full opacity-25" style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--muted-foreground) 0 2px, transparent 2px 6px)" }} />
    </div>
  )
}

/** The meter's slot when there is no limit to run out of. */
function NoLimitRail() {
  return <div className="h-2.5 w-full rounded-full border border-dashed border-border" aria-hidden />
}

/**
 * One card in the Cards grid. The info column is four bands in triage order:
 *
 *   1. identity — name, kind, and the bank the card answers to
 *   2. an ALERT RAIL that renders nothing at all for a healthy card, so the
 *      absence of chips is itself the "nothing needs you" signal (and a healthy
 *      card pays none of the redesign's height)
 *   3. the figures — for credit, one bordered box where the two numbers sit
 *      directly over their own halves of the meter, so the bar and the amounts
 *      read as ONE object instead of a graphic plus a sentence; for debit,
 *      what is available and which bank it spends from
 *   4. for credit, a hairline-fenced due strip: when to pay and how much
 *
 * Everything in bands 1–3 comes off the card ROW, so it paints on first render.
 * Only band 4 waits on the async summary, and it degrades to facts from the row
 * rather than to an eternal skeleton.
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
  onPay,
  handle,
  dragging = false,
  drop = null,
}: {
  card: Card
  summary?: CardSummary | null
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  canDelete: boolean
  onEdit?: () => void
  onChanged?: (card: Card | null) => void
  /** Opens the Pay sheet for this card. Absent → no Pay button. */
  onPay?: () => void
  /** Drag activator, when the grid is sortable. Absent → no grip. */
  handle?: CardDragHandle
  dragging?: boolean
  /** What releasing here would do, while this tile is the live target. */
  drop?: CardDropTarget
}) {
  const { t } = useTranslation("wealth")
  const name = cardDisplayName(card)
  const bank = (card.account_nickname || card.account_bank_name || "").trim()
  const fundingBank = (card.funding_account_nickname || card.funding_account_bank_name || "").trim()
  const money = (n: number) => formatMoney(n, currency, balancesVisible)
  const isCredit = card.kind === "credit"
  const usage = isCredit ? creditUsage(card.account_credit_limit, card.account_current_balance) : null
  const alert = expiryAlert(card)
  const dimmed = card.status !== "active"

  // The honest percentage: creditUsage clamps utilization to 1 so the BAR never
  // overflows, but a card at 112% must say 112%, not 100%.
  const pct = usage && usage.limit ? Math.round((usage.debt / usage.limit) * 100) : null
  const overLimit = !!usage?.overLimit
  const warn = !overLimit && pct !== null && pct >= WARN_PCT

  // Debt off the card ROW, never the async summary: the button must not appear
  // (or vanish) as summaries stream in, and must never disagree with the meter
  // rendered two lines above it.
  const canPay = !!onPay && isCredit && canWrite && card.status !== "closed" && (usage?.debt ?? 0) > 0

  const statusChip =
    card.status === "frozen"
      ? { Icon: Snowflake, word: t("cards.statusFrozen"), tone: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300" }
      : card.status === "closed"
        ? { Icon: Archive, word: t("cards.statusClosed"), tone: "border-border bg-muted text-muted-foreground" }
        : null
  const hasRail = !!statusChip || overLimit || !!alert

  return (
    // Stretched-link tile: the Link is the single full-bleed click target (z-0);
    // the visible content sits above it (pointer-events-none) and only the two
    // islands — the kebab and the expiry chip — re-enable pointer events, so no
    // interactive element ever nests inside another.
    <div
      data-card-tile={card.id}
      className={cn(
        "@container/tile group relative isolate rounded-2xl border bg-card p-3.5 transition-[transform,box-shadow,opacity,border-color] duration-200 ease-out hover:border-primary/40 sm:p-4",
        dimmed && "bg-muted/30",
        dragging && "opacity-40",
        drop?.kind === "action" && "ring-2 ring-primary ring-offset-2 ring-offset-background motion-safe:scale-[1.02]",
      )}
    >
      <Link
        to={`/wealth/cards/${card.id}`}
        aria-label={t("cards.openCard", { name })}
        className="pressable ios-tap absolute inset-0 z-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="pointer-events-none relative z-10 flex flex-col @lg/tile:flex-row @lg/tile:items-stretch @lg/tile:gap-4">
        <div className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:-translate-y-0.5 @lg/tile:w-52 @lg/tile:shrink-0 @lg/tile:self-center @2xl/tile:w-64">
          <CardVisual {...visualPropsFromCard(card)} size="md" still className="w-full" />
        </div>

        <div className="mt-4 flex min-w-0 flex-1 flex-col gap-2.5 @lg/tile:mt-0 @lg/tile:border-s @lg/tile:ps-4">
          {/* BAND 1 — identity */}
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold @lg/tile:text-[15px]">{name}</p>
              <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="shrink-0 font-medium uppercase tracking-wide">{isCredit ? t("cards.kindCredit") : t("cards.kindDebit")}</span>
                {(isCredit ? fundingBank : bank) && (
                  <>
                    <span aria-hidden className="shrink-0 text-border">·</span>
                    <span className="truncate">{isCredit ? t("cards.paidFrom", { bank: fundingBank }) : t("cards.linkedTo", { bank })}</span>
                  </>
                )}
              </p>
            </div>
            {/* z-20: these islands must stack above the expiry chip's tap halo.
                The grip sits BEFORE the kebab with a gap, so the kebab's 44px
                mobile halo never swallows a thumb aimed at the handle. */}
            <div className="pointer-events-auto relative z-20 -me-1 -mt-1 flex shrink-0 items-center gap-1">
              {handle && (
                <button
                  type="button"
                  ref={handle.ref}
                  {...handle.listeners}
                  {...handle.attributes}
                  aria-label={t("cards.reorderCard", { name })}
                  // touch-none is what lets the drag start on a phone instead of
                  // the browser claiming the gesture for scrolling.
                  className="ios-tap relative inline-flex size-8 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing sm:after:hidden"
                >
                  <GripVertical className="size-4" aria-hidden />
                </button>
              )}
              <CardActionsMenu card={card} canWrite={canWrite} canDelete={canDelete} currency={currency} onEdit={onEdit} onChanged={onChanged} />
            </div>
          </div>

          {/* BAND 2 — the alert rail. Absent entirely on a healthy card. */}
          {hasRail && (
            <div className="flex flex-wrap items-center gap-1.5">
              {statusChip && (
                <Badge variant="outline" className={cn("gap-1 py-0 text-[11px]", statusChip.tone)}>
                  <statusChip.Icon className="size-3" aria-hidden /> {statusChip.word}
                </Badge>
              )}
              {overLimit && (
                <Badge variant="outline" className="gap-1 border-red-500/40 bg-red-500/10 py-0 text-[11px] text-red-700 dark:bg-red-500/15 dark:text-red-300">
                  <AlertTriangle className="size-3" aria-hidden /> {t("overLimit")}
                </Badge>
              )}
              {alert && (
                <span className="pointer-events-auto relative z-10 inline-flex">
                  <ExpiryAlert alert={alert} />
                </span>
              )}
            </div>
          )}

          {/* BAND 3 — the figures */}
          {isCredit && usage ? (
            <div className="rounded-lg border bg-muted/40 px-2.5 py-2">
              <div className="flex items-end justify-between gap-3">
                {usage.debt === 0 && usage.credit > 0 ? (
                  <Figure caption={t("cards.meterCredit")}>
                    <span className="text-emerald-700 dark:text-emerald-300">{t("cardCredit", { amount: money(usage.credit) })}</span>
                  </Figure>
                ) : (
                  <Figure caption={t("cards.meterUsed")}>
                    {money(usage.debt)}
                    {balancesVisible && pct !== null && (
                      <span className={cn("ms-1.5 inline-flex items-center gap-0.5 text-[11px] font-normal", overLimit ? "text-red-700 dark:text-red-400" : warn ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                        {(overLimit || warn) && <AlertTriangle className="size-3" aria-hidden />}
                        {t("cards.meterPct", { pct })}
                      </span>
                    )}
                  </Figure>
                )}

                {usage.limit === null ? (
                  <Figure caption="" align="end">
                    <span className="text-[13px] font-medium text-muted-foreground">{t("cards.meterNoLimit")}</span>
                  </Figure>
                ) : overLimit ? (
                  <Figure caption={t("overLimit")} align="end">
                    <span className="text-red-700 dark:text-red-400">{money(usage.debt - usage.limit)}</span>
                  </Figure>
                ) : (
                  <Figure caption={t("cards.meterLeft")} align="end">
                    <span className="text-emerald-700 dark:text-emerald-300">{money(usage.available ?? 0)}</span>
                    {/* The limit anchors the figure, but only where it fits. The
                        literal space matters: without it the accessible name
                        runs the two figures together as "1,050.00of 2,000.00". */}
                    <span className="hidden text-[11px] font-normal text-muted-foreground @xs/tile:inline"> {t("cards.meterOfLimit", { limit: money(usage.limit) })}</span>
                  </Figure>
                )}
              </div>

              <div className="mt-2">
                {usage.limit === null ? (
                  <NoLimitRail />
                ) : !balancesVisible ? (
                  <HiddenMeter label={t("cards.meterHidden")} />
                ) : (
                  <Meter
                    pct={pct ?? 0}
                    tone={overLimit ? "bg-red-500" : warn ? "bg-amber-500" : "bg-primary"}
                    label={t("cards.utilizationLabel", { pct: pct ?? 0 })}
                    valueText={t("cards.availableOfLine", { available: money(usage.available ?? 0), limit: money(usage.limit) })}
                  />
                )}
              </div>
            </div>
          ) : (
            // Same enclosure as the credit meter, minus the bar: a debit card has
            // no capacity to run out of, and the missing meter is the statement.
            // Sharing the box keeps a mixed grid row from looking half-finished.
            <div className="rounded-lg border bg-muted/40 px-2.5 py-2">
              <div className="flex items-end justify-between gap-3">
                <Figure caption={t("availableLabel")}>
                  <span className={cn(Number(card.account_current_balance ?? 0) < 0 && "text-red-700 dark:text-red-400")}>
                    {money(Number(card.account_current_balance ?? 0))}
                  </span>
                </Figure>
                <Figure caption={t("cards.spendsFrom")} align="end">
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                    {card.account_archived_at ? <Archive className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Landmark className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
                    <span className={cn("truncate", card.account_archived_at && "text-muted-foreground")}>{bank || t("bank")}</span>
                  </span>
                </Figure>
              </div>
            </div>
          )}

          {/* BAND 4 — when to pay. mt-auto keeps it on one baseline across a row. */}
          {isCredit && <DueStrip card={card} summary={summary} money={money} />}

          {/* BAND 5 — the action. Its own island so the stretched Link keeps
              the rest of the tile; full width and 44px so a thumb cannot miss. */}
          {canPay && (
            <div className="pointer-events-auto relative z-20">
              <Button variant="outline" size="sm" className="pressable w-full min-h-11 sm:min-h-9" onClick={onPay}>
                <Wallet className="size-4" aria-hidden /> {t("payCard")}
              </Button>
            </div>
          )}
        </div>
      </div>

      {drop?.kind === "reorder" && <InsertionLine edge={drop.edge} axis={drop.axis} />}
      {drop?.kind === "action" && (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-30 flex justify-center motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-150">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-lg">
            <ArrowLeftRight className="size-3" aria-hidden /> {drop.label}
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * "When do I pay, and how much" — a different question from "how much of the
 * limit is gone", so it lives below a hairline rather than in the meter box.
 *
 * It is the only part of the tile that waits on the network, and it degrades
 * downwards rather than disappearing: a filed statement, else the cycle's next
 * due date, else the billing days off the card row (which cannot go stale),
 * else nothing at all. `summary === undefined` means "still loading" and shows
 * a skeleton; `null` means the fetch failed and falls through to the row.
 */
function DueStrip({ card, summary, money }: { card: Card; summary?: CardSummary | null; money: (n: number) => string }) {
  const { t } = useTranslation("wealth")
  const st: CreditCardStatementView | null = summary?.credit?.statement ?? null
  const cycle = summary?.credit?.cycle ?? null
  const nextAutopay = summary?.next_autopay ?? null

  const wrap = (children: ReactNode) => (
    <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-xs">{children}</div>
  )

  if (summary === undefined) return wrap(<Skeleton className="h-4 w-32" />)

  if (st && st.remaining > 0) {
    // Autopay that lands on or before the due date turns a deadline into an
    // FYI — but never for an overdue statement: autopay had its chance there.
    const covered = !!card.autopay && !!nextAutopay && nextAutopay.date <= st.due_date && st.status !== "overdue"
    const tier =
      st.status === "overdue" ? "overdue" : covered ? "later" : st.daysToDue === 0 ? "today" : st.daysToDue <= 3 ? "urgent" : st.daysToDue <= 7 ? "soon" : "later"
    const look = {
      overdue: { Icon: AlertTriangle, chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:bg-red-500/15 dark:text-red-300", text: "font-medium text-red-700 dark:text-red-400" },
      today: { Icon: AlertTriangle, chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", text: "font-medium text-amber-700 dark:text-amber-300" },
      urgent: { Icon: Clock, chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300", text: "font-medium text-amber-700 dark:text-amber-300" },
      soon: { Icon: Clock, chip: "border-border bg-muted text-foreground", text: "" },
      later: { Icon: CalendarClock, chip: "border-border bg-muted text-muted-foreground", text: "" },
    }[tier]
    const word = st.status === "overdue" ? t("cards.overdueBy", { count: Math.abs(st.daysToDue) }) : st.daysToDue === 0 ? t("cards.dueToday") : t("cards.dueIn", { count: st.daysToDue })

    return wrap(
      <>
        <span className="flex min-w-0 items-center gap-1.5">
          <look.Icon className={cn("size-3.5 shrink-0", look.text || "text-muted-foreground")} aria-hidden />
          <span className={cn("truncate", look.text)}>{t("dueOn", { date: shortDate(st.due_date) })}</span>
          <Badge variant="outline" className={cn("shrink-0 gap-1 py-0 text-[11px]", look.chip)}>{word}</Badge>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {covered && (
            <Badge variant="outline" className="gap-1 border-border bg-muted py-0 text-[11px] text-muted-foreground">
              <Zap className="size-3" aria-hidden /> {t("cards.autopay")}
            </Badge>
          )}
          <span aria-hidden className="font-semibold tabular-nums">{money(st.remaining)}</span>
          <span className="sr-only">{t("statementRemaining", { amount: money(st.remaining) })}</span>
        </span>
      </>,
    )
  }

  if (st) {
    return wrap(
      <>
        <span className="flex min-w-0 items-center gap-1.5">
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="font-medium text-emerald-700 dark:text-emerald-300">{t("statusPaid")}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">{t("dueOn", { date: shortDate(st.due_date) })}</span>
      </>,
    )
  }

  if (cycle?.next_due_date) {
    return wrap(
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("dueOn", { date: shortDate(cycle.next_due_date) })}</span>
      </span>,
    )
  }

  if (card.account_statement_closing_day && card.account_payment_due_day) {
    return wrap(
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
        <CalendarClock className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{t("cards.cycleLine", { closing: card.account_statement_closing_day, due: card.account_payment_due_day })}</span>
      </span>,
    )
  }

  return null
}

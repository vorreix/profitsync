import { useMemo, type CSSProperties, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ArrowLeftRight, ChevronRight, CreditCard, Plus } from "lucide-react"
import { cardDisplayName, isCardExpired, maskedTail } from "@/lib/cards"
import type { Card, WealthAccount } from "@/lib/types"
import { accountDisplayName } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { relatedBankCards } from "@/components/cards/bank-cards"
import { CardStack } from "@/components/cards/CardStack"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import "@/components/cards/bank-cards.css"

const todayIso = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function StatusPill({ card }: { card: Card }) {
  const { t } = useTranslation("wealth")
  if (card.status === "closed") return <Badge variant="outline" className="shrink-0 py-0 text-[11px] text-muted-foreground">{t("cards.statusClosed")}</Badge>
  if (card.status === "frozen") return <Badge variant="secondary" className="shrink-0 py-0 text-[11px]">{t("cards.statusFrozen")}</Badge>
  if (isCardExpired(card.expiry_month, card.expiry_year, todayIso())) {
    return <Badge variant="destructive" className="shrink-0 py-0 text-[11px]">{t("cards.statusExpired")}</Badge>
  }
  return null
}

/** One card as a tappable row: small plastic, name, kind · tail, status. */
function CardRow({ card, index, onNavigate }: { card: Card; index: number; onNavigate: () => void }) {
  const { t } = useTranslation("wealth")
  const name = cardDisplayName(card)
  return (
    <Link
      to={`/wealth/cards/${card.id}`}
      data-card-tile={card.id}
      onClick={onNavigate}
      aria-label={t("cards.openCard", { name })}
      style={{ "--deal-i": index } as CSSProperties}
      className={cn(
        "bank-card-in pressable ios-tap flex min-h-16 items-center gap-3 rounded-xl border bg-card p-2.5 text-start outline-none transition-colors",
        "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
        card.status === "closed" && "opacity-70",
      )}
    >
      <div className="bank-card-art w-[74px] shrink-0 sm:w-[86px]">
        <CardVisual {...visualPropsFromCard(card)} size="sm" still className="w-full" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {card.kind === "credit" ? t("cards.kindCredit") : t("cards.kindDebit")}
          <span aria-hidden> · </span>
          <span className="tabular-nums" dir="ltr">{maskedTail(card.last4)}</span>
        </p>
      </div>
      <StatusPill card={card} />
      <ChevronRight className="size-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
    </Link>
  )
}

function Group({
  icon,
  title,
  hint,
  cards,
  from,
  onNavigate,
}: {
  icon: ReactNode
  title: string
  hint: string
  cards: Card[]
  from: number
  onNavigate: () => void
}) {
  if (cards.length === 0) return null
  return (
    <section className="space-y-2">
      <header className="bank-card-in" style={{ "--deal-i": from } as CSSProperties}>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <span className="text-muted-foreground/80" aria-hidden>{icon}</span>
          {title}
          <span className="rounded-full bg-muted px-1.5 py-px text-[11px] font-medium tabular-nums normal-case tracking-normal">{cards.length}</span>
        </h3>
        <p className="mt-1 text-xs leading-snug text-muted-foreground/80">{hint}</p>
      </header>
      <div className="space-y-2">
        {cards.map((card, i) => (
          <CardRow key={card.id} card={card} index={from + i + 1} onNavigate={onNavigate} />
        ))}
      </div>
    </section>
  )
}

/**
 * "Cards on {account}" — the overlay behind the header's card button: a bottom
 * sheet on phones, a centred dialog from `sm` up.
 *
 * It answers one question the old always-on grid got wrong: a debit card that
 * SPENDS this balance and a credit card this balance merely PAYS are two
 * different relationships, so they are two labelled groups with a line of plain
 * English each — never one flat grid.
 *
 * The cards deal out with a stagger (bank-cards.css); under
 * prefers-reduced-motion they are simply there.
 */
export function BankCardsDialog({
  open,
  onOpenChange,
  account,
  cards,
  loading,
  canWrite,
  onAddCard,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: WealthAccount
  cards: Card[]
  loading: boolean
  canWrite: boolean
  onAddCard: () => void
}) {
  const { t } = useTranslation("wealth")
  const { on, pays } = useMemo(() => relatedBankCards(cards, account.id), [cards, account.id])
  const name = accountDisplayName(account)
  const empty = on.length === 0 && pays.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        id="cards"
        className="inset-x-0 bottom-0 top-auto flex max-h-[88svh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-t-2xl p-0 data-[state=closed]:slide-out-to-bottom-6 data-[state=open]:slide-in-from-bottom-6 sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-[8svh] sm:max-h-[84svh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:rounded-2xl sm:data-[state=closed]:slide-out-to-bottom-0 sm:data-[state=open]:slide-in-from-bottom-0"
      >
        <DialogHeader className="shrink-0 border-b px-5 pb-3 pt-5 text-start sm:px-6">
          <DialogTitle className="flex items-center gap-2 pe-6 text-base">
            <CreditCard className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{t("cards.bankCardsTitle", { account: name })}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">{t("cards.bankCardsDesc", { account: name })}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto scrollbar-thin px-5 py-4 sm:px-6">
          {loading && empty ? (
            <div className="space-y-2" aria-hidden>
              {[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
            </div>
          ) : empty ? (
            <div className="flex flex-col items-center py-2 text-center">
              <CardStack className="w-40" />
              <p className="mt-1 text-sm font-medium">{t("cards.bankCardsEmpty")}</p>
              <p className="mx-auto mt-1 max-w-[34ch] text-xs leading-relaxed text-muted-foreground">
                {t("cards.bankCardsEmptyHint")}
              </p>
            </div>
          ) : (
            <>
              <Group
                icon={<CreditCard className="size-3.5" />}
                title={t("cards.bankCardsOn")}
                hint={t("cards.bankCardsOnHint")}
                cards={on}
                from={0}
                onNavigate={() => onOpenChange(false)}
              />
              <Group
                icon={<ArrowLeftRight className="size-3.5" />}
                title={t("cards.bankCardsPays")}
                hint={t("cards.bankCardsPaysHint")}
                cards={pays}
                from={on.length === 0 ? 0 : on.length + 1}
                onNavigate={() => onOpenChange(false)}
              />
            </>
          )}
        </div>

        {canWrite && (
          <DialogFooter className="shrink-0 border-t px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] pt-3 sm:px-6 sm:pb-5">
            <Button onClick={onAddCard} className="w-full sm:w-auto">
              <Plus className="size-4" /> {t("cards.addCard")}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

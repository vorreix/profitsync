import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { Plus } from "lucide-react"
import { cardDisplayName, maskedTail } from "@/lib/cards"
import type { WealthAccount } from "@/lib/types"
import { useCards } from "@/lib/use-cards"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { AddCardWizard } from "@/components/cards/AddCardWizard"

/**
 * The "Cards" section of a bank page: the debit cards on this bank and the
 * credit cards it pays, as small visuals that link to each card's page, plus
 * "+ Add card" with this bank preselected. `#cards` (from the Banks tab badge)
 * scrolls here once the cards are in.
 */
export function BankCardsSection({ bank, canWrite }: { bank: WealthAccount; canWrite: boolean }) {
  const { t } = useTranslation("wealth")
  const location = useLocation()
  const { cards, loading, refresh } = useCards()
  const [wizardOpen, setWizardOpen] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const scrolledRef = useRef(false)

  const mine = useMemo(
    () => cards.filter((c) => c.account_id === bank.id || c.funding_account_id === bank.id),
    [cards, bank.id],
  )

  useEffect(() => {
    if (loading || scrolledRef.current || location.hash !== "#cards") return
    scrolledRef.current = true
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ref.current?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" })
  }, [loading, location.hash])

  if (!loading && mine.length === 0 && !canWrite) return null

  return (
    <section ref={ref} id="cards" aria-labelledby="bank-cards-heading" className="scroll-mt-20 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bank-cards-heading" className="text-sm font-semibold">
          {t("cards.bankCards")} {mine.length > 0 && <span className="text-muted-foreground">({mine.length})</span>}
        </h2>
        {canWrite && (
          <Button size="sm" variant="outline" onClick={() => setWizardOpen(true)} className="pressable">
            <Plus className="size-4" /> {t("cards.addCard")}
          </Button>
        )}
      </div>

      {loading && cards.length === 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {[1, 2].map((i) => <Skeleton key={i} className="aspect-[1.586] rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {mine.map((card) => {
            const name = cardDisplayName(card)
            const funded = card.kind === "credit" && card.funding_account_id === bank.id
            return (
              <Link
                key={card.id}
                to={`/wealth/cards/${card.id}`}
                data-card-tile={card.id}
                aria-label={t("cards.openCard", { name })}
                className="group ios-tap block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:group-hover:-translate-y-0.5">
                  <CardVisual {...visualPropsFromCard(card)} size="sm" still className="w-full" />
                </div>
                <p className="mt-2 truncate text-xs font-medium">{name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {card.kind === "credit" ? t("cards.kindCredit") : t("cards.kindDebit")}
                  <span aria-hidden> · </span>
                  <span className="tabular-nums">{maskedTail(card.last4)}</span>
                  {funded && <><span aria-hidden> · </span>{t("cards.paysThisCard")}</>}
                </p>
              </Link>
            )
          })}
          {canWrite && (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="pressable ios-tap flex aspect-[1.586] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed p-3 text-center text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <Plus className="size-5" aria-hidden />
              <span className="text-xs font-medium">{t("cards.addCard")}</span>
              {mine.length === 0 && <span className="text-[11px] leading-tight">{t("cards.bankCardsEmpty")}</span>}
            </button>
          )}
        </div>
      )}

      <AddCardWizard open={wizardOpen} onOpenChange={setWizardOpen} presetBankId={bank.id} onSaved={() => void refresh({ silent: true })} />
    </section>
  )
}

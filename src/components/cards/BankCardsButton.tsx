import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { CreditCard } from "lucide-react"
import type { Card, WealthAccount } from "@/lib/types"
import { isLiabilityType } from "@/lib/credit-card"
import { dropModalBackEntry } from "@/hooks/use-back-close"
import { Button } from "@/components/ui/button"
import { AddCardWizard } from "@/components/cards/AddCardWizard"
import { relatedBankCards } from "@/components/cards/bank-cards"
import { BankCardsDialog } from "@/components/cards/BankCardsDialog"
import "@/components/cards/bank-cards.css"

/**
 * The header's card button on a bank / cash page — and the whole cards
 * experience behind it.
 *
 * Why a button and not a section: the cards used to sit permanently in the page
 * body, eating a third of a phone screen for something a user looks at now and
 * then. They are one tap away instead, from an icon that keeps a slow specular
 * sweep (bank-cards.css) so it is noticeable without being loud — the sweep
 * stops while the pointer is on it, while the overlay is open, and for anyone
 * who prefers reduced motion.
 *
 * Shown on every bank (they can carry cards — the empty state offers "Add
 * card"), on a cash account only when it actually pays a credit card, and never
 * on a credit-card account (that page redirects to the card itself).
 *
 * `/wealth/:id#cards` — the link behind the Banks-tab tile badge — opens the
 * overlay and strips the hash, so closing it leaves a clean URL.
 */
export function BankCardsButton({
  account,
  cards,
  loading,
  canWrite,
  onChanged,
}: {
  account: WealthAccount
  cards: Card[]
  loading: boolean
  canWrite: boolean
  onChanged?: () => void
}) {
  const { t } = useTranslation("wealth")
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const handledHash = useRef(false)

  const { on, pays, issued } = useMemo(() => relatedBankCards(cards, account.id), [cards, account.id])
  // The badge counts what is live; closed cards are still listed inside.
  const liveCount = useMemo(
    () => [...on, ...pays, ...issued].filter((c) => c.status !== "closed").length,
    [on, pays, issued],
  )
  const isCash = account.type === "cash"

  // Deep link: open once per arrival at #cards and clear the hash immediately —
  // before the dialog pushes its back-close entry, so Back/close land on a URL
  // that will not re-open the overlay.
  useEffect(() => {
    if (location.hash !== "#cards") {
      handledHash.current = false
      return
    }
    if (handledHash.current) return
    handledHash.current = true
    setOpen(true)
    navigate({ pathname: location.pathname, search: location.search }, { replace: true })
  }, [location.hash, location.pathname, location.search, navigate])

  // A credit-card account IS a card — its own page is the card page.
  if (isLiabilityType(account.type)) return null
  // Cash holds no cards of its own; it only shows up here when it settles one.
  if (isCash && liveCount === 0) return null

  const label = liveCount > 0 ? t("cards.bankCardsCount", { count: liveCount }) : t("cards.bankCardsOpen")

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        aria-label={label}
        title={label}
        data-shine={open || wizardOpen ? "off" : "on"}
        onClick={() => setOpen(true)}
        // The 36px button matches its neighbours; ::after grows the hit area to 44px.
        className="bank-cards-trigger ios-tap after:absolute after:-inset-1 after:content-['']"
      >
        <span className="bank-cards-shine" aria-hidden />
        <CreditCard className="size-4" aria-hidden />
        {liveCount > 0 && (
          <span
            aria-hidden
            className="absolute -end-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
          >
            {liveCount}
          </span>
        )}
      </Button>

      <BankCardsDialog
        open={open}
        onOpenChange={setOpen}
        account={account}
        cards={cards}
        loading={loading}
        // Cash holds no card of its own, so there is nothing to add from here.
        canWrite={canWrite && !isCash}
        onAddCard={() => {
          // Chain sheet → wizard: drop the sheet's back entry first so its
          // close does not pop history into the freshly-opened wizard.
          dropModalBackEntry()
          setOpen(false)
          setWizardOpen(true)
        }}
      />

      <AddCardWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        presetBankId={isCash ? null : account.id}
        onSaved={() => onChanged?.()}
      />
    </>
  )
}

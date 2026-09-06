import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { Plus, RefreshCw } from "lucide-react"
import { apiGet } from "@/lib/api"
import type { Card, CardSummary } from "@/lib/types"
import { useCards } from "@/lib/use-cards"
import { Button } from "@/components/ui/button"
import { CardStack } from "@/components/cards/CardStack"
import { AddCardWizard } from "@/components/cards/AddCardWizard"
import { CardTile, CardsGridSkeleton } from "@/components/cards/CardTile"
import { CardsSummaryStrip } from "@/components/cards/CardsSummaryStrip"
import { ClosedCardsSection } from "@/components/cards/ClosedCardsSection"

// How many credit summaries load at once (each is a ledger walk server-side).
const SUMMARY_CONCURRENCY = 3

type WizardState = { open: boolean; mode: "create" | "edit"; card?: Card }

/**
 * The Cards tab of /wealth: summary strip, the grid of card visuals, closed
 * cards under a disclosure, and the add/edit wizard. Cards come from
 * useCards() (30 s cache, refreshed on every wealth mutation); the credit
 * summaries — needed only for "due Sep 15" and "Next payment due" — load in
 * the background with bounded concurrency, so the grid never waits for them.
 */
export function CardsTab({
  currency,
  balancesVisible,
  canWrite,
  canDelete,
}: {
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const { cards, loading, error, refresh } = useCards({ includeClosed: true })
  const [summaries, setSummaries] = useState<Record<string, CardSummary | null>>({})
  const [summariesLoading, setSummariesLoading] = useState(false)
  const [wizard, setWizard] = useState<WizardState>({ open: false, mode: "create" })

  const open = useMemo(() => cards.filter((c) => c.status !== "closed"), [cards])
  const closed = useMemo(() => cards.filter((c) => c.status === "closed"), [cards])

  // Re-fetch a credit card's summary whenever its balance or autopay changes
  // (a payment recorded elsewhere must move "due" here too).
  const summaryKey = open
    .filter((c) => c.kind === "credit")
    .map((c) => `${c.id}:${c.account_current_balance}:${c.autopay ? 1 : 0}:${c.funding_account_id ?? ""}`)
    .join("|")

  useEffect(() => {
    if (!summaryKey) { setSummaries({}); return }
    const ids = summaryKey.split("|").map((k) => k.split(":")[0])
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token || cancelled) return
      setSummariesLoading(true)
      const next: Record<string, CardSummary | null> = {}
      for (let i = 0; i < ids.length; i += SUMMARY_CONCURRENCY) {
        const chunk = ids.slice(i, i + SUMMARY_CONCURRENCY)
        const rows = await Promise.all(chunk.map((id) => apiGet<CardSummary>(`/api/cards/${id}/summary`, token).catch(() => null)))
        chunk.forEach((id, j) => { next[id] = rows[j] })
        if (cancelled) return
        setSummaries((prev) => ({ ...prev, ...next }))
      }
      if (!cancelled) setSummariesLoading(false)
    })()
    return () => { cancelled = true }
  }, [summaryKey, getToken])

  const openCreate = () => setWizard({ open: true, mode: "create" })
  const openEdit = (card: Card) => setWizard({ open: true, mode: "edit", card })
  const onChanged = () => void refresh({ silent: true })

  if (loading && cards.length === 0) {
    return (
      <div className="space-y-4">
        <div className="h-14 animate-pulse rounded-xl border bg-card sm:h-11" aria-hidden />
        <CardsGridSkeleton />
      </div>
    )
  }

  if (error && cards.length === 0) {
    return (
      <div className="rounded-2xl border py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("cards.loadFailed")}</p>
        <Button variant="outline" className="mt-3" onClick={() => void refresh()}>
          <RefreshCw className="size-4" /> {t("cards.retry")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {cards.length === 0 ? (
        // Deliberately not a full-height hero: on a phone this is the whole
        // screen, so the illustration shrinks and the copy carries it.
        <div className="rounded-2xl border bg-card px-4 py-7 text-center sm:py-12">
          <div className="mx-auto w-40 max-w-full sm:w-56">
            <CardStack />
          </div>
          <h2 className="mt-4 text-base font-semibold sm:mt-6 sm:text-lg">{t("cards.emptyTitle")}</h2>
          <div className="mx-auto mt-1.5 max-w-md space-y-1 text-[13px] text-muted-foreground sm:text-sm">
            <p>{t("cards.emptyDebit")}</p>
            <p>{t("cards.emptyCredit")}</p>
          </div>
          {canWrite && (
            <Button className="pressable mt-4 min-h-11 sm:mt-5 sm:min-h-9" onClick={openCreate}>
              <Plus className="size-4" /> {t("cards.addCard")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <CardsSummaryStrip
            cards={open}
            summaries={summaries}
            summariesLoading={summariesLoading}
            currency={currency}
            balancesVisible={balancesVisible}
            canWrite={canWrite}
            onAddCard={openCreate}
          />

          {open.length > 0 && (
            // Two columns at most, roomy gaps — three-across felt cluttered and
            // a wide tile lays itself out side-by-side (see CardTile).
            <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
              {open.map((card) => (
                <CardTile
                  key={card.id}
                  card={card}
                  summary={summaries[card.id]}
                  currency={currency}
                  balancesVisible={balancesVisible}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  onEdit={() => openEdit(card)}
                  onChanged={onChanged}
                />
              ))}
            </div>
          )}

          <ClosedCardsSection cards={closed} currency={currency} canWrite={canWrite} canDelete={canDelete} onEdit={openEdit} onChanged={onChanged} />
        </>
      )}

      <AddCardWizard
        open={wizard.open}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        mode={wizard.mode}
        card={wizard.card}
        onSaved={() => void refresh({ silent: true })}
      />
    </div>
  )
}

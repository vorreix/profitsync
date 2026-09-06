import { useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { ChevronDown, RotateCcw } from "lucide-react"
import { apiErrorMessage, apiErrorUpgradeHint, apiPatch } from "@/lib/api"
import { cardDisplayName, maskedTail } from "@/lib/cards"
import type { Card } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { CardActionsMenu } from "@/components/cards/CardActionsMenu"

/**
 * Closed cards, tucked under a collapsed disclosure so the grid stays about the
 * cards in use. Each row keeps a small visual (history still links here), the
 * bank, and Reopen — a credit card reopens its liability account too, which
 * the free plan may refuse (402 → upgrade hint).
 */
export function ClosedCardsSection({
  cards,
  currency,
  canWrite,
  canDelete,
  onEdit,
  onChanged,
}: {
  cards: Card[]
  currency: string
  canWrite: boolean
  canDelete: boolean
  onEdit?: (card: Card) => void
  onChanged?: (card: Card | null) => void
}) {
  const { t } = useTranslation("wealth")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (cards.length === 0) return null

  async function reopen(card: Card) {
    setBusyId(card.id)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<Card>(`/api/cards/${card.id}`, token, { status: "active" })
      toast.success(t("cards.reopenToast"))
      onChanged?.(updated)
    } catch (err) {
      if (apiErrorUpgradeHint(err)) toast.error(t("cards.reopenUpgrade"), { action: { label: t("upgradeBanksCta"), onClick: () => navigate("/subscription") } })
      else toast.error(apiErrorMessage(err, t("cards.updateFailed")))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="rounded-2xl border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="closed-cards"
        className="ios-tap flex min-h-11 w-full items-center justify-between gap-2 px-4 py-3 text-start text-sm font-medium"
      >
        <span>
          {t("cards.closedSection")} <span className="text-muted-foreground">({cards.length})</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      <div id="closed-cards" hidden={!open} className="divide-y border-t">
        {cards.map((card) => {
          const name = cardDisplayName(card)
          const bank = (card.account_nickname || card.account_bank_name || "").trim()
          return (
            <div key={card.id} data-card-tile={card.id} className="flex items-center gap-3 px-3 py-3 sm:px-4">
              <Link to={`/wealth/cards/${card.id}`} aria-label={t("cards.openCard", { name })} className="shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <CardVisual {...visualPropsFromCard(card)} size="sm" still className="w-20 opacity-70 grayscale-[35%] sm:w-24" />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Link to={`/wealth/cards/${card.id}`} className="truncate text-sm font-semibold hover:underline">{name}</Link>
                  <Badge variant="outline" className="shrink-0 py-0 text-[10px]">{t("cards.statusClosed")}</Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {card.kind === "credit" ? t("cards.kindCredit") : t("cards.kindDebit")}
                  {bank && <><span aria-hidden> · </span>{bank}</>}
                  <span aria-hidden> · </span>
                  <span className="tabular-nums">{maskedTail(card.last4)}</span>
                </p>
              </div>
              {canWrite && (
                <Button size="sm" variant="outline" onClick={() => void reopen(card)} disabled={busyId === card.id} className="pressable shrink-0">
                  <RotateCcw className="size-4" /> <span className="hidden sm:inline">{t("cards.reopen")}</span>
                </Button>
              )}
              <CardActionsMenu card={card} canWrite={canWrite} canDelete={canDelete} currency={currency} onEdit={onEdit ? () => onEdit(card) : undefined} onChanged={onChanged} />
            </div>
          )
        })}
      </div>
    </section>
  )
}

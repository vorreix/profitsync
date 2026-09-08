import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { ArrowUpRight, ArrowDownRight, ExternalLink, User } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { txTags } from "@/lib/transaction-tags"
import { accountDisplayName } from "@/lib/wealth"
import { useCardMap } from "@/lib/use-cards"
import { CardChip } from "@/components/cards/CardChip"
import type { Transaction } from "@/lib/types"

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })

/**
 * Lightweight read-only transaction details for the dashboard. Opening a latest
 * transaction surfaces its details and lets the user jump to the full transaction
 * (via the /transactions deep-link) or to its client.
 */
export function TransactionPeekModal({
  tx,
  open,
  onOpenChange,
  currency,
  showClient,
}: {
  tx: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  showClient: boolean
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const cardMap = useCardMap({ enabled: open })
  if (!tx) return null

  const incoming = tx.type === "incoming"
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(tx.amount))
  const card = cardMap.forTx(tx)
  const accountLabel = tx.wealth_account_name?.trim() || tx.wealth_account_bank_name?.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[92vw] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={`flex size-7 items-center justify-center rounded-full ${incoming ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-red-500/10 text-red-600 dark:text-red-400"}`}>
              {incoming ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
            </span>
            {t("dashboard.transactionDetails")}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className={`text-2xl font-bold tabular-nums ${incoming ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
            {incoming ? "+" : "−"}{amount}
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">{t("filters.type")}</p>
              <p className="font-medium">{incoming ? t("chart.incoming") : t("chart.outgoing")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t("filters.dateRange")}</p>
              <p className="font-medium">{formatDate(tx.date)}</p>
            </div>
            {tx.category && (
              <div>
                <p className="text-xs text-muted-foreground">{t("filters.category")}</p>
                <Badge variant="outline">{tx.category}</Badge>
              </div>
            )}
            {card ? (
              <div>
                <p className="text-xs text-muted-foreground">{t("transactions.cardPaidWith")}</p>
                {/* The chip links to the card page — close the modal on the way out. */}
                <div className="mt-1 flex" onClickCapture={() => onOpenChange(false)}>
                  <CardChip card={card} />
                </div>
              </div>
            ) : accountLabel ? (
              <div>
                <p className="text-xs text-muted-foreground">{t("transactions.account")}</p>
                <p className="font-medium truncate">
                  {accountDisplayName({ bank_name: tx.wealth_account_bank_name ?? "", nickname: tx.wealth_account_name ?? "" })}
                </p>
              </div>
            ) : null}
            {txTags(tx).length > 0 && (
              <div className="col-span-2">
                <p className="text-xs text-muted-foreground">{t("transactions.tags")}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {txTags(tx).map((tag) => (
                    <Badge key={tag} variant="secondary">{tag}</Badge>
                  ))}
                </div>
              </div>
            )}
            {showClient && tx.client_name && (
              <div>
                <p className="text-xs text-muted-foreground">{t("filters.client")}</p>
                <p className="font-medium truncate">{tx.client_name}</p>
              </div>
            )}
          </div>
          {tx.description && (
            <div>
              <p className="text-xs text-muted-foreground">{t("dashboard.description")}</p>
              <p className="text-sm">{tx.description}</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); navigate(`/transactions?view=${tx.id}`) }}>
              <ExternalLink className="size-4" /> {t("dashboard.openTransaction")}
            </Button>
            {showClient && (
              <Button variant="outline" size="sm" onClick={() => { onOpenChange(false); navigate(`/clients/${tx.client_id}`) }}>
                <User className="size-4" /> {t("dashboard.openClient")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

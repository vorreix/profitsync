import { useTranslation } from "react-i18next"
import { ArrowLeftRight, CreditCard, RotateCcw, Zap } from "lucide-react"
import type { Transaction } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

// The card-autopay engine labels the payment it records with this prefix
// (api/_lib/card-autopay.ts) — the one signal that a card payment was automatic.
const AUTOPAY_PREFIX = /^autopay:/i

/**
 * Names what a row IS when the arrow alone would mislead: a REFUND (money back,
 * not income), a TRANSFER, a CARD PAYMENT (a transfer to/from a credit card
 * — never an expense) or an AUTOPAY (a card payment ProfitSync recorded on the
 * due date). Text, not just colour, so the meaning survives privacy mode and
 * colour-blindness. Renders nothing for an ordinary income/expense.
 */
export function TxKindBadge({
  tx,
  className,
}: {
  tx: Pick<Transaction, "kind" | "type"> & Partial<Pick<Transaction, "counterpart_type" | "wealth_account_type" | "description">>
  className?: string
}) {
  const { t } = useTranslation("transactions")
  if (tx.kind === "refund") {
    return (
      <Badge variant="outline" className={cn("shrink-0 gap-1 border-amber-500/40 bg-amber-500/10 py-0 text-[10px] text-amber-700 dark:text-amber-300", className)}>
        <RotateCcw className="size-3" aria-hidden /> {t("refundBadge")}
      </Badge>
    )
  }
  if (tx.kind === "transfer") {
    const autopay = AUTOPAY_PREFIX.test((tx.description ?? "").trim())
    const cardPayment = tx.counterpart_type === "credit_card" || tx.wealth_account_type === "credit_card"
    const Icon = autopay ? Zap : cardPayment ? CreditCard : ArrowLeftRight
    return (
      <Badge variant="secondary" className={cn("shrink-0 gap-1 py-0 text-[10px]", className)}>
        <Icon className="size-3" aria-hidden />
        {autopay ? t("cardAutopayBadge") : cardPayment ? t("cardPaymentBadge") : t("transferBadge")}
      </Badge>
    )
  }
  return null
}

import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { PiggyBank } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import type { Transaction } from "@/lib/types"

/**
 * Shows a piggy-bank "Space" badge on a transfer leg whose counterpart account is
 * a Space, and deep-links to that Space on click. Renders nothing for any other
 * transaction. Use on account-detail transfer rows and the transaction detail
 * modal (where "Transfer to <Space>" appears).
 */
export function SpaceLinkBadge({ tx, className, onNavigate }: { tx: Transaction; className?: string; onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { t } = useTranslation("spaces")
  if (tx.kind !== "transfer" || tx.counterpart_type !== "space" || !tx.counterpart_account_id) return null
  return (
    <Badge
      variant="secondary"
      className={cn("shrink-0 cursor-pointer gap-1 py-0 text-[10px] text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300", className)}
      title={t("viewDetails")}
      onClick={(e) => { e.stopPropagation(); onNavigate?.(); navigate(`/spaces/${tx.counterpart_account_id}`) }}
    >
      <PiggyBank className="size-3" /> {t("spaceBadge")}
    </Badge>
  )
}

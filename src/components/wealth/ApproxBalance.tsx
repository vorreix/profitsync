import { useTranslation } from "react-i18next"
import type { WealthSummaryAccount } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatApprox, formatDateLabel } from "@/lib/wealth"

/**
 * The muted "≈ €730 · as of 9 Sep" line under a foreign-currency balance.
 *
 * Renders NOTHING when the account is already in the reporting currency (an
 * approximation of itself is noise) or when the summary hasn't said anything
 * about this account yet. When the account's currency has no rate at all the
 * line is left out too — the breakdown carries the "not included" notice, so
 * the tile doesn't need a second one.
 */
export function ApproxBalance({
  account,
  reportingCurrency,
  visible,
  className,
}: {
  account: WealthSummaryAccount | undefined
  reportingCurrency: string | undefined
  visible: boolean
  className?: string
}) {
  const { t } = useTranslation("wealth")
  if (!account || !reportingCurrency || account.currency === reportingCurrency || account.converted_balance == null) return null
  return (
    <p className={cn("flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums", className)}>
      <span>{formatApprox(account.converted_balance, reportingCurrency, visible)}</span>
      {account.rate_date && (
        <span className="text-[11px] opacity-80">· {t("approxAsOf", { date: formatDateLabel(account.rate_date) })}</span>
      )}
      {account.stale && (
        <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
          {t("rateStale")}
        </span>
      )}
    </p>
  )
}

import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

const countOf = (count: number | null | undefined) => Math.max(0, Number(count ?? 0) || 0)

/**
 * "3 entries in another currency aren't included (no exchange rate)".
 *
 * Every converted figure on a screen is only honest if the screen also says
 * what it could NOT convert — a row in a currency with no stored rate for its
 * day is left out of the sum by the server and counted in `excluded_count`.
 * This is that count as one calm line; it renders nothing when the count is 0.
 *
 * `accounts` is the other kind of gap: a consolidated BALANCE that leaves out
 * accounts with no rate today (flow's `balance_excluded_count`). Accounts and
 * entries are different things, so they are never added into one count.
 */
export function FxExcludedNotice({ count, accounts = false, className }: { count: number | null | undefined; accounts?: boolean; className?: string }) {
  const { t } = useTranslation()
  const n = countOf(count)
  if (n === 0) return null
  return (
    <p role="status" data-testid="fx-excluded" className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{t(accounts ? "fx.accountsExcludedNotice" : "fx.excludedNotice", { count: n })}</span>
    </p>
  )
}

/**
 * The same fact as a small marker for ONE cell, bar or node whose own figure
 * leaves rows out — so a day showing $0 because its only entry has no rate does
 * not read as a quiet day. Inline (a span), so it can sit inside a button.
 */
export function FxExcludedMarker({ count, className }: { count: number | null | undefined; className?: string }) {
  const { t } = useTranslation()
  const n = countOf(count)
  if (n === 0) return null
  const label = t("fx.excludedNotice", { count: n })
  return (
    <span role="img" aria-label={label} title={label} data-testid="fx-excluded-marker" className={cn("inline-flex shrink-0 text-amber-600 dark:text-amber-400", className)}>
      <Info className="size-3" aria-hidden />
    </span>
  )
}

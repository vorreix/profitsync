import { useTranslation } from "react-i18next"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * "3 entries in another currency are not included (no exchange rate yet)".
 *
 * Every converted figure on a screen is only honest if the screen also says
 * what it could NOT convert — a row in a currency with no stored rate for its
 * day is left out of the sum by the server and counted in `excluded_count`.
 * This is that count as one calm line; it renders nothing when the count is 0.
 */
export function FxExcludedNotice({ count, className }: { count: number | null | undefined; className?: string }) {
  const { t } = useTranslation()
  const n = Math.max(0, Number(count ?? 0) || 0)
  if (n === 0) return null
  return (
    <p role="status" data-testid="fx-excluded" className={cn("flex items-start gap-1.5 text-xs text-muted-foreground", className)}>
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{t("fx.excludedNotice", { count: n })}</span>
    </p>
  )
}

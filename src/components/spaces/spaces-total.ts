import type { WealthAccount, WealthSummary } from "@/lib/types"
import { accountCurrency, formatMoney } from "@/lib/wealth"
import { formatByCurrency } from "@/lib/debt-format"
import { savedFromSummary } from "@/components/wealth/use-consolidated-wealth"

/** Each currency the Spaces hold, with what they hold in it (native, never converted). */
export function spacesByCurrency(spaces: Pick<WealthAccount, "currency_code" | "current_balance">[], fallbackCurrency: string) {
  const totals = new Map<string, number>()
  for (const s of spaces) {
    const c = accountCurrency(s, fallbackCurrency)
    totals.set(c, (totals.get(c) ?? 0) + Number(s.current_balance))
  }
  return [...totals].map(([currency, amount]) => ({ currency, amount }))
}

/**
 * "Total saved" across Spaces, shared by the /spaces hero and the dashboard
 * card so the two can never disagree. Spaces can hold different currencies, so
 * this is never a raw sum of balances (MC-017 added €1,000 + ₹200 into
 * "₹1,200"): one currency is its own total; several are the summary's converted
 * figure when every rate is known, otherwise the native totals side by side.
 */
export function spacesSavedHeadline(
  spaces: Pick<WealthAccount, "currency_code" | "current_balance">[],
  fallbackCurrency: string,
  summary: WealthSummary | null | undefined,
  visible = true,
): string {
  const parts = spacesByCurrency(spaces, fallbackCurrency)
  if (parts.length <= 1) return formatMoney(parts[0]?.amount ?? 0, parts[0]?.currency ?? fallbackCurrency, visible)
  return summary?.complete
    ? formatMoney(savedFromSummary(summary), summary.reporting_currency, visible)
    : formatByCurrency(parts, visible)
}

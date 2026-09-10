import { useMemo } from "react"
import { useApiQuery } from "@/hooks/use-api-query"
import { cardCredit, isLiabilityType } from "@/lib/credit-card"
import type { WealthSummary, WealthSummaryAccount } from "@/lib/types"

/**
 * The consolidated wealth picture from GET /api/wealth/summary — net worth,
 * assets and liabilities in the reporting currency, one entry per currency,
 * and each account's approximate value at the latest rate.
 *
 * `byAccount` is the lookup the tiles need: "what is THIS account worth in the
 * reporting currency, and at which rate date". Native balances stay the fact
 * on the tile; this only ever adds the muted ≈ line beneath them.
 *
 * Read-only on the server (it never materialises money), so it sits in the
 * ordinary "money" freshness class: painted from cache, refreshed behind the
 * paint, refetched on every mutation like the account list itself.
 */
export function useConsolidatedWealth(enabled = true) {
  const query = useApiQuery<WealthSummary>(enabled ? "/api/wealth/summary" : null)
  const byAccount = useMemo(() => {
    const map = new Map<string, WealthSummaryAccount>()
    for (const a of query.data?.accounts ?? []) map.set(a.id, a)
    return map
  }, [query.data])
  return { summary: query.data, byAccount, loading: query.loading, refreshing: query.refreshing, error: query.error }
}

/**
 * The "available" figure — money the user HOLDS outside Spaces, minus what the
 * cards owe — in the reporting currency. Spaces are excluded (they are the
 * user's money, but parked), and a card's converted balance is already signed
 * (negative = debt), so a plain sum over the non-Space accounts is exactly
 * `liquid − liabilities`. Accounts with no rate are skipped, which is why the
 * caller must show the summary's `complete` flag beside any total.
 */
export function availableFromSummary(summary: WealthSummary): number {
  let sum = 0
  for (const a of summary.accounts) {
    if (a.type === "space" || a.converted_balance == null) continue
    sum += a.converted_balance
  }
  return Math.round(sum * 100) / 100
}

/**
 * The money the user HOLDS, in the reporting currency — cash + banks (outside
 * Spaces) plus any card that is in credit; never card debt, which is reported
 * separately as liabilities. Mirrors `summarizeWealth().liquid`.
 */
export function liquidFromSummary(summary: WealthSummary): number {
  let sum = 0
  for (const a of summary.accounts) {
    if (a.type === "space" || a.converted_balance == null) continue
    sum += isLiabilityType(a.type) ? cardCredit(a.converted_balance) : a.converted_balance
  }
  return Math.round(sum * 100) / 100
}

/** What the Spaces hold, in the reporting currency (rate-less Spaces skipped). */
export function savedFromSummary(summary: WealthSummary): number {
  let sum = 0
  for (const a of summary.accounts) {
    if (a.type !== "space" || a.converted_balance == null) continue
    sum += a.converted_balance
  }
  return Math.round(sum * 100) / 100
}

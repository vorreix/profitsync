import { useTranslation } from "react-i18next"
import { Coins, Info } from "lucide-react"
import type { WealthSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { formatApprox, formatDateLabel, formatMoney, formatRate } from "@/lib/wealth"

/**
 * One row per currency the workspace holds money in: the native totals (the
 * facts), the ≈ value in the reporting currency, the share of converted assets,
 * and the rate that produced it with its date. Shown only on multi-currency
 * workspaces — a single-currency one has nothing to break down.
 *
 * Honesty rules: a currency with no rate is still LISTED (its native figures
 * are real) but flagged as not included in the total; a stale rate says so
 * once, for the whole card, via `as_of`.
 */
export function CurrencyBreakdown({ summary, visible, className }: { summary: WealthSummary; visible: boolean; className?: string }) {
  const { t } = useTranslation("wealth")
  const reporting = summary.reporting_currency
  if (!summary.multi_currency) return null

  return (
    <section aria-labelledby="wealth-by-currency" className={cn("rounded-2xl border bg-card", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 id="wealth-by-currency" className="flex items-center gap-2 text-sm font-semibold">
          <Coins className="size-4 text-muted-foreground" aria-hidden />
          {t("byCurrency")}
        </h2>
        {summary.stale && summary.as_of && (
          <p className="text-[11px] text-muted-foreground">{t("ratesFrom", { date: formatDateLabel(summary.as_of) })}</p>
        )}
      </div>

      {!summary.complete && summary.excluded_currencies.length > 0 && (
        <p className="mx-4 mt-3 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200" role="status">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{t("currencyNotIncluded", { currency: summary.excluded_currencies.join(", ") })}</span>
        </p>
      )}

      <ul className="divide-y">
        {summary.by_currency.map((row) => {
          const isReporting = row.currency === reporting
          const excluded = row.converted_net == null
          return (
            <li key={row.currency} className="flex min-h-14 flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  <span className="tabular-nums">{row.currency}</span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {row.account_count === 1 ? t("accountCountOne") : t("accountCountOther", { count: row.account_count })}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {isReporting || excluded ? null : (
                    <>
                      {formatRate(row.currency, reporting, row.rate ?? "")}
                      {row.rate_date && <> · {formatDateLabel(row.rate_date)}</>}
                    </>
                  )}
                  {excluded && <span className="text-amber-700 dark:text-amber-300">{t("noRateYet")}</span>}
                </p>
              </div>
              <div className="min-w-0 text-end">
                <p className="text-sm font-semibold tabular-nums">
                  {formatMoney(row.assets, row.currency, visible)}
                  {row.liabilities > 0 && (
                    <span className="ms-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                      − {formatMoney(row.liabilities, row.currency, visible)}
                    </span>
                  )}
                </p>
                {!isReporting && row.converted_net != null && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatApprox(row.converted_net, reporting, visible)}
                    {row.share != null && <span className="ms-1.5">· {t("shareOfAssets", { share: row.share })}</span>}
                  </p>
                )}
                {isReporting && row.share != null && (
                  <p className="text-xs text-muted-foreground tabular-nums">{t("shareOfAssets", { share: row.share })}</p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <p className="border-t px-4 py-2 text-[11px] text-muted-foreground">{t("byCurrencyHint")}</p>
    </section>
  )
}

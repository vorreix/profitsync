// Reading the multi-currency facts a payload carries, without assuming they are
// there. Every aggregate route now answers in the workspace's REPORTING currency
// (`currency`) and says how many rows it could not convert (`excluded_count`);
// every transaction row keeps its NATIVE `amount` + `currency_code` and adds
// `reporting_amount` (converted at the row's own date, null when no rate is
// stored). A cached body from before this shipped has none of these, so each
// accessor falls back — to the org currency, to zero, to "not convertible".

import type { Client, Transaction } from "@/lib/types"

/** A payload that may carry the reporting-currency facts. */
export type ReportingMeta = { currency?: string | null; excluded_count?: number | null }

/** The currency an aggregate's figures are in — the response's, else the workspace's. */
export const reportingCurrencyOf = (body: ReportingMeta | null | undefined, fallback: string): string => body?.currency || fallback

/** Rows an aggregate had to leave out (no exchange rate for their day). */
export const excludedCountOf = (body: ReportingMeta | null | undefined): number => Math.max(0, Number(body?.excluded_count ?? 0) || 0)

/** The currency a transaction row's `amount` is in — its account's, else the workspace's. */
export const rowCurrency = (tx: Pick<Transaction, "currency_code"> | null | undefined, fallback: string): string => tx?.currency_code || fallback

type WithReportingAmount = { reporting_amount?: number | string | null; currency_code?: string | null; amount: number | string }

/**
 * A row's amount in the reporting currency, or null when it cannot be given:
 * the server's `reporting_amount` when present; the native amount when the row
 * is already in the reporting currency (or predates tagging); null otherwise —
 * a foreign row with no rate, which a total must COUNT rather than add raw.
 */
export function reportingAmountOf(tx: WithReportingAmount, reporting: string): number | null {
  if (tx.reporting_amount !== undefined) {
    if (tx.reporting_amount === null) return null
    const n = Number(tx.reporting_amount)
    return Number.isFinite(n) ? n : null
  }
  if (!tx.currency_code || tx.currency_code === reporting) return Number(tx.amount)
  return null
}

/**
 * Sum rows in the reporting currency, skipping — and counting — the ones that
 * cannot be converted. The one honest way to add a list of mixed-currency rows.
 */
export function sumInReporting<T extends WithReportingAmount>(rows: T[], reporting: string, pick: (tx: T) => boolean = () => true): { total: number; excluded: number } {
  let total = 0
  let excluded = 0
  for (const tx of rows) {
    if (!pick(tx)) continue
    const v = reportingAmountOf(tx, reporting)
    if (v === null) excluded += 1
    else total += v
  }
  return { total, excluded }
}

type ClientTotals = Pick<Client, "total_incoming" | "total_outgoing"> & { totals_currency?: string | null; excluded_count?: number | null }

/** The currency a client's `total_incoming`/`total_outgoing` are in. */
export const clientTotalsCurrency = (c: ClientTotals | null | undefined, fallback: string): string => c?.totals_currency || fallback
